import Phaser from 'phaser';
import { artKeys } from '../art/sprites';
import type { NpcDef } from '../data/npcData';
import type { Vec2 } from '../util/aim';

const TALK_RANGE = 110;
const LINE_MS = 4200;

/**
 * A character who stands in a stage and talks while the player is close:
 * a speech bubble above them steps through their lines for this stage.
 */
export class Npc extends Phaser.GameObjects.Sprite {
  private readonly bubble: Phaser.GameObjects.Text;
  private lineIndex = 0;
  private nextLineAt = 0;
  private talking = false;

  /** `x, y` is the point on the floor the NPC stands on. */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    npcId: string,
    private readonly def: NpcDef,
    private readonly lines: string[],
  ) {
    super(scene, x, y, artKeys.npc(npcId), 0);
    this.setOrigin(0.5, 1).setDepth(2);
    scene.add.existing(this);
    this.play(artKeys.npc(npcId));
    this.bubble = scene.add
      .text(x, y - this.displayHeight - 10, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#1b1426',
        backgroundColor: '#f4f1ffee',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 260 },
      })
      .setOrigin(0.5, 1)
      .setDepth(60)
      .setVisible(false);
  }

  get speaking(): boolean {
    return this.talking;
  }

  get currentLine(): string {
    return this.lines[this.lineIndex] ?? '';
  }

  /** Faces the player and talks while they are near; falls silent when they leave. */
  tick(time: number, player: Vec2): void {
    this.setFlipX(player.x < this.x);
    const near = Math.abs(player.x - this.x) <= TALK_RANGE && Math.abs(player.y - (this.y - this.displayHeight / 2)) <= 120;
    if (!near) {
      this.talking = false;
      this.bubble.setVisible(false);
      return;
    }
    if (!this.talking) {
      this.talking = true;
      this.nextLineAt = time + LINE_MS;
    } else if (time >= this.nextLineAt && this.lines.length > 1) {
      this.lineIndex = (this.lineIndex + 1) % this.lines.length;
      this.nextLineAt = time + LINE_MS;
    }
    this.bubble.setText(`${this.def.name} the ${this.def.title}\n${this.currentLine}`).setVisible(this.lines.length > 0);
  }

  override destroy(fromScene?: boolean): void {
    this.bubble.destroy();
    super.destroy(fromScene);
  }
}
