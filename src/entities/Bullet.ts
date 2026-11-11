import Phaser from 'phaser';
import { BULLET_LIFETIME_MS, BULLET_SPEED } from '../config';
import type { Vec2 } from '../util/aim';

/**
 * Pooled projectile, used for both player and enemy shots. Created through a
 * physics group (the group's defaultKey picks the texture); reused after kill().
 */
export class Bullet extends Phaser.Physics.Arcade.Image {
  private expireAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, texture?: string | null) {
    super(scene, x, y, texture ?? 'bullet');
  }

  fire(x: number, y: number, dir: Vec2, speed = BULLET_SPEED, lifetimeMs = BULLET_LIFETIME_MS): void {
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(6, 6);
    this.setRotation(Math.atan2(dir.y, dir.x));
    this.setVelocity(dir.x * speed, dir.y * speed);
    this.expireAt = this.scene.time.now + lifetimeMs;
  }

  kill(): void {
    this.disableBody(true, true);
  }

  update(): void {
    if (this.active && this.scene.time.now >= this.expireAt) this.kill();
  }
}
