import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { applySettings, playUiSound } from '../audio/director';
import { getSettings, type Settings } from '../state/settings';
import { useDetailCamera } from '../ui/detailCamera';

export interface PauseSceneData {
  /** Leaving mid-stage loses anything not yet secured at a checkpoint. */
  atRisk: boolean;
  onClose: (choice: 'resume' | 'hub') => void;
}

const FONT = 'monospace';
const BRIGHT = '#e6ebf5';
const DIM = '#9aa4bf';
const STEP = 0.1;

/** P in a stage: volume, mute, resume, or leave for the hub. Runs over the paused level. */
export class PauseScene extends Phaser.Scene {
  private options!: PauseSceneData;
  private values!: Phaser.GameObjects.Text;
  private warning!: Phaser.GameObjects.Text;
  private leaveArmed = false;
  private closed = false;

  constructor() {
    super('Pause');
  }

  init(data: PauseSceneData): void {
    this.options = data;
    this.leaveArmed = false;
    this.closed = false;
  }

  create(): void {
    useDetailCamera(this);
    this.input.setDefaultCursor('default');
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x07080d, 0.72).setOrigin(0, 0);
    const cx = GAME_WIDTH / 2;
    this.add.text(cx, 120, 'PAUSED', { fontFamily: FONT, fontSize: '32px', color: BRIGHT }).setOrigin(0.5);

    this.values = this.add.text(cx - 150, 190, '', { fontFamily: FONT, fontSize: '16px', color: BRIGHT, lineSpacing: 18 });
    const button = (x: number, y: number, label: string, action: () => void): void => {
      this.add
        .text(x, y, label, { fontFamily: FONT, fontSize: '14px', color: BRIGHT, backgroundColor: '#2a3042', padding: { x: 8, y: 4 } })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          playUiSound('click');
          action();
        });
    };
    const adjust = (key: 'music' | 'sfx', delta: number): void => this.change({ [key]: Math.round((getSettings()[key] + delta) * 10) / 10 });
    button(cx + 90, 188, '-', () => adjust('music', -STEP));
    button(cx + 130, 188, '+', () => adjust('music', STEP));
    button(cx + 90, 222, '-', () => adjust('sfx', -STEP));
    button(cx + 130, 222, '+', () => adjust('sfx', STEP));
    button(cx + 90, 256, 'toggle', () => this.change({ muted: !getSettings().muted }));

    button(cx - 150, 320, 'Resume (P)', () => this.close('resume'));
    button(cx + 10, 320, 'Leave for the hub (H)', () => this.leave());
    this.warning = this.add.text(cx, 372, '', { fontFamily: FONT, fontSize: '13px', color: '#ffd166' }).setOrigin(0.5);
    this.add
      .text(cx, 420, '1 / 2 music · 3 / 4 effects · M mute', { fontFamily: FONT, fontSize: '12px', color: DIM })
      .setOrigin(0.5);

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-P', () => this.close('resume'));
    keyboard?.on('keydown-ESC', () => this.close('resume'));
    keyboard?.on('keydown-H', () => this.leave());
    keyboard?.on('keydown-ONE', () => adjust('music', -STEP));
    keyboard?.on('keydown-TWO', () => adjust('music', STEP));
    keyboard?.on('keydown-THREE', () => adjust('sfx', -STEP));
    keyboard?.on('keydown-FOUR', () => adjust('sfx', STEP));
    // M is handled everywhere by the audio director; just show the new state.
    keyboard?.on('keydown-M', () => this.time.delayedCall(0, () => this.refresh()));
    this.refresh();
  }

  private change(patch: Partial<Settings>): void {
    applySettings({ ...getSettings(), ...patch });
    this.refresh();
  }

  private refresh(): void {
    const s = getSettings();
    const pct = (v: number): string => `${Math.round(v * 100)}%`.padStart(4);
    this.values.setText([`Music     ${pct(s.music)}`, `Effects   ${pct(s.sfx)}`, `Sound     ${s.muted ? 'off' : 'on'}`].join('\n'));
  }

  private leave(): void {
    if (this.options.atRisk && !this.leaveArmed) {
      this.leaveArmed = true;
      this.warning.setText('Leave now and anything at risk is lost. Press H again to leave.');
      return;
    }
    this.close('hub');
  }

  private close(choice: 'resume' | 'hub'): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.stop();
    this.options.onClose(choice);
  }
}
