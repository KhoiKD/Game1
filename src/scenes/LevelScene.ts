import Phaser from 'phaser';
import {
  ENEMY_ACTIVE_RANGE,
  ENEMY_BULLET_DAMAGE,
  ENEMY_BULLET_LIFETIME_MS,
  FIRE_INTERVAL_MS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PLAYER_BULLET_DAMAGE,
  PLAYER_IFRAMES_MS,
  PLAYER_MAX_HP,
} from '../config';
import { getBossStats, getEnemyStats } from '../data/enemyData';
import { Boss } from '../entities/Boss';
import { Bullet } from '../entities/Bullet';
import { Enemy, type EnemyContext } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { Turret } from '../entities/Turret';
import { Walker } from '../entities/Walker';
import {
  checkpointTriggerZone,
  parseLevelObjects,
  type EnemyDef,
  type LevelObjects,
  type RawObject,
} from '../level/parseLevelObjects';
import { applyDamage, createHealth, isInvulnerable, refill, type Health } from '../systems/health';
import {
  activateCheckpoint,
  collectPickup,
  createRunState,
  defeatEnemy,
  die,
  hasCollected,
  isDefeated,
  secureAll,
  securedCount,
  unsecuredCount,
  type RunState,
} from '../systems/runState';
import { clearSave, getStorage, loadSave, restoreRun, serializeRun, writeSave } from '../systems/save';
import { aimVector, type Vec2 } from '../util/aim';

const LEVEL_ID = 'level1';
const FALL_MARGIN = 96; // how far below the map the player may fall before dying
const PLAYER_HALF_HEIGHT = 32;
const BOSS_BAR_WIDTH = 520;

/** First playable level, loaded from the Tiled map assets/levels/level1.json. */
export class LevelScene extends Phaser.Scene {
  private player!: Player;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.GameObjects.Group;
  private boss: Boss | null = null;
  private reticle!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.Text;
  private healthPips!: Phaser.GameObjects.Graphics;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  private level!: LevelObjects;
  private run!: RunState;
  private health!: Health;
  private mapHeightPx = 0;
  private nextShotAt = 0;
  private deathPending = false;
  private readonly pickupSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly checkpointSprites = new Map<string, Phaser.GameObjects.Image>();
  private toastText?: Phaser.GameObjects.Text;

  constructor() {
    super('Level');
  }

  create(): void {
    this.pickupSprites.clear();
    this.checkpointSprites.clear();
    this.toastText = undefined;
    this.boss = null;
    this.nextShotAt = 0;
    this.deathPending = false;

    const map = this.make.tilemap({ key: 'level1' });
    const tileset = map.addTilesetImage('tiles', 'tiles');
    if (!tileset) throw new Error('Tileset "tiles" not found in level1');
    const ground = map.createLayer('ground', tileset, 0, 0);
    if (!ground) throw new Error('Tile layer "ground" not found in level1');
    ground.setCollisionByExclusion([-1]);

    this.mapHeightPx = map.heightInPixels;
    // Solid on the left, right, and top; open at the bottom so pits are fatal.
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels + FALL_MARGIN * 4);
    this.physics.world.setBoundsCollision(true, true, true, false);
    const camera = this.cameras.main;
    camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const rawObjects = (map.getObjectLayer('objects')?.objects ?? []) as unknown as RawObject[];
    this.level = parseLevelObjects(rawObjects);

    this.run = this.initialRunState();
    this.health = createHealth(PLAYER_MAX_HP);
    this.spawnCheckpointsAndPickups();

    const start = this.respawnPoint();
    this.player = new Player(this, start.x, start.y);
    this.physics.add.collider(this.player, ground);
    camera.startFollow(this.player, true, 0.12, 0.12);
    camera.centerOn(start.x, start.y);

    this.bullets = this.physics.add.group({
      classType: Bullet,
      runChildUpdate: true,
      allowGravity: false,
      maxSize: 64,
    });
    this.enemyBullets = this.physics.add.group({
      classType: Bullet,
      defaultKey: 'enemy-bullet',
      runChildUpdate: true,
      allowGravity: false,
      maxSize: 96,
    });
    // A plain group: a physics group would overwrite each enemy's own body settings.
    this.enemies = this.add.group();
    this.spawnEnemies();

