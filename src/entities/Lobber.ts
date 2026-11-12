import type Phaser from 'phaser';
import { GRAVITY } from '../config';
import type { LobberStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { Enemy, enemyTexture, type EnemyContext } from './Enemy';

/** Stands its ground and lobs arcing shots that come down where the player is standing. */
export class Lobber extends Enemy {
  private nextFireAt = 0;
  private firingAt: number | null = null;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: LobberStats) {
    super(scene, def, enemyTexture('lobber', stats.element), stats);
  }

  protected act(ctx: EnemyContext): void {
    this.setVelocityX(0);
    const from = { x: this.x, y: this.y - this.displayHeight / 2 };

    if (this.firingAt !== null) {
      if (ctx.time < this.firingAt) return;
      // Launch velocity that lands on the player after a fixed flight time under the shot's gravity.
      const seconds = this.stats.flightMs / 1000;
      const gravity = GRAVITY * this.stats.gravity;
      const miss = (ctx.rng() * 2 - 1) * Math.tan(this.mods.aimErrorRad) * 200; // blinded: lands off target
      const vx = (ctx.player.x + miss - from.x) / seconds;
      const vy = (ctx.player.y - from.y) / seconds - (gravity * seconds) / 2;
      const speed = Math.hypot(vx, vy) || 1;
      ctx.fire(from, { x: vx / speed, y: vy / speed }, speed, this.stats.gravity);
      this.firingAt = null;
      this.nextFireAt = ctx.time + this.stats.fireIntervalMs * this.mods.cooldownMult;
      this.showWarning(false);
      return;
    }

    const distance = Math.hypot(ctx.player.x - this.x, ctx.player.y - this.y);
    if (distance <= this.stats.range && ctx.time >= this.nextFireAt) {
      this.firingAt = ctx.time + this.stats.telegraphMs;
      this.showWarning(true);
    }
  }

  override idle(): void {
    super.idle();
    if (this.firingAt !== null) {
      this.firingAt = null;
      this.showWarning(false);
    }
  }
}
