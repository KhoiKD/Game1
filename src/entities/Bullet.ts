import Phaser from 'phaser';
import { BULLET_LIFETIME_MS, BULLET_SPEED } from '../config';
import type { Vec2 } from '../util/aim';

/** Pooled projectile. Created through a physics group; reused after kill(). */
export class Bullet extends Phaser.Physics.Arcade.Image {
  private expireAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
  }

  fire(x: number, y: number, dir: Vec2): void {
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(6, 6);
    this.setRotation(Math.atan2(dir.y, dir.x));
    this.setVelocity(dir.x * BULLET_SPEED, dir.y * BULLET_SPEED);
    this.expireAt = this.scene.time.now + BULLET_LIFETIME_MS;
  }

  kill(): void {
    this.disableBody(true, true);
  }

  update(): void {
    if (this.active && this.scene.time.now >= this.expireAt) this.kill();
  }
}
