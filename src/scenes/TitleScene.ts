import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';
import { Backdrop } from '../art/stageArt';
import { applySettings, playUiSound } from '../audio/director';
import { getSettings } from '../state/settings';
import { FrameProbe, SLOW_FRAME_MS } from '../util/frameProbe';
import { getSession } from '../state/session';
import { useDetailCamera } from '../ui/detailCamera';
import { gameEvents } from '../util/events';

/**
 * Title screen. Browsers only allow sound after the player clicks or presses
 * a key, so the game asks for one here before anything else.
 */
export class TitleScene extends Phaser.Scene {
  private backdrop: Backdrop | null = null;
  private started = false;
  /** Auto quality: if the title screen already runs slow at 2x, reload at 1x before play starts. */
  private probe = new FrameProbe(1000, 1500);

  constructor() {
    super('Title');
  }

  create(): void {
    useDetailCamera(this);
    this.started = false;
    this.probe = new FrameProbe(1000, 1500);
    this.input.setDefaultCursor('default');
    this.backdrop = new Backdrop(this, 'level1');
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b0d16, 0.35).setOrigin(0, 0);
    this.add
      .text(GAME_WIDTH / 2, 170, 'TAMERUNNER', {
        fontFamily: 'monospace',
        fontSize: '64px',
        fontStyle: 'bold',
        color: '#ffe9a8',
        stroke: '#1b1426',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_WIDTH / 2, 236, 'Run. Shoot. Take their spirits.', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#e6ebf5',
        stroke: '#1b1426',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    const prompt = this.add
      .text(GAME_WIDTH / 2, 360, 'Click or press any key to start', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#1b1426',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 28, 'M mutes sound at any time · P pauses in a stage', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#c9d0e4',
        stroke: '#1b1426',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    gameEvents.emit('music', { track: 'hub' });
    this.input.once('pointerdown', () => this.start());
    this.input.keyboard?.once('keydown', (event: KeyboardEvent) => {
      if (event.code !== 'KeyM') this.start();
    });
  }

  update(time: number, delta: number): void {
    this.backdrop?.scrollTo(time * 0.03);
    const average = this.probe.sample(time, delta);
    if (average === null || average <= SLOW_FRAME_MS) return;
    const settings = getSettings();
    if (settings.quality !== 'auto' || settings.autoLowRes) return;
    applySettings({ ...settings, autoLowRes: true });
    // Nothing is in progress on the title screen, so reloading loses nothing.
    if (RENDER_SCALE > 1) window.location.reload();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.probe.stop();
    playUiSound('click');
    const session = getSession();
    const next = (): void => {
      if (!session.profile.classId) this.scene.start('ClassSelect');
      else if (session.run) this.scene.start('Level', { stageId: session.run.stageId, tier: session.run.tier });
      else this.scene.start('Hub');
    };
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', next);
  }
}
