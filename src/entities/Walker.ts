import type Phaser from 'phaser';
import type { WalkerStats } from '../data/enemyData';
import type { EnemyDef } from '../level/parseLevelObjects';
import { Enemy, enemyTexture } from './Enemy';

/** Patrols back and forth around the point it was placed. Hurts on contact. */
export class Walker extends Enemy {
  private readonly homeX: number;
  private direction: 1 | -1 = -1;

  constructor(scene: Phaser.Scene, def: EnemyDef, private readonly stats: WalkerStats) {
    super(scene, def, enemyTexture('walker', stats.element, scene, stats.creature.family), stats);
    this.homeX = def.x;
  }

  protected act(): void {
    const body = this.arcadeBody;
    if (this.x >= this.homeX + this.stats.patrolRange || body.blocked.right) this.direction = -1;
    else if (this.x <= this.homeX - this.stats.patrolRange || body.blocked.left) this.direction = 1;
    // Rooted: held in place. Slowed: moves at a fraction of its speed.
    const speed = this.mods.rooted ? 0 : this.stats.speed * this.mods.speedMult;
    this.setVelocityX(this.direction * speed);
    this.setFlipX(this.direction < 0);
  }
}
