import Phaser from 'phaser';
import type { WeaponElement } from '../data/weaponData';
import { ELEMENT_COLOR } from '../ui/elementColors';
import { gameEvents, type GameEvents } from '../util/events';
import { playUiSound } from '../audio/director';
import { displayScale } from './render';

/**
 * Game feel for a stage: sparks, bursts, muzzle flashes, dust, camera shake,
 * a brief freeze on crit kills, a red vignette when hurt, and the reticle
 * kick. Listens to game events; never changes game state.
 */
const HIT_STOP_MS = 60;
const LOW_HEALTH_BEAT_MS = 900;

type Target = Phaser.Physics.Arcade.Sprite;

export class StageFeedback {
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flash: Phaser.GameObjects.Image;
  private readonly vignette: Phaser.GameObjects.Image;
  private readonly unsubscribe: Array<() => void> = [];
  private lastCritAt = -1;
  private wasGrounded = true;
  private lowHealth = false;
  private nextBeatAt = 0;
  private frozenUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Target,
    private readonly reticle: Phaser.GameObjects.Image,
  ) {
    const spark = displayScale('spark');
    this.dust = scene.add.particles(0, 0, 'spark', {
      emitting: false,
      speed: { min: 20, max: 70 },
      angle: { min: 190, max: 350 },
      lifespan: { min: 250, max: 450 },
      scale: { start: spark * 1.4, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: 0xd8cfb8,
      gravityY: -20,
    }).setDepth(2.5);
    this.flash = scene.add.image(0, 0, 'spark').setDepth(6).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.vignette = scene.add
      .image(0, 0, 'vignette')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90)
      .setScale(displayScale('vignette'))
      .setAlpha(0);

    const on = <K extends keyof GameEvents>(event: K, fn: (payload: GameEvents[K]) => void): void => {
      this.unsubscribe.push(gameEvents.on(event, fn));
    };
    on('shot', (e) => this.muzzleFlash(e.x, e.y, e.element));
    on('enemyHit', (e) => {
      this.burst(e.element, e.x, e.y, e.crit ? 10 : 5);
      if (e.crit) this.lastCritAt = this.scene.time.now;
      this.kickReticle();
    });
    on('weakened', (e) => this.burst(null, e.x, e.y, 14));
    on('defeated', (e) => {
      this.burst(e.element, e.x, e.y, e.boss ? 60 : 22);
      this.ring(e.x, e.y, e.boss ? 220 : 70, e.element);
      if (e.boss) this.shake(500, 0.012);
      if (this.scene.time.now - this.lastCritAt < 50 || e.boss) this.hitStop(e.boss ? 180 : HIT_STOP_MS);
    });
    on('captured', (e) => this.swirl(e.x, e.y, e.element));
    on('explosion', (e) => {
      this.burst(e.element === 'kinetic' ? null : e.element, e.x, e.y, 26);
      this.ring(e.x, e.y, e.radius * 1.2, e.element);
      this.shake(120, 0.004);
    });
    on('playerHurt', (e) => {
      this.shake(140, 0.006);
      this.scene.tweens.killTweensOf(this.vignette);
      this.vignette.setAlpha(0.8);
      this.scene.tweens.add({ targets: this.vignette, alpha: e.hpLeft <= 1 ? 0.25 : 0, duration: 450 });
      this.lowHealth = e.hpLeft <= 1;
    });
    on('playerDied', () => {
      this.lowHealth = false;
      this.vignette.setAlpha(0);
    });
    on('checkpoint', (e) => {
      this.lowHealth = false;
      this.vignette.setAlpha(0);
      this.ring(e.x, e.y, 90, 'kinetic');
    });
    on('bossPhase', () => this.shake(320, 0.007));
    on('ability', (e) => this.ring(e.x, e.y, 120, null));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Dust on landing and low-health heartbeat. Call every frame. */
  update(time: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    const grounded = body.blocked.down;
    if (grounded && !this.wasGrounded) this.dust.explode(6, this.player.x, body.bottom);
    this.wasGrounded = grounded;
    if (this.lowHealth && time >= this.nextBeatAt) {
      this.nextBeatAt = time + LOW_HEALTH_BEAT_MS;
      playUiSound('heartbeat');
      this.vignette.setAlpha(0.45);
      this.scene.tweens.add({ targets: this.vignette, alpha: 0.2, duration: 500 });
    }
  }

  /** Dust puff for a dash or similar burst of speed. */
  puff(x: number, y: number): void {
    this.dust.explode(10, x, y);
  }

  private sparks(element: WeaponElement | null): Phaser.GameObjects.Particles.ParticleEmitter {
    const key = element ?? 'white';
    let emitter = this.emitters.get(key);
    if (!emitter) {
      const spark = displayScale('spark');
      emitter = this.scene.add.particles(0, 0, 'spark', {
        emitting: false,
        speed: { min: 60, max: 240 },
        lifespan: { min: 220, max: 480 },
        scale: { start: spark * 1.1, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 380,
        tint: element ? ELEMENT_COLOR[element] : 0xffffff,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(6);
      this.emitters.set(key, emitter);
    }
    return emitter;
  }

  private burst(element: WeaponElement | null, x: number, y: number, count: number): void {
    this.sparks(element === 'kinetic' ? null : element).explode(count, x, y);
  }

  private muzzleFlash(x: number, y: number, element: WeaponElement): void {
    const pointer = this.scene.input.activePointer;
    const angle = Math.atan2(pointer.worldY - y, pointer.worldX - x);
    const unit = displayScale('spark');
    this.scene.tweens.killTweensOf(this.flash);
    this.flash
      .setPosition(x + Math.cos(angle) * 24, y + Math.sin(angle) * 24)
      .setTint(element === 'kinetic' ? 0xffd27a : ELEMENT_COLOR[element])
      .setScale(unit * 2.6)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({ targets: this.flash, alpha: 0, scale: unit * 1.2, duration: 70, onComplete: () => this.flash.setVisible(false) });
  }

  private ring(x: number, y: number, radius: number, element: WeaponElement | null): void {
    const unit = displayScale('ring');
    const ring = this.scene.add
      .image(x, y, 'ring')
      .setDepth(5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(element && element !== 'kinetic' ? ELEMENT_COLOR[element] : 0xfff2c0)
      .setScale(unit * 0.2);
    this.scene.tweens.add({
      targets: ring,
      scale: unit * (radius / 32),
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** Motes of the creature's colour pulled from it into the player. */
  private swirl(x: number, y: number, element: WeaponElement): void {
    const spark = displayScale('spark');
    const motes = this.scene.add.particles(x, y, 'spark', {
      emitting: false,
      lifespan: 520,
      speed: { min: 40, max: 120 },
      moveToX: this.player.x,
      moveToY: this.player.y,
      scale: { start: spark * 1.4, end: spark * 0.3 },
      alpha: { start: 1, end: 0.3 },
      tint: element === 'kinetic' ? 0xffffff : ELEMENT_COLOR[element],
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(6);
    motes.explode(28);
    this.scene.time.delayedCall(700, () => motes.destroy());
  }

  private kickReticle(): void {
    const unit = displayScale('reticle');
    this.scene.tweens.killTweensOf(this.reticle);
    this.reticle.setScale(unit * 1.35);
    this.scene.tweens.add({ targets: this.reticle, scale: unit, duration: 110 });
  }

  private shake(durationMs: number, intensity: number): void {
    this.scene.cameras.main.shake(durationMs, intensity);
  }

  /** A short freeze that sells a big hit. Physics, tweens, and animations pause together. */
  private hitStop(durationMs: number): void {
    const now = this.scene.time.now;
    if (now < this.frozenUntil) return;
    this.frozenUntil = now + durationMs;
    this.scene.physics.world.pause();
    this.scene.anims.pauseAll();
    this.scene.time.delayedCall(durationMs, () => {
      if (!this.scene.sys.isActive()) return;
      this.scene.physics.world.resume();
      this.scene.anims.resumeAll();
    });
  }

  private destroy(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}