    const killBullet = (a: unknown, b: unknown): void => {
      if (a instanceof Bullet) a.kill();
      else if (b instanceof Bullet) b.kill();
    };
    this.physics.add.collider(this.bullets, ground, killBullet);
    this.physics.add.collider(this.enemyBullets, ground, killBullet);
    this.physics.add.collider(this.enemies, ground);
    this.physics.add.overlap(this.bullets, this.enemies, (a, b) => this.onBulletHitsEnemy(a, b));
    this.physics.add.overlap(this.player, this.enemies, (a, b) => {
      const enemy = a instanceof Enemy ? a : b instanceof Enemy ? b : null;
      if (enemy?.active) this.damagePlayer(enemy.contactDamage);
    });
    this.physics.add.overlap(this.player, this.enemyBullets, (a, b) => {
      const bullet = a instanceof Bullet ? a : b instanceof Bullet ? b : null;
      if (!bullet?.active) return;
      bullet.kill();
      this.damagePlayer(ENEMY_BULLET_DAMAGE);
    });

    // The reticle replaces the OS cursor. It lives in screen space so it never
    // lags behind the mouse while the camera scrolls; right-click is reserved
    // for abilities.
    this.input.setDefaultCursor('none');
    this.input.mouse?.disableContextMenu();
    this.reticle = this.add.image(0, 0, 'reticle').setScrollFactor(0).setDepth(100);

    this.buildHud();

