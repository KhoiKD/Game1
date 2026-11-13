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
  RENDER_SCALE,
} from '../config';
import { balance, creatureName, findFamily, getFamily } from '../data/creatureData';
import { elementRules } from '../data/elementData';
import { getBossStats, getEnemyStats } from '../data/enemyData';
import { resolveWeaponInstance, rollDropFor } from '../data/lootData';
import { getNpc } from '../data/npcData';
import { findClass, getStage, progression } from '../data/progressionData';
import type { ResolvedWeapon, WeaponElement } from '../data/weaponData';
import { Boss } from '../entities/Boss';
import { Charger } from '../entities/Charger';
import { Flyer } from '../entities/Flyer';
import { Hopper } from '../entities/Hopper';
import { Lobber } from '../entities/Lobber';
import { Bullet } from '../entities/Bullet';
import { Enemy, type EnemyContext } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
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
import { computeDamage, rollCrit, statusFor, type DamageResult, type HitProfile } from '../systems/combat';
import { applyDamage, createHealth, isInvulnerable, refill, type Health } from '../systems/health';
import { INVENTORY_CAPACITY, addItem, equippedItems, type Inventory } from '../systems/inventory';
import type { WeaponInstance } from '../systems/loot';
import {
  activateCheckpoint,
  collectPickup,
  addXp,
  defeatEnemy,
  die,
  hasCollected,
  isDefeated,
  secureAll,
  securedCount,
  setInventory,
  setSpirits,
  unsecuredCount,
  unsecuredSpiritCount,
  unsecuredWeaponCount,
  type RunState,
} from '../systems/runState';
import { levelProgress, powerScore, stageLevel, tierRule, withClassAndLevel, type ClassDef } from '../systems/progression';
import { markCleared, profileFromRun, runStateFrom, savedRunFrom } from '../systems/save';
import { getSession, resetSession, saveSession, setProfile, setRun } from '../state/session';
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
import {
  NO_BONUSES,
  activeAbility,
  addKillXp,
  applyBonuses,
  bossPerkMult,
  captureSpirit,
  equippedSpirits,
  levelOf,
  playerBonuses,
  spiritName,
  type ActiveAbility,
  type PlayerBonuses,
  type SpiritCollection,
} from '../systems/spirits';
import { activeStatuses, addBuildup, tickStatus } from '../systems/status';
import { ELEMENT_COLOR, STATUS_COLOR, css } from '../ui/elementColors';
import { capitalize } from '../ui/rarity';
import { createRng, type Rng } from '../util/rng';
import type { InventorySceneData } from './InventoryScene';
import type { SpiritsSceneData } from './SpiritsScene';
import { useDetailCamera } from '../ui/detailCamera';
import { StageArt, releaseOtherStages } from '../art/stageArt';
import { displayScale } from '../art/render';
import { gameEvents } from '../util/events';
import { StageFeedback } from '../art/particles';
import { FloatingText } from '../ui/floatingText';
import type { PauseSceneData } from './PauseScene';
import { applySettings } from '../audio/director';
import { getSettings } from '../state/settings';
import { FrameProbe, SLOW_FRAME_MS } from '../util/frameProbe';

const FRAME_PROBE_WARMUP_MS = 2000;
const FRAME_PROBE_SAMPLE_MS = 2000;

const FALL_MARGIN = 96; // how far below the map the player may fall before dying
const PLAYER_HALF_HEIGHT = 32;
const BOSS_BAR_WIDTH = 520;
/** How close to the active checkpoint the player must stand to swap spirits. */
const CHECKPOINT_SWAP_RANGE = 96;

