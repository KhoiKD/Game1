import Phaser from 'phaser';
import { FIRE_INTERVAL_MS, GAME_HEIGHT, TILE, WORLD_WIDTH } from '../config';
import { Bullet } from '../entities/Bullet';
import { Player } from '../entities/Player';
import { aimVector } from '../util/aim';

/** Flat test level for milestone 1: floor plus a few platforms. */
export class LevelScene extends Phaser.Scene {
  private player!: Player;
  private bullets!: Phaser.Physics.Arcade.Group;
  private reticle!: Phaser.GameObjects.Image;
  private nextShotAt = 0;

  constructor() {
    super('Level');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);

    const solids = this.buildLevel();

    this.player = new Player(this, 96, GAME_HEIGHT - TILE * 2 - 64);
    this.physics.add.collider(this.player, solids);
    camera.startFollow(this.player, true, 0.12, 0.12);

    this.bullets = this.physics.add.group({
      classType: Bullet,
      runChildUpdate: true,
      allowGravity: false,
      maxSize: 64,
    });
    this.physics.add.collider(this.bullets, solids, (bullet) => {
      (bullet as unknown as Bullet).kill();
    });

    // The reticle replaces the OS cursor; right-click is reserved for abilities.
    this.input.setDefaultCursor('none');
    this.input.mouse?.disableContextMenu();
    this.reticle = this.add.image(0, 0, 'reticle').setDepth(100);

    this.add
      .text(16, 12, 'A/D move · Space jump · Mouse aim · Left click fire', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9aa4bf',
      })
      .setScrollFactor(0)
      .setDepth(100);
  }

  update(time: number): void {
    // Refresh the pointer's world position every frame; it goes stale while the
    // camera scrolls under a stationary mouse.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    const target = { x: pointer.worldX, y: pointer.worldY };

    this.reticle.setPosition(target.x, target.y);
    this.player.tick(time, target);

    if (pointer.leftButtonDown() && time >= this.nextShotAt) {
      this.nextShotAt = time + FIRE_INTERVAL_MS;
      this.fire(target);
    }
  }

  private fire(target: { x: number; y: number }): void {
    const origin = this.player.weaponPivot;
    const dir = aimVector(origin, target);
    const bullet = this.bullets.get(origin.x + dir.x * 22, origin.y + dir.y * 22) as Bullet | null;
    bullet?.fire(origin.x + dir.x * 22, origin.y + dir.y * 22, dir);
  }

  private buildLevel(): Phaser.Physics.Arcade.StaticGroup {
    const solids = this.physics.add.staticGroup();
    const addBlock = (x: number, y: number, width: number, height: number): void => {
      const block = this.add.tileSprite(x, y, width, height, 'tile').setOrigin(0, 0);
      this.physics.add.existing(block, true);
      solids.add(block);
    };

    const floorTop = GAME_HEIGHT - TILE * 2;
    addBlock(0, floorTop, WORLD_WIDTH, TILE * 2);

    // Platforms: [x, y offset above floor, width in tiles]
    const platforms: Array<[number, number, number]> = [
      [400, 96, 5],
      [700, 176, 6],
      [1100, 96, 4],
      [1400, 160, 7],
      [1800, 96, 5],
      [2100, 192, 6],
      [2500, 112, 8],
    ];
    for (const [x, rise, tiles] of platforms) {
      addBlock(x, floorTop - rise, tiles * TILE, TILE);
    }

    return solids;
  }
}
