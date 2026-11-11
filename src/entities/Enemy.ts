import Phaser from 'phaser';
import type { EnemyDef } from '../level/parseLevelObjects';
import type { Vec2 } from '../util/aim';

/** What an enemy can see and do each frame. */
export interface EnemyContext {
  time: number;
  /** Player centre in world coordinates. */
  player: Vec2;
  fire(from: Vec2, dir: Vec2, speed: number): void;
}

const HIT_FLASH_MS = 70;

/**
 * Base class for everything the player can shoot: health, hit feedback, and
 * contact damage. Subclasses implement act() for their behavior.
 */
export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly enemyId: string;
  readonly maxHp: number;
  readonly contactDamage: number;
  hp: number;
  private flashUntil = 0;

  /** `def.x, def.y` is the point on the surface the enemy stands on. */
  constructor(scene: Phaser.Scene, def: EnemyDef, texture: string, stats: { hp: number; contactDamage: number }) {
    super(scene, def.x, def.y, texture);
    this.enemyId = def.id;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.contactDamage = stats.contactDamage;
    this.setPosition(def.x, def.y - this.height / 2 - 1);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(3);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  get hpFraction(): number {
    return this.hp / this.maxHp;
  }

  /** Returns true when this hit defeated the enemy. */
  takeDamage(amount: number, time: number): boolean {
    if (this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.flashUntil = time + HIT_FLASH_MS;
    this.setAlpha(0.45);
    return this.hp === 0;
  }

  tick(ctx: EnemyContext): void {
    if (this.flashUntil !== 0 && ctx.time >= this.flashUntil) {
      this.flashUntil = 0;
      this.setAlpha(1);
    }
    this.act(ctx);
  }

  /** Called instead of tick() while the player is far away. */
  idle(): void {
    this.setAlpha(1);
    this.setVelocityX(0);
  }

  protected abstract act(ctx: EnemyContext): void;
}