interface HitOptions {
  crit: boolean;
  arc: boolean;
  buildup: boolean;
}
/** A shot from a weapon. */
const DIRECT_HIT: HitOptions = { crit: true, arc: true, buildup: true };
/** Damage caused by a status (burn tick, shock arc): no crit, no chaining, no build-up. */
const STATUS_DAMAGE: HitOptions = { crit: false, arc: false, buildup: false };
const BURN_HIT: HitProfile = { damage: 0, element: 'Ember', critChance: 0, statusBuildup: 0, killRefund: 0, sourceUid: null };
const ARC_HIT: HitProfile = { ...BURN_HIT, element: 'Volt' };
/** Base for spirit abilities; the ability fills in damage and element. */
const ABILITY_HIT: HitProfile = { ...BURN_HIT, statusBuildup: 1 };
/** An ability that exists to inflict a status: builds up, but does not crit or chain. */
const FIELD_HIT: HitOptions = { crit: false, arc: false, buildup: true };

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
  private stageId = 'level1';
  /** Difficulty tier of this run. Scales enemy health and experience, and the boss spirit. */
  private tier = 1;
  private classDef: ClassDef | null = null;
  private classReadyAt = 0;
  private classHud!: Phaser.GameObjects.Text;
  private classHudText = '';
  /** Leaving mid-stage needs a second Esc before this time. */
  private leaveArmedUntil = 0;
  /** Perks from the equipped spirits, applied to weapons, speed, and health. */
  private bonuses: PlayerBonuses = NO_BONUSES;
  private ability: ActiveAbility | null = null;
  private abilityReadyAt = 0;
  /** Clicks queued by pointer events, so a tap shorter than one frame still counts. */
  private pendingFire = false;
  private pendingAbility = false;
  private spiritHud!: Phaser.GameObjects.Text;
  private spiritHudText = '';
  private captureGfx!: Phaser.GameObjects.Graphics;
  private capturePrompt!: Phaser.GameObjects.Text;
  private weaponIndex = 0;
  private weaponHud!: Phaser.GameObjects.Text;
  private weaponHudText = '';
  /** Swap and reload presses queued by key events, consumed once per frame. */
  private pendingSwap = 0;
  private pendingReload = false;
  private rng: Rng = createRng(1);
  private deathPending = false;
  private npcs: Npc[] = [];
  /** Boss phase last announced; 0 before the fight starts. */
  private bossPhaseShown = 0;
  /** Detailed ground, parallax backdrop, and shadows. */
  private stageArt!: StageArt;
  /** Particles, shake, and other hit feedback. */
  private feedback!: StageFeedback;
  /** Auto quality measures frame time once per stage visit. */
  private frameProbe = new FrameProbe(FRAME_PROBE_WARMUP_MS, FRAME_PROBE_SAMPLE_MS);
  private floating!: FloatingText;
  private readonly pickupSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly checkpointSprites = new Map<string, Phaser.GameObjects.Image>();
  private toastText?: Phaser.GameObjects.Text;

  constructor() {
    super('Level');
  }

  init(data: { stageId?: string; tier?: number }): void {
    const saved = getSession().run;
    this.stageId = data.stageId ?? saved?.stageId ?? progression.stages[0]!.id;
    this.tier = data.tier ?? saved?.tier ?? 1;
  }

  create(): void {
    this.classDef = findClass(getSession().profile.classId);
    this.classReadyAt = 0;
    this.classHudText = '';
    this.leaveArmedUntil = 0;
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
    this.abilityReadyAt = 0;
    this.pendingFire = false;
    this.pendingAbility = false;
    this.spiritHudText = '';
    this.weaponHudText = '';
    this.pendingSwap = 0;
    this.pendingReload = false;
    this.rng = createRng(Date.now());
    this.bossPhaseShown = 0;
    gameEvents.emit('music', { track: this.stageId });

    const map = this.make.tilemap({ key: getStage(this.stageId).map });
    const tileset = map.addTilesetImage('tiles', 'tiles');
    if (!tileset) throw new Error('Tileset "tiles" not found in level1');
    const ground = map.createLayer('ground', tileset, 0, 0);
    if (!ground) throw new Error('Tile layer "ground" not found in level1');
    ground.setCollisionByExclusion([-1]);
    releaseOtherStages(this, this.stageId);
    this.stageArt = new StageArt(this, this.stageId, ground);
    this.frameProbe = new FrameProbe(FRAME_PROBE_WARMUP_MS, FRAME_PROBE_SAMPLE_MS);
    this.applyDetail();

    this.mapHeightPx = map.heightInPixels;
    // Solid on the left, right, and top; open at the bottom so pits are fatal.
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels + FALL_MARGIN * 4);
    this.physics.world.setBoundsCollision(true, true, true, false);
    const camera = useDetailCamera(this);
    camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const rawObjects = (map.getObjectLayer('objects')?.objects ?? []) as unknown as RawObject[];
    this.level = parseLevelObjects(rawObjects);

    this.run = this.initialRunState();
    this.refreshBonuses(true);
    this.rebuildLoadout(true);
    this.health = createHealth(PLAYER_MAX_HP + this.bonuses.maxHpBonus);
    this.spawnCheckpointsAndPickups();
    this.npcs = this.level.npcs.map((placement) => {
      const def = getNpc(placement.npc);
      return new Npc(this, placement.x, placement.y, placement.npc, def, def.lines[this.stageId] ?? []);
    });

    const start = this.respawnPoint();
    this.player = new Player(this, start.x, start.y, getSession().profile.classId);
    this.player.speedMult = this.bonuses.moveSpeedMult;
    this.physics.add.collider(this.player, ground);
    this.stageArt.addShadow(this.player, 26);
    for (const npc of this.npcs) this.stageArt.addShadow(npc, 26);
    this.syncWeaponLook();
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
      if (enemy?.active && !enemy.isWeakened) this.damagePlayer(enemy.contactDamage);
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
    this.reticle = this.add.image(0, 0, 'reticle').setScrollFactor(0).setDepth(100).setScale(displayScale('reticle'));
    this.floating = new FloatingText(this);
    this.feedback = new StageFeedback(this, this.player, this.reticle);
    this.cameras.main.fadeIn(300, 0, 0, 0);

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
    onPress('C', () => this.openSpirits());
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 2) this.pendingAbility = true;
      else if (pointer.button === 0) this.pendingFire = true;
    });
    onPress('F', () => this.tryCapture());
    keyboard.addCapture('TAB');
    onPress('TAB', () => this.openInventory());

    this.buildHud();

    onPress('SHIFT', () => this.useClassAbility());
    onPress('ESC', () => this.requestLeave());
    onPress('P', () => this.openPause());
    onPress('F9', () => {
      resetSession();
      this.scene.start('Boot');
    });
  }

  update(time: number, delta: number): void {
    if (this.deathPending) {
      this.deathPending = false;
      this.handleDeath();
    }

    // Refresh the pointer's world position every frame; it goes stale while the
    // camera scrolls under a stationary mouse.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    const target = { x: pointer.worldX, y: pointer.worldY };

    this.reticle.setPosition(pointer.x / RENDER_SCALE, pointer.y / RENDER_SCALE);
    this.stageArt.update();
    this.feedback.update(time);
    this.probeFrameRate(time, delta);
    this.player.tick(time, target);
    // Blink while invulnerable so the i-frames are readable.
    this.player.setAlpha(isInvulnerable(this.health, time) && Math.floor(time / 80) % 2 === 0 ? 0.35 : 1);

    this.tickWeapon(time, pointer.leftButtonDown() || this.pendingFire, target);
    this.pendingFire = false;
    if (this.pendingAbility) this.useAbility(time, target);
    this.pendingAbility = false;

    this.tickEnemies(time);
    this.checkCheckpoints();
    this.checkPickups();
    this.checkLoot();
    for (const npc of this.npcs) npc.tick(time, { x: this.player.x, y: this.player.y });
    this.refreshBossBar();
    this.drawCapturePrompts(time);
    this.refreshSpiritHud(time);
    this.refreshClassHud(time);
    if (this.player.y > this.mapHeightPx + FALL_MARGIN) this.handleDeath();
  }

  // ---- run state ---------------------------------------------------------

  private initialRunState(): RunState {
    // Resume at the saved checkpoint only if it belongs to this stage and tier.
    const session = getSession();
    const saved = session.run;
    const resumable =
      saved !== null &&
      saved.stageId === this.stageId &&
      saved.tier === this.tier &&
      this.level.checkpoints.some((cp) => cp.id === saved.checkpointId);
    return runStateFrom(session.profile, resumable ? saved : null);
  }

  private persist(): void {
    // Only banked progress is saved: the profile keeps secured weapons, spirits, and experience.
    setProfile(profileFromRun(getSession().profile, this.run));
    setRun(savedRunFrom(this.stageId, this.tier, this.run));
    saveSession();
  }

  // ---- level objects -----------------------------------------------------

  private spawnCheckpointsAndPickups(): void {
    for (const cp of this.level.checkpoints) {
      const sprite = this.add
        .image(cp.rect.x + cp.rect.width / 2, cp.rect.y + cp.rect.height, 'checkpoint-off')
        .setOrigin(0.5, 1)
        .setScale(displayScale('checkpoint-off'))
        .setDepth(1);
      this.checkpointSprites.set(cp.id, sprite);
    }
    for (const pickup of this.level.pickups) {
      this.pickupSprites.set(pickup.id, this.add.image(pickup.x, pickup.y, 'pickup').setDepth(2).setScale(displayScale('pickup')));
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
      gameEvents.emit('checkpoint', { x: this.player.x, y: this.player.y });
    }
  }

  private checkPickups(): void {
    const bounds = this.player.getBounds();
    for (const [id, sprite] of this.pickupSprites) {
      if (!sprite.visible) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(bounds, sprite.getBounds())) continue;
      this.run = collectPickup(this.run, id);
      sprite.setVisible(false);
      gameEvents.emit('pickup', { x: sprite.x, y: sprite.y });
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
      const enemy = this.createEnemy(def);
      this.enemies.add(enemy);
      this.stageArt.addShadow(enemy);
    }
  }

  private createEnemy(def: EnemyDef): Enemy {
    // Higher tiers bring creatures at a later evolution stage and a tougher boss.
    const tier = tierRule(this.tier, progression);
    if (def.boss) {
      this.boss = new Boss(this, def, getBossStats(def.kind, tier.bossHpMult));
      return this.boss;
    }
    const stats = getEnemyStats(def.kind, tier.stageBonus);
    switch (stats.behavior) {
      case 'walker':
        return new Walker(this, def, stats);
      case 'turret':
        return new Turret(this, def, stats);
      case 'hopper':
        return new Hopper(this, def, stats);
      case 'flyer':
        return new Flyer(this, def, stats);
      case 'charger':
        return new Charger(this, def, stats);
      case 'lobber':
        return new Lobber(this, def, stats);
    }
  }

  private tickEnemies(time: number): void {
    const ctx: EnemyContext = {
      time,
      player: { x: this.player.x, y: this.player.y },
      rng: this.rng,
      fire: (from, dir, speed, gravity) => this.fireEnemyBullet(from, dir, speed, gravity),
    };
    // Copy the list: burn damage can defeat an enemy and remove it mid-loop.
    for (const child of [...this.enemies.getChildren()]) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;
      if (enemy.isWeakened) {
        // The capture window closed: it is defeated the ordinary way and drops loot.
        if (time >= enemy.weakenedUntil) this.defeat(enemy);
        else enemy.tick(ctx);
        continue;
      }
      const ticked = tickStatus(enemy.status, time, elementRules);
      enemy.status = ticked.state;
      if (ticked.burnDamage > 0) {
        this.hitEnemy(enemy, { ...BURN_HIT, damage: ticked.burnDamage }, STATUS_DAMAGE);
        if (!enemy.active) continue;
      }
      if (Math.abs(enemy.x - this.player.x) <= ENEMY_ACTIVE_RANGE) enemy.tick(ctx);
      else enemy.idle();
    }
  }

  private fireEnemyBullet(from: Vec2, dir: Vec2, speed: number, gravity = 0): void {
    const bullet = this.enemyBullets.get(from.x, from.y) as Bullet | null;
    bullet?.fire(from.x, from.y, dir, { speed, lifetimeMs: ENEMY_BULLET_LIFETIME_MS, gravity });
  }

  private onBulletHitsEnemy(a: unknown, b: unknown): void {
    const bullet = a instanceof Bullet ? a : b instanceof Bullet ? b : null;
    const enemy = a instanceof Enemy ? a : b instanceof Enemy ? b : null;
    if (!bullet || !enemy || !bullet.active || !enemy.active) return;
    if (enemy.isWeakened) return; // shots pass through a creature waiting to be captured
    // A piercing shot overlaps the same enemy for several frames; hit it once.
    if (!bullet.registerHit(enemy.enemyId)) return;
    if (bullet.blastRadius > 0) {
      this.explode(bullet);
      bullet.kill();
      return;
    }
    const hit = bullet.hit;
    if (!bullet.consumePierce()) bullet.kill();
    this.hitEnemy(enemy, hit);
  }

  /**
   * The single path for damaging an enemy: element matchup, crit, status
   * build-up, shock arcs, damage numbers, and defeat.
   */
  private hitEnemy(enemy: Enemy, hit: HitProfile, options: HitOptions = DIRECT_HIT): void {
    if (!enemy.active || enemy.hp <= 0) return;
    const time = this.time.now;
    const result = computeDamage(
      {
        base: hit.damage,
        attackElement: hit.element,
        targetElement: enemy.element,
        crit: options.crit && rollCrit(hit.critChance, this.rng),
        damageTakenMult: enemy.mods.damageTakenMult,
      },
      elementRules,
    );
    const defeated = enemy.takeDamage(result.amount, time);
    this.showDamage(enemy, result);
    if (options.crit) {
      const effect = result.effectiveness === 'weak' ? 'resisted' : result.effectiveness;
      gameEvents.emit('enemyHit', { x: enemy.x, y: enemy.y, element: hit.element, crit: result.crit, effect });
    }

    // An enemy is immune to the status of its own element.
    const status = statusFor(hit.element, elementRules);
    if (!defeated && options.buildup && status && status !== statusFor(enemy.element, elementRules)) {
      const built = addBuildup(
        enemy.status,
        status,
        result.amount * hit.statusBuildup,
        time,
        elementRules,
        enemy.statusResistance,
      );
      enemy.status = built.state;
      if (built.applied) {
        this.floatText(enemy.x, enemy.y - enemy.displayHeight / 2 - 24, status.toUpperCase(), css(STATUS_COLOR[status]), 14);
      }
    }

    // Shocked: part of every hit arcs to enemies nearby.
    if (options.arc && enemy.mods.arcFraction > 0) {
      const arcHit: HitProfile = { ...ARC_HIT, damage: result.amount * enemy.mods.arcFraction };
      for (const child of [...this.enemies.getChildren()]) {
        const other = child as Enemy;
        if (other === enemy || !other.active) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) > enemy.mods.arcRadius) continue;
        this.drawArc(enemy, other);
        this.hitEnemy(other, arcHit, STATUS_DAMAGE);
      }
    }

    if (defeated) {
      this.refundAmmo(hit);
      if (enemy.creature) this.weaken(enemy);
      else this.defeat(enemy);
    }
  }

  /** Scavenger-style perks: a kill puts part of the magazine back. */
  private refundAmmo(hit: HitProfile): void {
    if (hit.killRefund <= 0 || hit.sourceUid === null) return;
    const index = this.weaponUids.indexOf(hit.sourceUid);
    const weapon = this.weapons[index];
    const state = this.weaponStates[index];
    if (!weapon || !state || isReloading(state)) return;
    const refund = Math.max(1, Math.round(weapon.magazine * hit.killRefund));
    this.weaponStates[index] = { ...state, ammo: Math.min(weapon.magazine, state.ammo + refund) };
  }

  private showDamage(enemy: Enemy, result: DamageResult): void {
    const amount = result.amount >= 10 ? Math.round(result.amount) : Number(result.amount.toFixed(1));
    let color = '#ffffff';
    if (result.effectiveness === 'strong') color = '#ffb347';
    if (result.effectiveness === 'weak') color = '#8b93a8';
    const text = `${amount}${result.crit ? '!' : ''}`;
    const x = enemy.x + (this.rng() * 2 - 1) * 12;
    this.floatText(x, enemy.y - enemy.displayHeight / 2 - 8, text, result.crit ? '#fff275' : color, result.crit ? 16 : 13);
  }

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    this.floating.show(x, y, text, color, size);
  }

  private drawArc(from: Enemy, to: Enemy): void {
    const line = this.add.graphics().setDepth(4);
    line.lineStyle(2, ELEMENT_COLOR.Volt, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    this.tweens.add({ targets: line, alpha: 0, duration: 160, onComplete: () => line.destroy() });
  }

  /** Damages every enemy within the projectile's blast radius. */
  private explode(bullet: Bullet): void {
    const { x, y, blastRadius, hit } = bullet;
    // Copy the list: defeated enemies are removed from the group while we loop.
    for (const child of [...this.enemies.getChildren()]) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;
      const reach = blastRadius + Math.max(enemy.displayWidth, enemy.displayHeight) / 2;
      if (Math.hypot(enemy.x - x, enemy.y - y) > reach) continue;
      this.hitEnemy(enemy, hit);
    }
    gameEvents.emit('explosion', { x, y, radius: blastRadius, element: hit.element });
    const flash = this.add.graphics().setDepth(4);
    flash.fillStyle(0xffb347, 0.55).fillCircle(x, y, blastRadius);
    this.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: () => flash.destroy() });
  }

  /** Zero health: a capturable creature staggers for its capture window instead of dying. */
  private weaken(enemy: Enemy): void {
    const time = this.time.now;
    const isBoss = enemy === this.boss;
    const rarity = enemy.creature ? getFamily(enemy.creature.family).rarity : 'common';
    const windowMs = isBoss ? balance.capture.bossWindowMs : balance.capture.windowMs[rarity];
    enemy.weaken(time, time + windowMs);
    if (isBoss) this.killAll(this.enemyBullets);
    this.floatText(enemy.x, enemy.y - enemy.displayHeight / 2 - 24, 'WEAKENED', '#ffffff', 14);
    gameEvents.emit('weakened', { x: enemy.x, y: enemy.y, boss: isBoss });
  }

  /** F: capture the nearest weakened creature in range. */
  private tryCapture(): void {
    const target = this.captureTarget();
    if (!target || !target.inRange) return;
    const enemy = target.enemy;
    const ref = enemy.creature;
    if (!ref) return;
    const family = getFamily(ref.family);
    const perkMult = enemy === this.boss ? bossPerkMult(stageLevel(this.stageId, this.tier, progression), balance) : 1;
    const result = captureSpirit(this.run.spirits, family, ref.stage, perkMult, balance);
    this.applySpirits(result.collection);

    const name = creatureName(ref);
    const parts = [result.isNew ? `Captured ${name}` : `Captured ${name} · your spirit grew`];
    if (result.evolved) parts.push('it evolved');
    for (const element of result.slotsUnlocked) parts.push(`new ${element} slot`);
    this.toast(parts.join(' · '));
    this.floatText(enemy.x, enemy.y - enemy.displayHeight / 2 - 24, 'CAPTURED', css(ELEMENT_COLOR[family.elements[0]!]), 16);
    gameEvents.emit('captured', { x: enemy.x, y: enemy.y, element: family.elements[0]!, boss: enemy === this.boss });
    // A captured creature leaves its spirit instead of loot.
    this.defeat(enemy, false);
  }

  /** The nearest weakened creature and whether the player is close enough to capture it. */
  private captureTarget(): { enemy: Enemy; inRange: boolean } | null {
    let best: { enemy: Enemy; distance: number } | null = null;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || !enemy.isWeakened) continue;
      const distance = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (!best || distance < best.distance) best = { enemy, distance };
    }
    if (!best) return null;
    const range = best.enemy === this.boss ? balance.capture.bossRange : balance.capture.range;
    return { enemy: best.enemy, inRange: best.distance <= range };
  }

  private drawCapturePrompts(time: number): void {
    this.captureGfx.clear();
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || !enemy.isWeakened) continue;
      const width = Math.max(36, enemy.displayWidth);
      const x = enemy.x - width / 2;
      const y = enemy.y - enemy.displayHeight / 2 - 22;
      this.captureGfx.fillStyle(0x2a3042).fillRect(x, y, width, 4);
      this.captureGfx.fillStyle(0xffffff).fillRect(x, y, width * enemy.captureWindowLeft(time), 4);
      // A ring that closes in as the capture window runs out.
      const left = enemy.captureWindowLeft(time);
      const radius = Math.max(enemy.displayWidth, enemy.displayHeight) / 2 + 6 + left * 14;
      this.captureGfx.lineStyle(2, 0xffffff, 0.35 + 0.5 * (1 - left)).strokeCircle(enemy.x, enemy.y, radius);
    }
    const target = this.captureTarget();
    if (!target || !target.enemy.creature) {
      this.capturePrompt.setVisible(false);
      return;
    }
    const { enemy, inRange } = target;
    this.capturePrompt
      .setText(inRange ? `F  capture ${creatureName(target.enemy.creature)}` : 'Get closer to capture')
      .setColor(inRange ? '#ffffff' : '#9aa4bf')
      .setPosition(enemy.x, enemy.y - enemy.displayHeight / 2 - 38)
      .setVisible(true);
  }

  // ---- spirits -----------------------------------------------------------

  /** Every change to the spirit collection goes through here. */
  private applySpirits(spirits: SpiritCollection): void {
    if (spirits === this.run.spirits) return;
    this.run = setSpirits(this.run, spirits);
    if (this.stageCleared) {
      this.run = secureAll(this.run);
      this.persist();
    }
    this.refreshBonuses(false);
    this.refreshHud();
  }

  /** Recomputes what the equipped spirits give and applies it to speed, health, and weapons. */
  private refreshBonuses(force: boolean): void {
    const next = withClassAndLevel(
      playerBonuses(this.run.spirits, findFamily, balance),
      this.classDef,
      this.playerLevel(),
      progression,
    );
    const ability = activeAbility(this.run.spirits, findFamily, balance);
    const classCooldown = this.classDef?.passive.spiritCooldownMult ?? 1;
    this.ability = ability ? { ...ability, cooldownMs: ability.cooldownMs * classCooldown } : null;
    this.spiritHudText = '';
    if (!force && JSON.stringify(next) === JSON.stringify(this.bonuses)) return;
    const hpGain = next.maxHpBonus - this.bonuses.maxHpBonus;
    this.bonuses = next;
    if (force) return; // the caller sets up health and weapons itself
    this.player.speedMult = next.moveSpeedMult;
    const max = PLAYER_MAX_HP + next.maxHpBonus;
    this.health = { ...this.health, max, hp: Math.min(max, this.health.hp + Math.max(0, hpGain)) };
    this.rebuildLoadout(false);
  }

  /** Equipped spirits grow a little with every kill. */
  private grantKillXp(): void {
    const result = addKillXp(this.run.spirits, findFamily, balance);
    this.applySpirits(result.collection);
    for (const name of result.evolved) this.toast(`Your spirit evolved into ${name}`);
  }

  private openSpirits(): void {
    if (this.scene.isActive('Spirits') || this.scene.isActive('Inventory')) return;
    const data: SpiritsSceneData = {
      spirits: this.run.spirits,
      canEquip: this.canSwapSpirits(),
      onClose: (spirits) => {
        this.input.setDefaultCursor('none');
        this.applySpirits(spirits);
        this.pendingSwap = 0;
        this.pendingReload = false;
        this.pendingFire = false;
        this.pendingAbility = false;
        this.scene.resume();
      },
    };
    this.scene.launch('Spirits', data);
    this.scene.pause();
  }

  /** Spirits are swapped at a checkpoint, not mid-fight. After the stage is cleared, anywhere. */
  private canSwapSpirits(): boolean {
    if (this.stageCleared) return true;
    const cp = this.level.checkpoints.find((c) => c.id === this.run.checkpointId);
    return cp !== undefined && Math.abs(this.player.x - (cp.rect.x + cp.rect.width / 2)) <= CHECKPOINT_SWAP_RANGE;
  }

  /** Right click: the signature ability of the spirit in the first slot. */
  private useAbility(time: number, target: Vec2): void {
    const ability = this.ability;
    if (!ability || time < this.abilityReadyAt) return;
    this.abilityReadyAt = time + ability.cooldownMs;
    gameEvents.emit('ability', { x: this.player.x, y: this.player.y, kind: ability.effect });
    const rules = balance.abilities;
    const color = ELEMENT_COLOR[ability.element];
    const hit: HitProfile = { ...ABILITY_HIT, element: ability.element };
    const enemiesNear = (x: number, y: number, radius: number): Enemy[] =>
      ([...this.enemies.getChildren()] as Enemy[]).filter(
        (enemy) => enemy.active && Math.hypot(enemy.x - x, enemy.y - y) <= radius + Math.max(enemy.displayWidth, enemy.displayHeight) / 2,
      );
    const flash = (x: number, y: number, radius: number): void => {
      const ring = this.add.graphics().setDepth(4);
      ring.fillStyle(color, 0.35).fillCircle(x, y, radius);
      this.tweens.add({ targets: ring, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
    };

    switch (ability.effect) {
      case 'burst': {
        const damage = ability.stats.power * rules.burst.damagePerPower;
        flash(this.player.x, this.player.y, rules.burst.radius);
        for (const enemy of enemiesNear(this.player.x, this.player.y, rules.burst.radius)) {
          this.hitEnemy(enemy, { ...hit, damage }, STATUS_DAMAGE);
        }
        break;
      }
      case 'bolt': {
        const origin = this.player.weaponPivot;
        const angle = aimAngle(origin, target);
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const bullet = this.bullets.get(origin.x, origin.y) as Bullet | null;
        bullet?.fire(origin.x + dir.x * MUZZLE_OFFSET, origin.y + dir.y * MUZZLE_OFFSET, dir, {
          speed: rules.bolt.speed,
          lifetimeMs: (rules.bolt.range / rules.bolt.speed) * 1000,
          pierce: rules.bolt.pierce,
          texture: this.shotTexture('charge-shot', hit.element),
          hit: { ...hit, damage: ability.stats.power * rules.bolt.damagePerPower },
        });
        break;
      }
      case 'shield': {
        const durationMs = rules.shield.baseMs + ability.stats.vitality * rules.shield.msPerVitality;
        this.health = { ...this.health, invulnerableUntil: Math.max(this.health.invulnerableUntil, time + durationMs) };
        flash(this.player.x, this.player.y, 44);
        break;
      }
      case 'heal': {
        const amount = Math.max(1, Math.floor(rules.heal.baseHp + ability.stats.vitality * rules.heal.hpPerVitality));
        this.health = { ...this.health, hp: Math.min(this.health.max, this.health.hp + amount) };
        this.refreshHud();
        flash(this.player.x, this.player.y, 44);
        break;
      }
      case 'field': {
        flash(target.x, target.y, rules.field.radius);
        // Enough build-up to start the status on anything that is not immune.
        const fieldHit: HitProfile = { ...hit, damage: rules.field.damage, statusBuildup: 1000 };
        for (const enemy of enemiesNear(target.x, target.y, rules.field.radius)) {
          this.hitEnemy(enemy, fieldHit, FIELD_HIT);
        }
        break;
      }
    }
    this.floatText(this.player.x, this.player.y - 52, ability.name, css(color), 14);
  }

  // ---- class, level, and leaving the stage ---------------------------------

  private playerLevel(): number {
    return levelProgress(this.run.xp, progression).level;
  }

  /** Experience for a defeated or captured enemy, scaled by the tier. */
  private grantXp(enemy: Enemy): void {
    const base = enemy.xp;
    const before = this.playerLevel();
    this.run = addXp(this.run, Math.round(base * tierRule(this.tier, progression).xpMult));
    if (this.stageCleared) {
      this.run = secureAll(this.run);
      this.persist();
    }
    const after = this.playerLevel();
    if (after > before) {
      this.toast(`Level ${after}`);
      this.refreshBonuses(false);
    }
    this.refreshHud();
  }

  /** Shift: the class ability. */
  private useClassAbility(): void {
    const def = this.classDef;
    const time = this.time.now;
    if (!def || time < this.classReadyAt) return;
    const ability = def.ability;
    this.classReadyAt = time + ability.cooldownMs;
    gameEvents.emit('ability', { x: this.player.x, y: this.player.y, kind: ability.effect });
    const guard = (durationMs: number): void => {
      this.health = { ...this.health, invulnerableUntil: Math.max(this.health.invulnerableUntil, time + durationMs) };
    };
    switch (ability.effect) {
      case 'guard':
        guard(ability.durationMs ?? 0);
        break;
      case 'dash': {
        const direction = this.player.moveDirection || this.player.facing;
        this.player.dash(direction, ability.speed ?? 0, ability.durationMs ?? 0, time);
        this.feedback.puff(this.player.x, this.player.y + 30);
        guard((ability.durationMs ?? 0) + 100);
        break;
      }
      case 'stasis': {
        const radius = ability.radius ?? 0;
        const ring = this.add.graphics().setDepth(4);
        ring.fillStyle(ELEMENT_COLOR.Gale, 0.3).fillCircle(this.player.x, this.player.y, radius);
        this.tweens.add({ targets: ring, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
        const slowHit: HitProfile = { ...ABILITY_HIT, element: 'Gale', damage: 0.25, statusBuildup: 1000 };
        for (const child of [...this.enemies.getChildren()]) {
          const enemy = child as Enemy;
          if (enemy.active && Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y) <= radius) {
            this.hitEnemy(enemy, slowHit, FIELD_HIT);
          }
        }
        break;
      }
    }
    this.floatText(this.player.x, this.player.y - 52, ability.name, '#ffffff', 14);
  }

  /** Esc: back to the hub. Mid-stage it takes two presses, because anything at risk is lost. */
  private requestLeave(): void {
    const time = this.time.now;
    if (!this.stageCleared && time > this.leaveArmedUntil) {
      this.leaveArmedUntil = time + 3000;
      this.toast('Press Esc again to leave for the hub · anything at risk is lost');
      return;
    }
    this.leaveToHub();
  }

  /** Back to the hub; mid-stage, anything not secured at a checkpoint is lost. */
  private leaveToHub(): void {
    if (!this.stageCleared) this.run = die(this.run);
    setProfile(profileFromRun(getSession().profile, this.run));
    setRun(null);
    saveSession();
    this.input.setDefaultCursor('default');
    this.scene.start('Hub');
  }

  private refreshClassHud(time: number): void {
    const progress = levelProgress(this.run.xp, progression);
    const xp = progress.needed > 0 ? `XP ${progress.into}/${progress.needed}` : 'max level';
    const power = powerScore(this.run.inventory, progress.level, progression);
    let text = `Level ${progress.level} · ${xp} · Power ${power} · ${tierRule(this.tier, progression).name}`;
    if (this.classDef) {
      const wait = Math.max(0, this.classReadyAt - time);
      const ready = wait === 0 ? 'ready' : `${(wait / 1000).toFixed(1)}s`;
      text = `${this.classDef.name} ${text} · ${this.classDef.ability.name} (Shift) ${ready}`;
    }
    if (text === this.classHudText) return;
    this.classHudText = text;
    this.classHud.setText(text);
  }

  private refreshSpiritHud(time: number): void {
    const first = equippedSpirits(this.run.spirits, balance)[0];
    let text = 'No spirit · weaken a creature, then press F beside it to capture';
    if (first && this.ability) {
      const family = getFamily(first.familyId);
      const wait = Math.max(0, this.abilityReadyAt - time);
      const ready = wait === 0 ? 'ready' : `${(wait / 1000).toFixed(1)}s`;
      const count = equippedSpirits(this.run.spirits, balance).length;
      text = `Spirit ${spiritName(first, family, balance)} Lv ${levelOf(first, balance)}${count > 1 ? ` +${count - 1}` : ''} · ${this.ability.name} (right click) ${ready}`;
    }
    if (text === this.spiritHudText) return;
    this.spiritHudText = text;
    this.spiritHud.setText(text).setColor(first ? '#e6ebf5' : '#586179');
  }

  private defeat(enemy: Enemy, dropLoot = true): void {
    if (dropLoot) gameEvents.emit('defeated', { x: enemy.x, y: enemy.y, element: enemy.element, boss: enemy === this.boss });
    this.run = defeatEnemy(this.run, enemy.enemyId);
    if (dropLoot) this.dropLoot(enemy.dropTable, enemy.x, enemy.y);
    this.grantKillXp();
    this.grantXp(enemy);
    if (enemy === this.boss) {
      // Clearing the stage banks everything, so the win cannot be lost afterwards.
      const name = this.boss.displayName;
      this.boss = null;
      this.run = secureAll(this.run);
      setProfile(markCleared(getSession().profile, this.stageId, this.tier));
      this.persist();
      this.killAll(this.enemyBullets);
      this.refreshHud();
      this.showStageClear(name);
      gameEvents.emit('stageClear', { x: enemy.x, y: enemy.y });
      gameEvents.emit('music', { track: this.stageId });
    }
    enemy.destroy();
  }

  // ---- player health, death, respawn -------------------------------------

  private damagePlayer(amount: number): void {
    const result = applyDamage(this.health, amount, this.time.now, PLAYER_IFRAMES_MS);
    if (!result.applied) return;
    this.health = result.health;
    this.refreshHud();
    gameEvents.emit('playerHurt', { x: this.player.x, y: this.player.y, hpLeft: this.health.hp });
    // Deferred to the next update so the physics step finishes before the level resets.
    if (result.dead) this.deathPending = true;
  }

  private handleDeath(): void {
    gameEvents.emit('playerDied', { x: this.player.x, y: this.player.y });
    gameEvents.emit('music', { track: this.stageId });
    this.bossPhaseShown = 0;
    const lost = unsecuredCount(this.run);
    this.run = die(this.run);
    this.refreshBonuses(true);
    this.player.speedMult = this.bonuses.moveSpeedMult;
    this.health = refill({ ...this.health, max: PLAYER_MAX_HP + this.bonuses.maxHpBonus });
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
    const key = `loot-${instance.rarity}`;
    const sprite = this.add.image(x, y, key).setDepth(2).setScale(displayScale(key));
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
      gameEvents.emit('lootPickup', { x: loot.sprite.x, y: loot.sprite.y, rarity: loot.instance.rarity });
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
    this.weapons = equipped.map((item) => applyBonuses(resolveWeaponInstance(item), this.bonuses));
    this.weaponUids = equipped.map((item) => item.uid);
    this.weaponStates = this.weapons.map((weapon, i) => {
      const kept = previous.get(this.weaponUids[i]!);
      return kept ? holster(kept) : createWeaponState(weapon);
    });
    const sameWeapon = currentUid === undefined ? -1 : this.weaponUids.indexOf(currentUid);
    this.weaponIndex = sameWeapon !== -1 ? sameWeapon : Math.min(this.weaponIndex, Math.max(0, this.weapons.length - 1));
    this.weaponHudText = '';
    this.syncWeaponLook();
  }

  /** Backdrop detail from the settings (see Settings.quality). */
  private applyDetail(): void {
    const s = getSettings();
    this.stageArt.setDetail(s.quality === 'high' || (s.quality === 'auto' && !s.autoLowRes));
  }

  /**
   * Auto quality: after a short warm-up, average the frame time; if frames run
   * slow, drop the scenery layer now and draw at 1x from the next load.
   */
  private probeFrameRate(time: number, delta: number): void {
    const average = this.frameProbe.sample(time, delta);
    if (average === null) return;
    const settings = getSettings();
    if (settings.quality !== 'auto' || settings.autoLowRes || average <= SLOW_FRAME_MS) return;
    applySettings({ ...settings, autoLowRes: true });
    this.applyDetail();
    this.toast('Lowered detail for smoother play · change it in the pause menu (P)');
  }

  private openPause(): void {
    if (this.scene.isActive('Inventory') || this.scene.isActive('Spirits') || this.scene.isActive('Pause')) return;
    const data: PauseSceneData = {
      atRisk: !this.stageCleared,
      onClose: (choice) => {
        if (choice === 'hub') {
          this.scene.resume();
          this.leaveToHub();
          return;
        }
        this.input.setDefaultCursor('none');
        this.applyDetail();
        this.pendingSwap = 0;
        this.pendingReload = false;
        this.pendingFire = false;
        this.scene.resume();
      },
    };
    this.scene.launch('Pause', data);
    this.scene.pause();
  }

  private openInventory(): void {
    if (this.scene.isActive('Inventory') || this.scene.isActive('Spirits')) return;
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
    const wasReloading = isReloading(this.weaponStates[this.weaponIndex]!);
    const step = stepWeapon(
      this.weaponStates[this.weaponIndex]!,
      weapon,
      { time, triggerDown, reloadPressed },
      this.rng,
    );
    this.weaponStates[this.weaponIndex] = step.state;
    if (!wasReloading && isReloading(step.state)) gameEvents.emit('reload', { x: this.player.x, y: this.player.y });
    if (step.shots.length > 0) {
      const origin = this.player.weaponPivot;
      const aim = aimAngle(origin, target);
      gameEvents.emit('shot', { x: origin.x, y: origin.y, archetype: weapon.archetype, element: step.shots[0]!.element });
      for (const shot of step.shots) this.spawnShot(origin, aim, shot);
    }
    this.refreshWeaponHud(time);
  }

  /** Shows the active weapon in the player's hand. */
  private syncWeaponLook(): void {
    const weapon = this.weapons[this.weaponIndex];
    // On a restart the old, destroyed player lingers until create() makes a new one; skip it.
    if (weapon && this.player?.scene) this.player.setWeapon(weapon.archetype, weapon.element);
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
    this.syncWeaponLook();
    gameEvents.emit('swap', { x: this.player.x, y: this.player.y });
  }

  /** Projectile textures come in every element's colours (see art/effects.ts). */
  private shotTexture(base: string, element: WeaponElement | null): string {
    const key = element && element !== 'kinetic' ? `${base}-${element}` : base;
    return this.textures.exists(key) ? key : base;
  }

  private spawnShot(origin: Vec2, aim: number, shot: Shot): void {
    const angle = aim + shot.angleOffset;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const x = origin.x + dir.x * MUZZLE_OFFSET;
    const y = origin.y + dir.y * MUZZLE_OFFSET;
    const bullet = this.bullets.get(x, y) as Bullet | null;
    bullet?.fire(x, y, dir, {
      speed: shot.speed,
      lifetimeMs: shot.lifetimeMs,
      pierce: shot.pierce,
      gravity: shot.gravity,
      blastRadius: shot.blastRadius,
      texture: this.shotTexture(shot.texture, shot.element),
      hit: {
        damage: shot.damage,
        element: shot.element,
        critChance: shot.critChance,
        statusBuildup: shot.statusBuildup,
        killRefund: shot.killRefund,
        sourceUid: this.weaponUids[this.weaponIndex] ?? null,
      },
    });
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
    // A dark stroke keeps the HUD readable over bright backdrops.
    const style = { fontFamily: 'monospace', fontSize: '14px', color: '#b4bdd6', stroke: '#10131c', strokeThickness: 3 };
    this.add
      .text(16, 12, 'A/D move · Space jump · Click fire · R reload · Q/E swap · F capture · Right click ability · I bag · C spirits', {
        ...style,
        fontSize: '13px',
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.hud = this.add.text(16, 34, '', style).setScrollFactor(0).setDepth(100);
    this.add.text(16, 56, 'HP', style).setScrollFactor(0).setDepth(100);
    this.healthPips = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.weaponHud = this.add.text(16, 78, '', { ...style, color: '#e6ebf5' }).setScrollFactor(0).setDepth(100);
    this.spiritHud = this.add.text(16, 100, '', style).setScrollFactor(0).setDepth(100);
    this.classHud = this.add.text(16, 122, '', style).setScrollFactor(0).setDepth(100);
    this.captureGfx = this.add.graphics().setDepth(5);
    this.capturePrompt = this.add
      .text(0, 0, '', { ...style, color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(51)
      .setVisible(false);
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
    const spirits = unsecuredSpiritCount(this.run);
    const plural = (count: number, word: string): string => (count > 0 ? `${count} ${word}${count === 1 ? '' : 's'}` : '');
    const atRisk =
      [plural(pickups, 'pickup'), plural(weapons, 'weapon'), plural(spirits, 'spirit')].filter(Boolean).join(', ') || 'nothing';
    this.hud
      .setText(
        `Secured ${securedCount(this.run)}  ·  At risk: ${atRisk}  ·  Bag ${this.run.inventory.items.length}/${INVENTORY_CAPACITY}  ·  Checkpoint: ${this.run.checkpointId ?? 'start'}`,
      )
      .setColor(pickups + weapons + spirits > 0 ? '#ffd166' : '#9aa4bf');

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
    if (boss.isWeakened) {
      this.bossLabel.setText(`${boss.displayName} · WEAKENED · press F beside it to capture`);
      return;
    }
    if (this.bossPhaseShown !== boss.phaseNumber) {
      // The fight starts (or moves to a new phase): music and a roar.
      if (this.bossPhaseShown === 0) gameEvents.emit('music', { track: 'boss' });
      else gameEvents.emit('bossPhase', { x: boss.x, y: boss.y, phase: boss.phaseNumber });
      this.bossPhaseShown = boss.phaseNumber;
    }
    const statuses = activeStatuses(boss.status, this.time.now).map((s) => s.toUpperCase());
    this.bossLabel.setText([`${boss.displayName} · Phase ${boss.phaseNumber}`, ...statuses].join(' · '));
  }

  private showStageClear(bossName: string): void {
    this.stageCleared = true;
    this.add
      .text(GAME_WIDTH / 2, 214, `STAGE CLEAR · ${bossName} defeated · Esc returns to the hub`, {
        fontFamily: 'monospace',
        fontSize: '16px',
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
      // Below the HUD lines so a message never covers them.
      .text(GAME_WIDTH / 2, 172, message, {
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
