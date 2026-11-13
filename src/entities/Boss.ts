import type Phaser from 'phaser';
import { BOSS_RAIN_SPACING } from '../config';
import { elementRules } from '../data/elementData';
import type { BossPhaseStats, BossStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { phaseIndex } from '../systems/bossPhase';
import { aimAngle } from '../util/aim';
import { Enemy, enemyTexture, type EnemyContext } from './Enemy';

const FIRST_ATTACK_DELAY_MS = 1000;
const RAIN_HEIGHT = 400;

/**
 * Stage boss. Dormant until the player comes close (or shoots it), then loops:
 * wait, telegraph, attack. Its phases come from data: each sets an attack pattern
 * (aimed fan, ring, or rain from above), its pace, and whether the boss hops.
 */
export class Boss extends Enemy {
  readonly displayName: string;
  private awake = false;
  private readonly homeX: number;
  private nextAttackAt = 0;
  private attackingAt: number | null = null;
  private attackCount = 0;
  private hopping = false;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: BossStats) {
    super(scene, def, enemyTexture('boss', stats.element, scene, stats.family), stats);
    this.displayName = stats.name;
    this.homeX = def.x;
    this.arcadeBody.setCollideWorldBounds(true);
    // Bosses need more build-up before a status takes hold and shake it off sooner.
    this.statusScale = {
      thresholdMult: elementRules.buildup.bossThresholdMult,
      durationMult: elementRules.buildup.bossDurationMult,
    };
  }

  get isAwake(): boolean {
    return this.awake;
  }

  /** 1-based phase number, for the HUD. */
  get phaseNumber(): number {
    return phaseIndex(this.hpFraction, this.stats.phases) + 1;
  }

  override takeDamage(amount: number, time: number): boolean {
    this.wake(time);
    return super.takeDamage(amount, time);
  }

  override idle(): void {
    // A boss that has been woken keeps its place rather than resetting.
    if (!this.hopping) this.setVelocityX(0);
  }

  protected act(ctx: EnemyContext): void {
    if (!this.awake) {
      const distance = Math.abs(ctx.player.x - this.x);
      if (distance <= this.stats.activateRange) this.wake(ctx.time);
      return;
    }

    const body = this.arcadeBody;
    if (this.hopping && body.blocked.down && body.velocity.y >= 0) {
      this.hopping = false;
      this.setVelocityX(0);
    }
    this.setFlipX(ctx.player.x < this.x);

    const phase = this.currentPhase();
    if (this.attackingAt !== null) {
      if (ctx.time < this.attackingAt) return;
      this.attack(ctx, phase);
      this.attackingAt = null;
      this.nextAttackAt = ctx.time + phase.cooldownMs * this.mods.cooldownMult;
      this.showWarning(false);
      return;
    }
    if (ctx.time >= this.nextAttackAt && !this.hopping) {
      this.attackingAt = ctx.time + this.stats.telegraphMs;
      this.showWarning(true);
    }
  }

  private wake(time: number): void {
    if (this.awake) return;
    this.awake = true;
    this.nextAttackAt = time + FIRST_ATTACK_DELAY_MS;
  }

  private currentPhase(): BossPhaseStats {
    const phase = this.stats.phases[phaseIndex(this.hpFraction, this.stats.phases)];
    if (!phase) throw new Error(`Boss "${this.displayName}" has no phases`);
    return phase;
  }

  private attack(ctx: EnemyContext, phase: BossPhaseStats): void {
    const from = { x: this.x, y: this.y - this.displayHeight / 4 };
    const speed = this.stats.bulletSpeed;
    // Blinded: the whole attack is aimed off by a random amount.
    const error = (ctx.rng() * 2 - 1) * this.mods.aimErrorRad;
    switch (phase.pattern) {
      case 'aimed': {
        const base = aimAngle(from, ctx.player) + error;
        const spread = (phase.spreadDeg * Math.PI) / 180;
        for (let i = 0; i < phase.bullets; i++) {
          const angle = base + (i - (phase.bullets - 1) / 2) * spread;
          ctx.fire(from, { x: Math.cos(angle), y: Math.sin(angle) }, speed);
        }
        break;
      }
      case 'ring': {
        // Evenly in every direction; the starting angle turns each time so the gaps move.
        const offset = this.attackCount * 0.4 + error;
        for (let i = 0; i < phase.bullets; i++) {
          const angle = offset + (i / phase.bullets) * Math.PI * 2;
          ctx.fire(from, { x: Math.cos(angle), y: Math.sin(angle) }, speed * 0.8);
        }
        break;
      }
      case 'rain': {
        // A line of shots falling from above where the player stands, with gaps to stand in.
        const centre = ctx.player.x + Math.tan(error) * 200;
        for (let i = 0; i < phase.bullets; i++) {
          const x = centre + (i - (phase.bullets - 1) / 2) * BOSS_RAIN_SPACING;
          ctx.fire({ x, y: ctx.player.y - RAIN_HEIGHT }, { x: 0, y: 1 }, speed * 0.75);
        }
        break;
      }
    }

    this.attackCount += 1;
    const canHop = phase.hop && !this.mods.rooted && this.arcadeBody.blocked.down;
    if (canHop && this.attackCount % 2 === 0) this.hop(ctx);
  }

  /** Hop toward the player, but turn back before leaving the leash around the arena. */
  private hop(ctx: EnemyContext): void {
    let direction = Math.sign(ctx.player.x - this.x) || 1;
    const landingX = this.x + direction * this.stats.hopSpeedX * 0.75;
    if (Math.abs(landingX - this.homeX) > this.stats.leash) direction = Math.sign(this.homeX - this.x) || 1;
    this.setVelocity(direction * this.stats.hopSpeedX * this.mods.speedMult, -this.stats.hopSpeedY);
    this.hopping = true;
  }
}
