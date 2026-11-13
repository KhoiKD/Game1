import Phaser from 'phaser';

const POOL_SIZE = 32;

/**
 * Damage numbers and short labels that float up and fade. Text objects are
 * reused from a fixed pool instead of being created for every hit; when all
 * are busy, the oldest is recycled.
 */
export class FloatingText {
  private readonly pool: Phaser.GameObjects.Text[] = [];
  private next = 0;

  constructor(private readonly scene: Phaser.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push(
        scene.add
          .text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5)
          .setDepth(50)
          .setVisible(false),
      );
    }
  }

  show(x: number, y: number, text: string, color: string, size: number): void {
    const label = this.pool[this.next]!;
    this.next = (this.next + 1) % POOL_SIZE;
    this.scene.tweens.killTweensOf(label);
    label.setText(text).setColor(color).setFontSize(size).setPosition(x, y).setAlpha(1).setVisible(true);
    this.scene.tweens.add({
      targets: label,
      y: y - 26,
      alpha: 0,
      duration: 520,
      onComplete: () => label.setVisible(false),
    });
  }
}
