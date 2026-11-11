import type Phaser from 'phaser';
import type { TurretStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { aimVector } from '../util/aim';
import { Enemy, type EnemyContext } from './Enemy';

/** Stationary shooter. Flashes for a telegraph beat, then fires one aimed shot. */
export class Turret extends Enemy {
  private nextFireAt = 0;
  private firingAt: number | null = null;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: TurretStats) {
    super(scene, def, 'enemy-turret', stats);
    this.arcadeBody.setAllowGravity(false);
    this.arcadeBody.setImmovable(true);
  }

  protected act(ctx: EnemyContext): void {
    const from = { x: this.x, y: this.y };

    if (this.firingAt !== null) {
      if (ctx.time < this.firingAt) return;
      ctx.fire(from, aimVector(from, ctx.player), this.stats.bulletSpeed);
      this.firingAt = null;
      this.nextFireAt = ctx.time + this.stats.fireIntervalMs;
      this.setTexture('enemy-turret');
      return;
    }

    const distance = Math.hypot(ctx.player.x - from.x, ctx.player.y - from.y);
    if (distance <= this.stats.range && ctx.time >= this.nextFireAt) {
      this.firingAt = ctx.time + this.stats.telegraphMs;
      this.setTexture('enemy-turret-warn');
    }
  }

  override idle(): void {
    super.idle();
    if (this.firingAt !== null) {
      this.firingAt = null;
      this.setTexture('enemy-turret');
    }
  }
}
