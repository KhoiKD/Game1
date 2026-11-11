import Phaser from 'phaser';
import {
  ENEMY_ACTIVE_RANGE,
  ENEMY_BULLET_DAMAGE,
  ENEMY_BULLET_LIFETIME_MS,
  GAME_HEIGHT,
  GAME_WIDTH,
  MUZZLE_OFFSET,
  PLAYER_IFRAMES_MS,
  PLAYER_MAX_HP,
} from '../config';
import { getBossStats, getEnemyStats } from '../data/enemyData';
import { resolveWeaponInstance, rollDropFor, sanitizeInventory, starterInventory } from '../data/lootData';
import type { ResolvedWeapon } from '../data/weaponData';
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
import { INVENTORY_CAPACITY, addItem, equippedItems, type Inventory } from '../systems/inventory';
import type { WeaponInstance } from '../systems/loot';
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
  setInventory,
  unsecuredCount,
  unsecuredWeaponCount,
  type RunState,
} from '../systems/runState';
import { clearSave, getStorage, loadSave, restoreRun, serializeRun, writeSave } from '../systems/save';
import {
  chargeFraction,
  createWeaponState,
  draw,
  holster,
  isReloading,
  stepWeapon,
  type Shot,
  type WeaponState,
} from '../systems/weapon';
import { aimAngle, type Vec2 } from '../util/aim';
import { capitalize } from '../ui/rarity';
import { createRng, type Rng } from '../util/rng';
import type { InventorySceneData } from './InventoryScene';

const LEVEL_ID = 'level1';
const FALL_MARGIN = 96; // how far below the map the player may fall before dying
const PLAYER_HALF_HEIGHT = 32;
const BOSS_BAR_WIDTH = 520;

