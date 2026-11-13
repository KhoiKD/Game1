import type Phaser from 'phaser';
import type { HopperStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { Enemy, enemyTexture, type EnemyContext } from './Enemy';

/** Crouches for a beat, then leaps at the player. Stays near where it was placed. */
export class Hopper extends Enemy {
  private readonly homeX: number;
  private nextHopAt = 0;
  private hoppingAt: number | null = null;
  private airborne = false;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: HopperStats) {
    super(scene, def, enemyTexture('hopper', stats.element, scene, stats.creature.family), stats);
    this.homeX = def.x;
  }

  protected act(ctx: EnemyContext): void {
    const body = this.arcadeBody;
    if (this.airborne) {
      if (body.blocked.down && body.velocity.y >= 0) {
        this.airborne = false;
        this.setVelocityX(0);
        this.nextHopAt = ctx.time + this.stats.hopIntervalMs * this.mods.cooldownMult;
      }
      return;
    }
    this.setVelocityX(0);

    if (this.hoppingAt !== null) {
      if (ctx.time < this.hoppingAt) return;
      this.hoppingAt = null;
      this.showWarning(false);
      if (this.mods.rooted || !body.blocked.down) return;
      let direction = Math.sign(ctx.player.x - this.x) || 1;
      // Turn back rather than leap off its patch of ground.
      const landingX = this.x + direction * this.stats.hopSpeedX * 0.64;
      if (Math.abs(landingX - this.homeX) > this.stats.leash) direction = Math.sign(this.homeX - this.x) || 1;
      this.setVelocity(direction * this.stats.hopSpeedX * this.mods.speedMult, -this.stats.hopSpeedY);
      this.setFlipX(direction < 0);
      this.airborne = true;
      return;
    }

    const near = Math.abs(ctx.player.x - this.x) <= this.stats.range;
    if (near && ctx.time >= this.nextHopAt && body.blocked.down) {
      this.hoppingAt = ctx.time + this.stats.telegraphMs;
      this.showWarning(true);
    }
  }

  override idle(): void {
    if (!this.airborne) super.idle();
    if (this.hoppingAt !== null) {
      this.hoppingAt = null;
      this.showWarning(false);
    }
  }
}
