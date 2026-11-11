import Phaser from 'phaser';
import { COYOTE_MS, JUMP_CUT_FACTOR, JUMP_SPEED, MOVE_SPEED } from '../config';
import { aimAngle, type Vec2 } from '../util/aim';

type Keys = Record<
  'left' | 'right' | 'up' | 'jump' | 'leftArrow' | 'rightArrow' | 'upArrow',
  Phaser.Input.Keyboard.Key
>;

export class Player extends Phaser.Physics.Arcade.Sprite {
  private readonly keys: Keys;
  private readonly gun: Phaser.GameObjects.Image;
  private lastGroundedAt = -Infinity;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(24, 60).setOffset(4, 4);
    this.setCollideWorldBounds(true);

    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    this.keys = keyboard.addKeys({
      left: 'A',
      right: 'D',
      up: 'W',
      jump: 'SPACE',
      leftArrow: 'LEFT',
      rightArrow: 'RIGHT',
      upArrow: 'UP',
    }) as Keys;

    this.gun = scene.add.image(x, y, 'gun').setOrigin(0, 0.5).setDepth(5);
  }

  /** Point the weapon fires from, in world coordinates. */
  get weaponPivot(): Vec2 {
    return { x: this.x, y: this.y - 8 };
  }

  /** Called every frame by the scene with the aim target in world coordinates. */
  tick(time: number, aimTarget: Vec2): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const k = this.keys;

    // Horizontal: instant speed for tight run-and-gun control.
    const left = k.left.isDown || k.leftArrow.isDown;
    const right = k.right.isDown || k.rightArrow.isDown;
    this.setVelocityX(((right ? 1 : 0) - (left ? 1 : 0)) * MOVE_SPEED);

    // Jump with coyote time and variable height.
    if (body.blocked.down) this.lastGroundedAt = time;
    const Keyboard = Phaser.Input.Keyboard;
    const jumpPressed =
      Keyboard.JustDown(k.jump) || Keyboard.JustDown(k.up) || Keyboard.JustDown(k.upArrow);
    const jumpReleased =
      Keyboard.JustUp(k.jump) || Keyboard.JustUp(k.up) || Keyboard.JustUp(k.upArrow);

    if (jumpPressed && time - this.lastGroundedAt <= COYOTE_MS) {
      this.setVelocityY(-JUMP_SPEED);
      this.lastGroundedAt = -Infinity;
    }
    if (jumpReleased && body.velocity.y < 0) {
      this.setVelocityY(body.velocity.y * JUMP_CUT_FACTOR);
    }

    // Free aim toward the pointer; face and flip the weapon accordingly.
    const pivot = this.weaponPivot;
    const angle = aimAngle(pivot, aimTarget);
    const facingLeft = Math.cos(angle) < 0;
    this.setFlipX(facingLeft);
    this.gun.setPosition(pivot.x, pivot.y).setRotation(angle).setFlipY(facingLeft);
  }
}