interface GroundLoot {
  sprite: Phaser.GameObjects.Image;
  instance: WeaponInstance;
  /** Set once the "inventory full" message has been shown for this drop. */
  warnedFull: boolean;
}

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
  private weapons: ResolvedWeapon[] = [];
  private weaponStates: WeaponState[] = [];
  /** Uid of the weapon in each loadout position, parallel to `weapons`. */
  private weaponUids: string[] = [];
  private groundLoot: GroundLoot[] = [];
  private stageCleared = false;
  private weaponIndex = 0;
  private weaponHud!: Phaser.GameObjects.Text;
  private weaponHudText = '';
  /** Swap and reload presses queued by key events, consumed once per frame. */
  private pendingSwap = 0;
  private pendingReload = false;
  private rng: Rng = createRng(1);
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
    this.deathPending = false;
    this.weapons = [];
    this.weaponStates = [];
    this.weaponUids = [];
    this.weaponIndex = 0;
    this.groundLoot = [];
    this.stageCleared = false;
    this.weaponHudText = '';
    this.pendingSwap = 0;
    this.pendingReload = false;
    this.rng = createRng(Date.now());

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
    this.rebuildLoadout(true);
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
      maxSize: 128,
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
    this.physics.add.collider(this.bullets, ground, (a, b) => {
      const bullet = a instanceof Bullet ? a : b instanceof Bullet ? b : null;
      if (!bullet?.active) return;
      if (bullet.blastRadius > 0) this.explode(bullet);
      bullet.kill();
    });
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

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    // Key events rather than polling: a tap shorter than one frame still counts.
    const onPress = (key: string, action: () => void): void => {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (!event.repeat) action();
      });
    };
    onPress('E', () => (this.pendingSwap += 1));
    onPress('Q', () => (this.pendingSwap -= 1));
    onPress('R', () => (this.pendingReload = true));
    onPress('I', () => this.openInventory());
    keyboard.addCapture('TAB');
    onPress('TAB', () => this.openInventory());

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

    this.tickWeapon(time, pointer.leftButtonDown(), target);

    this.tickEnemies(time);
    this.checkCheckpoints();
    this.checkPickups();
    this.checkLoot();
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
    const starter = starterInventory();
    if (!resumable) return createRunState(starter);
    // A save can refer to weapons or perks that have since been removed from the data.
    const restored = restoreRun(save, starter);
    const inventory = sanitizeInventory(restored.inventory);
    return { ...restored, inventory, securedInventory: inventory };
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
    bullet?.fire(from.x, from.y, dir, { speed, lifetimeMs: ENEMY_BULLET_LIFETIME_MS });
  }

  private onBulletHitsEnemy(a: unknown, b: unknown): void {
    const bullet = a instanceof Bullet ? a : b instanceof Bullet ? b : null;
    const enemy = a instanceof Enemy ? a : b instanceof Enemy ? b : null;
    if (!bullet || !enemy || !bullet.active || !enemy.active) return;
    // A piercing shot overlaps the same enemy for several frames; hit it once.
    if (!bullet.registerHit(enemy.enemyId)) return;
    if (bullet.blastRadius > 0) {
      this.explode(bullet);
      bullet.kill();
      return;
    }
    if (!bullet.consumePierce()) bullet.kill();
    if (enemy.takeDamage(bullet.damage, this.time.now)) this.defeat(enemy);
  }

  /** Damages every enemy within the projectile's blast radius. */
  private explode(bullet: Bullet): void {
    const { x, y, blastRadius, damage } = bullet;
    // Copy the list: defeated enemies are removed from the group while we loop.
    for (const child of [...this.enemies.getChildren()]) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;
      const reach = blastRadius + Math.max(enemy.width, enemy.height) / 2;
      if (Math.hypot(enemy.x - x, enemy.y - y) > reach) continue;
      if (enemy.takeDamage(damage, this.time.now)) this.defeat(enemy);
    }
    const flash = this.add.graphics().setDepth(4);
    flash.fillStyle(0xffb347, 0.55).fillCircle(x, y, blastRadius);
    this.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: () => flash.destroy() });
  }

  private defeat(enemy: Enemy): void {
    this.run = defeatEnemy(this.run, enemy.enemyId);
    this.dropLoot(enemy.kind, enemy.x, enemy.y);
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
    this.clearGroundLoot();
    this.rebuildLoadout(true);
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

  // ---- loot and inventory ------------------------------------------------

  /** Rolls the drop table for `source` and, if something drops, puts it on the ground. */
  private dropLoot(source: string, x: number, y: number): void {
    const instance = rollDropFor(source, this.rng);
    if (!instance) return;
    const sprite = this.add.image(x, y, `loot-${instance.rarity}`).setDepth(2);
    this.tweens.add({ targets: sprite, y: y - 6, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.groundLoot.push({ sprite, instance, warnedFull: false });
  }

  private checkLoot(): void {
    if (this.groundLoot.length === 0) return;
    const bounds = this.player.getBounds();
    for (const loot of [...this.groundLoot]) {
      if (!Phaser.Geom.Intersects.RectangleToRectangle(bounds, loot.sprite.getBounds())) continue;
      const next = addItem(this.run.inventory, loot.instance);
      if (!next) {
        if (!loot.warnedFull) this.toast('Inventory full · press I to discard a weapon');
        loot.warnedFull = true;
        continue;
      }
      this.applyInventory(next);
      this.removeGroundLoot(loot);
      const weapon = resolveWeaponInstance(loot.instance);
      this.toast(`Picked up ${capitalize(loot.instance.rarity)} ${weapon.name}`);
    }
  }

  private removeGroundLoot(loot: GroundLoot): void {
    this.tweens.killTweensOf(loot.sprite);
    loot.sprite.destroy();
    this.groundLoot = this.groundLoot.filter((other) => other !== loot);
  }

  private clearGroundLoot(): void {
    for (const loot of [...this.groundLoot]) this.removeGroundLoot(loot);
  }

  /** Every inventory change goes through here so the loadout, HUD, and save stay in step. */
  private applyInventory(inventory: Inventory): void {
    if (inventory === this.run.inventory) return;
    this.run = setInventory(this.run, inventory);
    // After the boss is down nothing can be lost any more, so bank changes right away.
    if (this.stageCleared) {
      this.run = secureAll(this.run);
      this.persist();
    }
    this.rebuildLoadout(false);
    this.refreshHud();
  }

  /**
   * Rebuilds the playable weapons from the equipped inventory slots. Weapons
   * that stay equipped keep their ammo unless `reset` is set.
   */
  private rebuildLoadout(reset: boolean): void {
    const currentUid = this.weaponUids[this.weaponIndex];
    const previous = new Map<string, WeaponState>();
    if (!reset) this.weaponUids.forEach((uid, i) => previous.set(uid, this.weaponStates[i]!));

    const equipped = equippedItems(this.run.inventory);
    this.weapons = equipped.map(resolveWeaponInstance);
    this.weaponUids = equipped.map((item) => item.uid);
    this.weaponStates = this.weapons.map((weapon, i) => {
      const kept = previous.get(this.weaponUids[i]!);
      return kept ? holster(kept) : createWeaponState(weapon);
    });
    const sameWeapon = currentUid === undefined ? -1 : this.weaponUids.indexOf(currentUid);
    this.weaponIndex = sameWeapon !== -1 ? sameWeapon : Math.min(this.weaponIndex, Math.max(0, this.weapons.length - 1));
    this.weaponHudText = '';
  }

  private openInventory(): void {
    if (this.scene.isActive('Inventory')) return;
    const data: InventorySceneData = {
      inventory: this.run.inventory,
      onClose: (inventory) => {
        this.input.setDefaultCursor('none');
        this.applyInventory(inventory);
        this.pendingSwap = 0;
        this.pendingReload = false;
        this.scene.resume();
      },
    };
    this.scene.launch('Inventory', data);
    this.scene.pause();
  }

  private tickWeapon(time: number, triggerDown: boolean, target: Vec2): void {
    if (this.weapons.length === 0) return;
    while (this.pendingSwap !== 0) {
      const direction = this.pendingSwap > 0 ? 1 : -1;
      this.swapWeapon(direction, time);
      this.pendingSwap -= direction;
    }
    const reloadPressed = this.pendingReload;
    this.pendingReload = false;

    const weapon = this.weapons[this.weaponIndex]!;
    const step = stepWeapon(
      this.weaponStates[this.weaponIndex]!,
      weapon,
      { time, triggerDown, reloadPressed },
      this.rng,
    );
    this.weaponStates[this.weaponIndex] = step.state;
    if (step.shots.length > 0) {
      const origin = this.player.weaponPivot;
      const aim = aimAngle(origin, target);
      for (const shot of step.shots) this.spawnShot(origin, aim, shot);
    }
    this.refreshWeaponHud(time);
  }

  private swapWeapon(direction: 1 | -1, time: number): void {
    const count = this.weapons.length;
    if (count < 2) return;
    this.weaponStates[this.weaponIndex] = holster(this.weaponStates[this.weaponIndex]!);
    this.weaponIndex = (this.weaponIndex + direction + count) % count;
    this.weaponStates[this.weaponIndex] = draw(
      this.weaponStates[this.weaponIndex]!,
      this.weapons[this.weaponIndex]!,
      time,
    );
  }

  private spawnShot(origin: Vec2, aim: number, shot: Shot): void {
    const angle = aim + shot.angleOffset;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const x = origin.x + dir.x * MUZZLE_OFFSET;
    const y = origin.y + dir.y * MUZZLE_OFFSET;
    const bullet = this.bullets.get(x, y) as Bullet | null;
    bullet?.fire(x, y, dir, shot);
  }

  private refreshWeaponHud(time: number): void {
    const weapon = this.weapons[this.weaponIndex]!;
    const state = this.weaponStates[this.weaponIndex]!;
    let status = `${state.ammo}/${weapon.magazine}`;
    if (isReloading(state)) status = 'RELOADING';
    else if (state.chargeStartedAt !== null) {
      const charge = chargeFraction(state, weapon, time);
      status += charge >= 1 ? '  CHARGED · release to fire' : `  charging ${Math.round(charge * 100)}%`;
    }
    const text = `${this.weaponIndex + 1}/${this.weapons.length}  ${weapon.name} · ${weapon.archetypeLabel} · ${weapon.element}   ${status}`;
    if (text === this.weaponHudText) return;
    this.weaponHudText = text;
    this.weaponHud.setText(text).setColor(isReloading(state) ? '#ffd166' : '#e6ebf5');
  }

  private buildHud(): void {
    const style = { fontFamily: 'monospace', fontSize: '14px', color: '#9aa4bf' };
    this.add
      .text(16, 12, 'A/D move · Space jump · Mouse aim · Click fire · R reload · Q/E swap · I inventory · F9 reset save', style)
      .setScrollFactor(0)
      .setDepth(100);
    this.hud = this.add.text(16, 34, '', style).setScrollFactor(0).setDepth(100);
    this.add.text(16, 56, 'HP', style).setScrollFactor(0).setDepth(100);
    this.healthPips = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.weaponHud = this.add.text(16, 78, '', { ...style, color: '#e6ebf5' }).setScrollFactor(0).setDepth(100);
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
    const pickups = unsecuredCount(this.run);
    const weapons = unsecuredWeaponCount(this.run);
    const atRisk =
      pickups + weapons === 0
        ? 'nothing'
        : [pickups > 0 ? `${pickups} pickup${pickups === 1 ? '' : 's'}` : '', weapons > 0 ? `${weapons} weapon${weapons === 1 ? '' : 's'}` : '']
            .filter(Boolean)
            .join(', ');
    this.hud
      .setText(
        `Secured ${securedCount(this.run)}  ·  At risk: ${atRisk}  ·  Bag ${this.run.inventory.items.length}/${INVENTORY_CAPACITY}  ·  Checkpoint: ${this.run.checkpointId ?? 'start'}`,
      )
      .setColor(pickups + weapons > 0 ? '#ffd166' : '#9aa4bf');

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
    this.stageCleared = true;
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
