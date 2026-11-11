import Phaser from 'phaser';
import { GRAVITY } from '../config';
import type { Vec2 } from '../util/aim';

export interface BulletOptions {
  speed: number;
  lifetimeMs: number;
  damage?: number;
  /** Extra enemies the projectile passes through before stopping. */
  pierce?: number;
  /** 0 flies straight; 1 falls at full world gravity. */
  gravity?: number;
  /** Greater than 0 makes the projectile explode on impact. */
  blastRadius?: number;
  texture?: string;
}

/**
 * Pooled projectile, used for both player and enemy shots. Created through a
 * physics group (the group's defaultKey picks the starting texture); reused
 * after kill().
 */
export class Bullet extends Phaser.Physics.Arcade.Image {
  damage = 1;
  blastRadius = 0;
  private pierceLeft = 0;
  private expireAt = 0;
  private readonly hitIds = new Set<string>();

  constructor(scene: Phaser.Scene, x: number, y: number, texture?: string | null) {
    super(scene, x, y, texture ?? 'bullet');
  }

  fire(x: number, y: number, dir: Vec2, options: BulletOptions): void {
    if (options.texture) this.setTexture(options.texture);
    this.enableBody(true, x, y, true, true);

    const gravity = options.gravity ?? 0;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(gravity > 0);
    // Body gravity adds to world gravity, so offset it to reach the wanted fraction.
    body.setGravityY(gravity > 0 ? GRAVITY * (gravity - 1) : 0);
    const hitSize = Math.max(6, Math.min(this.width, this.height));
    body.setSize(hitSize, hitSize);

    this.setRotation(Math.atan2(dir.y, dir.x));
    this.setVelocity(dir.x * options.speed, dir.y * options.speed);
    this.damage = options.damage ?? 1;
    this.blastRadius = options.blastRadius ?? 0;
    this.pierceLeft = options.pierce ?? 0;
    this.hitIds.clear();
    this.expireAt = this.scene.time.now + options.lifetimeMs;
  }

  /** Records a hit on a target. Returns false if this projectile already hit it. */
  registerHit(targetId: string): boolean {
    if (this.hitIds.has(targetId)) return false;
    this.hitIds.add(targetId);
    return true;
  }

  /** Call after a hit. Returns true when the projectile should keep flying. */
  consumePierce(): boolean {
    if (this.pierceLeft <= 0) return false;
    this.pierceLeft -= 1;
    return true;
  }

  kill(): void {
    this.disableBody(true, true);
  }

  update(): void {
    if (this.active && this.scene.time.now >= this.expireAt) this.kill();
  }
}