    this.input.keyboard?.on('keydown-F9', () => {
      clearSave(getStorage());
      this.scene.restart();
    });
  }

  update(time: number): void {
    if (this.deathPending) {
      this.deathPending = false;
      this.handleDeath();
    }

    // Refresh the pointer's world position every frame; it goes stale while the
    // camera scrolls under a stationary mouse.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    const target = { x: pointer.worldX, y: pointer.worldY };

    this.reticle.setPosition(pointer.x, pointer.y);
    this.player.tick(time, target);
    // Blink while invulnerable so the i-frames are readable.
    this.player.setAlpha(isInvulnerable(this.health, time) && Math.floor(time / 80) % 2 === 0 ? 0.35 : 1);

    if (pointer.leftButtonDown() && time >= this.nextShotAt) {
      this.nextShotAt = time + FIRE_INTERVAL_MS;
      this.fire(target);
    }

    this.tickEnemies(time);
    this.checkCheckpoints();
    this.checkPickups();
    this.refreshBossBar();
    if (this.player.y > this.mapHeightPx + FALL_MARGIN) this.handleDeath();
  }

  // ---- run state ---------------------------------------------------------

  private initialRunState(): RunState {
    const save = loadSave(getStorage());
    const resumable =
      save !== null &&
      save.levelId === LEVEL_ID &&
      this.level.checkpoints.some((cp) => cp.id === save.checkpointId);
    return resumable ? restoreRun(save) : createRunState();
  }

  private persist(): void {
    writeSave(getStorage(), serializeRun(LEVEL_ID, this.run));
  }

  // ---- level objects -----------------------------------------------------

  private spawnCheckpointsAndPickups(): void {
    for (const cp of this.level.checkpoints) {
      const sprite = this.add
        .image(cp.rect.x + cp.rect.width / 2, cp.rect.y + cp.rect.height, 'checkpoint-off')
        .setOrigin(0.5, 1)
        .setDepth(1);
      this.checkpointSprites.set(cp.id, sprite);
    }
    for (const pickup of this.level.pickups) {
      this.pickupSprites.set(pickup.id, this.add.image(pickup.x, pickup.y, 'pickup').setDepth(2));
    }
    this.syncCheckpoints();
    this.syncPickups();
  }

  private syncCheckpoints(): void {
    for (const cp of this.level.checkpoints) {
      const reached = this.run.checkpointOrder >= cp.order;
      this.checkpointSprites.get(cp.id)?.setTexture(reached ? 'checkpoint-on' : 'checkpoint-off');
    }
  }

  private syncPickups(): void {
    for (const [id, sprite] of this.pickupSprites) sprite.setVisible(!hasCollected(this.run, id));
  }

  private checkCheckpoints(): void {
    const bounds = this.player.getBounds();
    for (const cp of this.level.checkpoints) {
      const zone = checkpointTriggerZone(cp.rect);
      const zoneRect = new Phaser.Geom.Rectangle(zone.x, zone.y, zone.width, zone.height);
      if (!Phaser.Geom.Intersects.RectangleToRectangle(bounds, zoneRect)) continue;
      const next = activateCheckpoint(this.run, cp.id, cp.order);
      if (next === this.run) continue;
      const banked = unsecuredCount(this.run);
      this.run = next;
      this.health = refill(this.health);
      this.persist();
      this.syncCheckpoints();
      this.refreshHud();
      this.toast(banked > 0 ? `Checkpoint reached · ${banked} secured` : 'Checkpoint reached');
    }
  }

  private checkPickups(): void {
    const bounds = this.player.getBounds();
    for (const [id, sprite] of this.pickupSprites) {
      if (!sprite.visible) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(bounds, sprite.getBounds())) continue;
      this.run = collectPickup(this.run, id);
      sprite.setVisible(false);
      this.refreshHud();
    }
  }

  // ---- enemies -----------------------------------------------------------

  /** (Re)creates every enemy that is not currently defeated, at full health. */
  private spawnEnemies(): void {
    this.enemies.clear(true, true);
    this.boss = null;
    for (const def of this.level.enemies) {
      if (isDefeated(this.run, def.id)) continue;
      this.enemies.add(this.createEnemy(def));
    }
  }

  private createEnemy(def: EnemyDef): Enemy {
    if (def.boss) {
      this.boss = new Boss(this, def, getBossStats(def.kind));
      return this.boss;
    }
    const stats = getEnemyStats(def.kind);
    return stats.behavior === 'walker' ? new Walker(this, def, stats) : new Turret(this, def, stats);
  }

  private tickEnemies(time: number): void {
    const ctx: EnemyContext = {
      time,
      player: { x: this.player.x, y: this.player.y },
      fire: (from, dir, speed) => this.fireEnemyBullet(from, dir, speed),
    };
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;
      if (Math.abs(enemy.x - this.player.x) <= ENEMY_ACTIVE_RANGE) enemy.tick(ctx);
      else enemy.idle();
    }
  }

  private fireEnemyBullet(from: Vec2, dir: Vec2, speed: number): void {
    const bullet = this.enemyBullets.get(from.x, from.y) as Bullet | null;
    bullet?.fire(from.x, from.y, dir, speed, ENEMY_BULLET_LIFETIME_MS);
  }

  private onBulletHitsEnemy(a: unknown, b: unknown): void {
    const bullet = a instanceof Bullet ? a : b instanceof Bullet ? b : null;
    const enemy = a instanceof Enemy ? a : b instanceof Enemy ? b : null;
    if (!bullet || !enemy || !bullet.active || !enemy.active) return;
    bullet.kill();
    if (enemy.takeDamage(PLAYER_BULLET_DAMAGE, this.time.now)) this.defeat(enemy);
  }

  private defeat(enemy: Enemy): void {
    this.run = defeatEnemy(this.run, enemy.enemyId);
    if (enemy === this.boss) {
      // Clearing the stage banks everything, so the win cannot be lost afterwards.
      const name = this.boss.displayName;
      this.boss = null;
      this.run = secureAll(this.run);
      this.persist();
      this.killAll(this.enemyBullets);
      this.refreshHud();
      this.showStageClear(name);
    }
    enemy.destroy();
  }

  // ---- player health, death, respawn -------------------------------------

  private damagePlayer(amount: number): void {
    const result = applyDamage(this.health, amount, this.time.now, PLAYER_IFRAMES_MS);
    if (!result.applied) return;
    this.health = result.health;
    this.refreshHud();
    // Deferred to the next update so the physics step finishes before the level resets.
    if (result.dead) this.deathPending = true;
  }

  private handleDeath(): void {
    const lost = unsecuredCount(this.run);
    this.run = die(this.run);
    this.health = refill(this.health);
    this.syncPickups();
    this.killAll(this.bullets);
    this.killAll(this.enemyBullets);
    this.spawnEnemies();

    const point = this.respawnPoint();
    this.player.respawnAt(point.x, point.y);
    this.cameras.main.centerOn(point.x, point.y);
    this.refreshHud();
    this.toast(lost > 0 ? `Rolled back ${lost} unsecured pickup${lost === 1 ? '' : 's'}` : 'Back to checkpoint');
  }

  private killAll(group: Phaser.Physics.Arcade.Group): void {
    for (const child of group.getChildren()) (child as Bullet).kill();
  }

  /** Sprite-centre position that stands on the floor at the latest checkpoint (or spawn). */
  private respawnPoint(): { x: number; y: number } {
    const cp = this.level.checkpoints.find((c) => c.id === this.run.checkpointId);
    if (cp) return { x: cp.rect.x + cp.rect.width / 2, y: cp.rect.y + cp.rect.height - PLAYER_HALF_HEIGHT - 1 };
    return { x: this.level.spawn.x, y: this.level.spawn.y - PLAYER_HALF_HEIGHT - 1 };
  }

  // ---- shooting, HUD -----------------------------------------------------

  private fire(target: { x: number; y: number }): void {
    const origin = this.player.weaponPivot;
    const dir = aimVector(origin, target);
    const x = origin.x + dir.x * 22;
    const y = origin.y + dir.y * 22;
    const bullet = this.bullets.get(x, y) as Bullet | null;
    bullet?.fire(x, y, dir);
  }

  private buildHud(): void {
    const style = { fontFamily: 'monospace', fontSize: '14px', color: '#9aa4bf' };
    this.add
      .text(16, 12, 'A/D move · Space jump · Mouse aim · Left click fire · F9 reset save', style)
      .setScrollFactor(0)
      .setDepth(100);
    this.hud = this.add.text(16, 34, '', style).setScrollFactor(0).setDepth(100);
    this.add.text(16, 56, 'HP', style).setScrollFactor(0).setDepth(100);
    this.healthPips = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.bossBar = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.bossLabel = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 46, '', { ...style, color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshHud();

    const bossDef = this.level.enemies.find((e) => e.boss);
    if (bossDef && isDefeated(this.run, bossDef.id)) this.showStageClear(getBossStats(bossDef.kind).name);
  }

  private refreshHud(): void {
    const unsecured = unsecuredCount(this.run);
    this.hud
      .setText(
        `Secured ${securedCount(this.run)}  ·  Unsecured ${unsecured}  ·  Checkpoint: ${this.run.checkpointId ?? 'start'}`,
      )
      .setColor(unsecured > 0 ? '#ffd166' : '#9aa4bf');

    this.healthPips.clear();
    for (let i = 0; i < this.health.max; i++) {
      this.healthPips.fillStyle(i < this.health.hp ? 0xef476f : 0x2a3042).fillRect(44 + i * 20, 59, 16, 10);
    }
  }

  private refreshBossBar(): void {
    this.bossBar.clear();
    const boss = this.boss;
    if (!boss || !boss.isAwake) {
      this.bossLabel.setText('');
      return;
    }
    const x = (GAME_WIDTH - BOSS_BAR_WIDTH) / 2;
    const y = GAME_HEIGHT - 32;
    this.bossBar.fillStyle(0x2a3042).fillRect(x, y, BOSS_BAR_WIDTH, 12);
    this.bossBar.fillStyle(0xe4572e).fillRect(x, y, Math.round(BOSS_BAR_WIDTH * boss.hpFraction), 12);
    this.bossLabel.setText(`${boss.displayName} · Phase ${boss.phaseNumber}`);
  }

  private showStageClear(bossName: string): void {
    this.add
      .text(GAME_WIDTH / 2, 110, `STAGE CLEAR · ${bossName} defeated`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#7ef7a3',
        backgroundColor: '#000000aa',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
  }

  private toast(message: string): void {
    // One toast at a time so messages never overlap.
    if (this.toastText) {
      this.tweens.killTweensOf(this.toastText);
      this.toastText.destroy();
    }
    const text = this.add
      .text(GAME_WIDTH / 2, 72, message, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);
    this.toastText = text;
    this.tweens.add({
      targets: text,
      alpha: 0,
      delay: 1400,
      duration: 400,
      onComplete: () => {
        text.destroy();
        if (this.toastText === text) this.toastText = undefined;
      },
    });
  }
}
