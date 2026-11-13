import type Phaser from 'phaser';
import type { FlyerStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { aimAngle } from '../util/aim';
import { Enemy, enemyTexture, type EnemyContext } from './Enemy';

const BOB_PERIOD_MS = 400;

/** Hovers back and forth above the ground and fires aimed shots down at the player. */
export class Flyer extends Enemy {
  private readonly homeX: number;
  private direction: 1 | -1 = -1;
  private nextFireAt = 0;
  private firingAt: number | null = null;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: FlyerStats) {
    super(scene, def, enemyTexture('flyer', stats.element, scene, stats.creature.family), stats);
    this.homeX = def.x;
    this.arcadeBody.setAllowGravity(false);
  }

  protected act(ctx: EnemyContext): void {
    if (this.x >= this.homeX + this.stats.patrolRange) this.direction = -1;
    else if (this.x <= this.homeX - this.stats.patrolRange) this.direction = 1;
    const speed = this.mods.rooted ? 0 : this.stats.speed * this.mods.speedMult;
    // Vertical bob: the velocity whose position traces a sine wave around its hover line.
    const bob = (Math.cos(ctx.time / BOB_PERIOD_MS) * this.stats.bobHeight * 1000) / BOB_PERIOD_MS;
    this.setVelocity(this.firingAt === null ? this.direction * speed : 0, bob);
    this.setFlipX(this.direction < 0);

    const from = { x: this.x, y: this.y };
    if (this.firingAt !== null) {
      if (ctx.time < this.firingAt) return;
      const angle = aimAngle(from, ctx.player) + (ctx.rng() * 2 - 1) * this.mods.aimErrorRad;
      ctx.fire(from, { x: Math.cos(angle), y: Math.sin(angle) }, this.stats.bulletSpeed);
      this.firingAt = null;
      this.nextFireAt = ctx.time + this.stats.fireIntervalMs * this.mods.cooldownMult;
      this.showWarning(false);
      return;
    }
    const distance = Math.hypot(ctx.player.x - from.x, ctx.player.y - from.y);
    if (distance <= this.stats.range && ctx.time >= this.nextFireAt) {
      this.firingAt = ctx.time + this.stats.telegraphMs;
      this.showWarning(true);
    }
  }

  override idle(): void {
    super.idle();
    this.setVelocityY(0);
    if (this.firingAt !== null) {
      this.firingAt = null;
      this.showWarning(false);
    }
  }
}
