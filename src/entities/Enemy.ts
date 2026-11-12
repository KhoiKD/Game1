import Phaser from 'phaser';
import { elementRules } from '../data/elementData';
import type { EnemyDef } from '../level/parseLevelObjects';
import type { Element } from '../systems/combat';
import {
  NORMAL_SCALE,
  NO_MODIFIERS,
  NO_STATUS,
  activeStatuses,
  statusModifiers,
  type StatusModifiers,
  type StatusScale,
  type StatusState,
} from '../systems/status';
import { ELEMENT_COLOR, STATUS_COLOR } from '../ui/elementColors';
import type { Vec2 } from '../util/aim';
import type { Rng } from '../util/rng';

/** What an enemy can see and do each frame. */
export interface EnemyContext {
  time: number;
  /** Player centre in world coordinates. */
  player: Vec2;
  rng: Rng;
  fire(from: Vec2, dir: Vec2, speed: number): void;
}

const HIT_FLASH_MS = 70;
const PIP = 6;
const PIP_GAP = 2;

/**
 * Base class for everything the player can shoot: health, element, status
 * effects, hit feedback, and contact damage. Subclasses implement act() for
 * their behavior and read `this.mods` to respect statuses.
 */
export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly enemyId: string;
  /** Key in enemies.json; also the name of this enemy's drop table. */
  readonly kind: string;
  readonly element: Element | null;
  readonly maxHp: number;
  readonly contactDamage: number;
  hp: number;
  /** Status meters and running statuses. The scene updates this on hits and each frame. */
  status: StatusState = NO_STATUS;
  /** Effects of the running statuses, refreshed every frame before act(). */
  mods: StatusModifiers = NO_MODIFIERS;
  protected statusScale: StatusScale = NORMAL_SCALE;
  private flashUntil = 0;
  /** Element pip and status pips drawn above the enemy. */
  private readonly badge: Phaser.GameObjects.Graphics;
  private badgeKey = '';

  /** `def.x, def.y` is the point on the surface the enemy stands on. */
  constructor(
    scene: Phaser.Scene,
    def: EnemyDef,
    texture: string,
    stats: { hp: number; contactDamage: number; element: Element | null },
  ) {
    super(scene, def.x, def.y, texture);
    this.enemyId = def.id;
    this.kind = def.kind;
    this.element = stats.element;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.contactDamage = stats.contactDamage;
    this.setPosition(def.x, def.y - this.height / 2 - 1);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(3);
    this.badge = scene.add.graphics().setDepth(4);
    this.refreshBadge(scene.time.now);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  get hpFraction(): number {
    return this.hp / this.maxHp;
  }

  /** How resistant this enemy is to status build-up. */
  get statusResistance(): StatusScale {
    return this.statusScale;
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
    this.mods = statusModifiers(this.status, ctx.time, elementRules);
    this.act(ctx);
    this.refreshBadge(ctx.time);
  }

  /** Called instead of tick() while the player is far away. */
  idle(): void {
    this.setAlpha(1);
    this.setVelocityX(0);
    this.refreshBadge(this.scene.time.now);
  }

  override destroy(fromScene?: boolean): void {
    this.badge.destroy();
    super.destroy(fromScene);
  }

  protected abstract act(ctx: EnemyContext): void;

  /** Keeps the badge above the enemy and redraws it only when its contents change. */
  private refreshBadge(time: number): void {
    this.badge.setPosition(this.x, this.y - this.height / 2 - 10);
    const statuses = activeStatuses(this.status, time);
    const key = statuses.join(',');
    if (key === this.badgeKey && this.badge.commandBuffer.length > 0) return;
    this.badgeKey = key;

    const colors: number[] = [];
    if (this.element) colors.push(ELEMENT_COLOR[this.element]);
    for (const status of statuses) colors.push(STATUS_COLOR[status]);
    this.badge.clear();
    const width = colors.length * PIP + (colors.length - 1) * PIP_GAP;
    colors.forEach((color, i) => {
      const x = -width / 2 + i * (PIP + PIP_GAP);
      // The first pip (the enemy's own element) is a diamond; statuses are squares.
      if (i === 0 && this.element) {
        this.badge.fillStyle(color).fillTriangle(x, 0, x + PIP / 2, -PIP / 2 - 1, x + PIP, 0);
        this.badge.fillStyle(color).fillTriangle(x, 0, x + PIP / 2, PIP / 2 + 1, x + PIP, 0);
      } else {
        this.badge.fillStyle(color).fillRect(x, -PIP / 2, PIP, PIP);
      }
    });
  }
}
