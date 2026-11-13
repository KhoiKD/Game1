import Phaser from 'phaser';
import { displayScale } from '../art/render';
import { artKeys, CHARACTER_CLASSES } from '../art/sprites';
import { COYOTE_MS, JUMP_CUT_FACTOR, JUMP_SPEED, MOVE_SPEED } from '../config';
import type { WeaponElement } from '../data/weaponData';
import { aimAngle, type Vec2 } from '../util/aim';

type Keys = Record<
  'left' | 'right' | 'up' | 'jump' | 'leftArrow' | 'rightArrow' | 'upArrow',
  Phaser.Input.Keyboard.Key
>;

export class Player extends Phaser.Physics.Arcade.Sprite {
  private readonly keys: Keys;
  private readonly gun: Phaser.GameObjects.Image;
  private lastGroundedAt = -Infinity;
  /** Movement speed multiplier from equipped spirits. */
  speedMult = 1;
  private dashUntil = 0;
  private dashVelocity = 0;
  /** Texture key of the class character; its animations are this key plus -idle, -run, -jump. */
  private readonly look: string;

  constructor(scene: Phaser.Scene, x: number, y: number, classId: string | null) {
    const look = artKeys.character(classId && CHARACTER_CLASSES.includes(classId) ? classId : 'vanguard');
    super(scene, x, y, look, 0);
    this.look = look;
    this.play(`${look}-idle`);
    // The texture holds more texels than world pixels; scale it to 32 x 64 in the world.
    const scale = displayScale(look);
    this.setScale(scale);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(24 / scale, 60 / scale).setOffset(4 / scale, 4 / scale);
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

    const gunKey = artKeys.weapon('pulse-rifle', 'kinetic');
    this.gun = scene.add.image(x, y, gunKey).setOrigin(0, 0.5).setDepth(5).setScale(displayScale(gunKey));
  }

  /** Shows the weapon in hand: each archetype has its own sprite, coloured by element. */
  setWeapon(archetype: string, element: WeaponElement): void {
    const key = artKeys.weapon(archetype, element);
    if (this.scene.textures.exists(key)) this.gun.setTexture(key).setScale(displayScale(key));
  }

  /** Point the weapon fires from, in world coordinates. */
  get weaponPivot(): Vec2 {
    return { x: this.x, y: this.y - 8 };
  }

  /** Teleport to a standing position (sprite centre) and clear all motion. */
  respawnAt(x: number, y: number): void {
    (this.body as Phaser.Physics.Arcade.Body).reset(x, y);
    this.setVelocity(0, 0);
    this.dashUntil = 0;
    this.lastGroundedAt = -Infinity;
  }

  /** -1, 0, or 1 from the movement keys held right now. */
  get moveDirection(): -1 | 0 | 1 {
    const k = this.keys;
    const left = k.left.isDown || k.leftArrow.isDown;
    const right = k.right.isDown || k.rightArrow.isDown;
    return ((right ? 1 : 0) - (left ? 1 : 0)) as -1 | 0 | 1;
  }

  /** The way the player is aiming: 1 for right, -1 for left. */
  get facing(): -1 | 1 {
    return this.flipX ? -1 : 1;
  }

  /** A short burst of horizontal speed that overrides the movement keys. */
  dash(direction: -1 | 1, speed: number, durationMs: number, time: number): void {
    this.dashUntil = time + durationMs;
    this.dashVelocity = direction * speed;
  }

  /** Called every frame by the scene with the aim target in world coordinates. */
  tick(time: number, aimTarget: Vec2): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const k = this.keys;

    // Horizontal: instant speed for tight run-and-gun control.
    const left = k.left.isDown || k.leftArrow.isDown;
    const right = k.right.isDown || k.rightArrow.isDown;
    if (time < this.dashUntil) this.setVelocityX(this.dashVelocity);
    else this.setVelocityX(((right ? 1 : 0) - (left ? 1 : 0)) * MOVE_SPEED * this.speedMult);

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

    // Airborne: jump pose. Moving: run cycle. Otherwise: idle bob.
    let anim = 'idle';
    if (!body.blocked.down) anim = 'jump';
    else if (Math.abs(body.velocity.x) > 10) anim = 'run';
    this.play(`${this.look}-${anim}`, true);
  }
}
