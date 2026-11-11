import Phaser from 'phaser';
import { FIRE_INTERVAL_MS, GAME_WIDTH } from '../config';
import { Bullet } from '../entities/Bullet';
import { Player } from '../entities/Player';
import {
  checkpointTriggerZone,
  parseLevelObjects,
  type LevelObjects,
  type RawObject,
} from '../level/parseLevelObjects';
import {
  activateCheckpoint,
  collectPickup,
  createRunState,
  die,
  hasCollected,
  securedCount,
  unsecuredCount,
  type RunState,
} from '../systems/runState';
import { clearSave, getStorage, loadSave, restoreRun, serializeRun, writeSave } from '../systems/save';
import { aimVector } from '../util/aim';

const LEVEL_ID = 'level1';
const FALL_MARGIN = 96; // how far below the map the player may fall before dying
const PLAYER_HALF_HEIGHT = 32;

/** First playable level, loaded from the Tiled map assets/levels/level1.json. */
export class LevelScene extends Phaser.Scene {
  private player!: Player;
  private bullets!: Phaser.Physics.Arcade.Group;
  private reticle!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.Text;
  private level!: LevelObjects;
  private run!: RunState;
  private mapHeightPx = 0;
  private nextShotAt = 0;
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
    this.nextShotAt = 0;

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
    this.physics.add.collider(this.bullets, ground, (bullet) => {
      (bullet as unknown as Bullet).kill();
    });

    // The reticle replaces the OS cursor. It lives in screen space so it never
    // lags behind the mouse while the camera scrolls; right-click is reserved
    // for abilities.
    this.input.setDefaultCursor('none');
    this.input.mouse?.disableContextMenu();
    this.reticle = this.add.image(0, 0, 'reticle').setScrollFactor(0).setDepth(100);

    this.add
      .text(16, 12, 'A/D move · Space jump · Mouse aim · Left click fire · F9 reset save', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9aa4bf',
      })
      .setScrollFactor(0)
      .setDepth(100);
    this.hud = this.add
      .text(16, 34, '', { fontFamily: 'monospace', fontSize: '14px', color: '#9aa4bf' })
      .setScrollFactor(0)
      .setDepth(100);
    this.refreshHud();

    this.input.keyboard?.on('keydown-F9', () => {
      clearSave(getStorage());
      this.scene.restart();
    });
  }

  update(time: number): void {
    // Refresh the pointer's world position every frame; it goes stale while the
    // camera scrolls under a stationary mouse.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    const target = { x: pointer.worldX, y: pointer.worldY };

    this.reticle.setPosition(pointer.x, pointer.y);
    this.player.tick(time, target);

    if (pointer.leftButtonDown() && time >= this.nextShotAt) {
      this.nextShotAt = time + FIRE_INTERVAL_MS;
      this.fire(target);
    }

    this.checkCheckpoints();
    this.checkPickups();
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

  // ---- death and respawn -------------------------------------------------

  private handleDeath(): void {
    const lost = unsecuredCount(this.run);
    this.run = die(this.run);
    this.syncPickups();
    this.bullets.getChildren().forEach((b) => (b as Bullet).kill());

    const point = this.respawnPoint();
    this.player.respawnAt(point.x, point.y);
    this.cameras.main.centerOn(point.x, point.y);
    this.refreshHud();
    this.toast(lost > 0 ? `Rolled back ${lost} unsecured pickup${lost === 1 ? '' : 's'}` : 'Back to checkpoint');
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

  private refreshHud(): void {
    const unsecured = unsecuredCount(this.run);
    this.hud
      .setText(
        `Secured ${securedCount(this.run)}  ·  Unsecured ${unsecured}  ·  Checkpoint: ${this.run.checkpointId ?? 'start'}`,
      )
      .setColor(unsecured > 0 ? '#ffd166' : '#9aa4bf');
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
