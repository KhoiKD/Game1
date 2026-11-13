import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { displayScale } from '../art/render';
import { playUiSound } from '../audio/director';
import { artKeys } from '../art/sprites';
import { classDefs, classIds } from '../data/progressionData';
import { weaponData } from '../data/weaponData';
import { getSession, saveSession, setProfile } from '../state/session';
import { useDetailCamera } from '../ui/detailCamera';
import { gameEvents } from '../util/events';

const FONT = 'monospace';
const DIM = '#9aa4bf';
const BRIGHT = '#e6ebf5';
const COLUMN_WIDTH = 296;
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'];

/** Pick a class. Shown on a new game and from the hub; the choice can be changed in the hub later. */
export class ClassSelectScene extends Phaser.Scene {
  constructor() {
    super('ClassSelect');
  }

  create(): void {
    useDetailCamera(this);
    gameEvents.emit('music', { track: 'hub' });
    this.input.setDefaultCursor('default');
    const current = getSession().profile.classId;
    this.add.text(24, 20, 'CHOOSE A CLASS', { fontFamily: FONT, fontSize: '22px', color: BRIGHT });
    this.add.text(24, 54, 'Click a class or press its number. You can change class in the hub between stages.', {
      fontFamily: FONT,
      fontSize: '13px',
      color: DIM,
    });

    classIds.forEach((id, index) => {
      const def = classDefs[id]!;
      const x = 24 + index * (COLUMN_WIDTH + 12);
      const wrap = { width: COLUMN_WIDTH - 70 };
      const panel = this.add.graphics();
      panel.fillStyle(id === current ? 0x1c2233 : 0x141824).fillRect(x, 92, COLUMN_WIDTH, 380);
      panel.lineStyle(1, id === current ? 0x4cc9f0 : 0x2a3042).strokeRect(x, 92, COLUMN_WIDTH, 380);

      // The class character, idling in the corner of its panel.
      const look = artKeys.character(id);
      this.add.sprite(x + COLUMN_WIDTH - 34, 140, look, 0).setScale(1.25 * displayScale(look)).play(`${look}-idle`);

      let y = 108;
      const line = (text: string, color: string, size = 13, gap = 10): void => {
        const label = this.add.text(x + 12, y, text, { fontFamily: FONT, fontSize: `${size}px`, color, wordWrap: wrap });
        y += label.height + gap;
      };
      line(`${index + 1}  ${def.name}${id === current ? '  (current)' : ''}`, BRIGHT, 20, 12);
      line(def.summary, DIM);
      line('PASSIVE', DIM, 12, 4);
      line(def.passiveText, BRIGHT);
      line('FAVOURED WEAPONS', DIM, 12, 4);
      const archetypes = def.affinity.archetypes.map((a) => weaponData.archetypes[a]?.label ?? a).join(', ');
      line(`${archetypes}: +${Math.round(def.affinity.damage * 100)}% damage`, BRIGHT);
      line(`ABILITY (Shift)  ${def.ability.name}`, DIM, 12, 4);
      line(`${def.ability.description} ${Math.round(def.ability.cooldownMs / 1000)}s cooldown.`, BRIGHT);

      this.add
        .text(x + 12, 428, `Choose ${def.name}`, {
          fontFamily: FONT,
          fontSize: '14px',
          color: BRIGHT,
          backgroundColor: '#2a3042',
          padding: { x: 10, y: 7 },
        })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.choose(id));
      const key = DIGIT_KEYS[index];
      if (key) this.input.keyboard?.on(`keydown-${key}`, () => this.choose(id));
    });

    this.add.text(GAME_WIDTH / 2, 500, 'Your weapons, spirits, level, and progress stay the same whichever class you play.', {
      fontFamily: FONT,
      fontSize: '13px',
      color: '#586179',
    }).setOrigin(0.5, 0);
  }

  private choose(classId: string): void {
    playUiSound('click');
    const session = getSession();
    setProfile({ ...session.profile, classId });
    saveSession();
    // A save from an older version can have a stage in progress but no class yet.
    if (session.run) this.scene.start('Level', { stageId: session.run.stageId, tier: session.run.tier });
    else this.scene.start('Hub');
  }
}
