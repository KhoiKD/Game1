import type Phaser from 'phaser';
import type { ChargerStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { Enemy, enemyTexture, type EnemyContext } from './Enemy';

type State = 'patrol' | 'windup' | 'charge' | 'rest';

/** Patrols slowly, then stops, warns, and rushes along the ground at the player. */
export class Charger extends Enemy {
  private readonly homeX: number;
  private direction: 1 | -1 = -1;
  private mode: State = 'patrol';
  private stateUntil = 0;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: ChargerStats) {
    super(scene, def, enemyTexture('charger', stats.element), stats);
    this.homeX = def.x;
  }

  protected act(ctx: EnemyContext): void {
    const body = this.arcadeBody;
    switch (this.mode) {
      case 'patrol': {
        if (this.x >= this.homeX + this.stats.patrolRange || body.blocked.right) this.direction = -1;
        else if (this.x <= this.homeX - this.stats.patrolRange || body.blocked.left) this.direction = 1;
        this.setVelocityX(this.mods.rooted ? 0 : this.direction * this.stats.speed * this.mods.speedMult);
        const dx = ctx.player.x - this.x;
        const sameLevel = Math.abs(ctx.player.y - this.y) < 70;
        if (!this.mods.rooted && sameLevel && Math.abs(dx) <= this.stats.range && ctx.time >= this.stateUntil) {
          this.direction = dx < 0 ? -1 : 1;
          this.enter('windup', ctx.time + this.stats.telegraphMs);
          this.showWarning(true);
        }
        break;
      }
      case 'windup':
        this.setVelocityX(0);
        if (ctx.time >= this.stateUntil) {
          this.showWarning(false);
          this.enter('charge', ctx.time + this.stats.chargeMs);
        }
        break;
      case 'charge': {
        // Stop at a wall, at the end of the rush, or before leaving its patch of ground.
        const pastLeash = (this.x - this.homeX) * this.direction > this.stats.leash;
        const blocked = this.direction < 0 ? body.blocked.left : body.blocked.right;
        if (ctx.time >= this.stateUntil || pastLeash || blocked || this.mods.rooted) {
          this.enter('rest', ctx.time + this.stats.restMs * this.mods.cooldownMult);
          this.setVelocityX(0);
        } else {
          this.setVelocityX(this.direction * this.stats.chargeSpeed * this.mods.speedMult);
        }
        break;
      }
      case 'rest':
        this.setVelocityX(0);
        if (ctx.time >= this.stateUntil) this.enter('patrol', ctx.time);
        break;
    }
    this.setFlipX(this.direction < 0);
  }

  private enter(state: State, until: number): void {
    this.mode = state;
    this.stateUntil = until;
  }

  override idle(): void {
    super.idle();
    if (this.mode !== 'patrol') {
      this.showWarning(false);
      this.enter('patrol', 0);
    }
  }
}
