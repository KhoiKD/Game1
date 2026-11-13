import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { balance, findFamily, getFamily, loreFor, type CreatureFamily } from '../data/creatureData';
import { ELEMENTS } from '../data/elementData';
import { SPIRIT_STATS } from '../systems/spiritStats';
import {
  equipSpirit,
  levelOf,
  nextAttunement,
  slotList,
  slotOf,
  spiritName,
  spiritStats,
  stageOf,
  unequipSlot,
  type Spirit,
  type SpiritCollection,
  type SpiritSlot,
} from '../systems/spirits';
import { ELEMENT_COLOR, css } from '../ui/elementColors';
import { capitalize } from '../ui/rarity';
import { useDetailCamera } from '../ui/detailCamera';

export interface SpiritsSceneData {
  spirits: SpiritCollection;
  /** Spirits can only be swapped at a checkpoint (or after the stage is cleared). */
  canEquip: boolean;
  /** Called once when the screen closes, with the collection as the player left it. */
  onClose: (spirits: SpiritCollection) => void;
}

const FONT = 'monospace';
const DIM = '#9aa4bf';
const BRIGHT = '#e6ebf5';
const FAINT = '#586179';
const LEFT_X = 24;
const DETAIL_X = 500;
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** Spirits screen, shown over the paused level: slots, attunement, collection, and details. */
export class SpiritsScene extends Phaser.Scene {
  private spirits!: SpiritCollection;
  private canEquip = false;
  private onClose!: (spirits: SpiritCollection) => void;
  private selectedId: string | null = null;
  private message = '';

  constructor() {
    super('Spirits');
  }

  init(data: SpiritsSceneData): void {
    this.spirits = data.spirits;
    this.canEquip = data.canEquip;
    this.onClose = data.onClose;
    this.selectedId = data.spirits.spirits[0]?.familyId ?? null;
    this.message = '';
  }

  create(): void {
    useDetailCamera(this);
    this.input.setDefaultCursor('default');
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    const onPress = (key: string, action: () => void): void => {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (!event.repeat) action();
      });
    };
    DIGIT_KEYS.forEach((key, index) => onPress(key, () => this.equipToSlotIndex(index)));
    onPress('U', () => this.unequipSelected());
    for (const key of ['C', 'ESC']) onPress(key, () => this.close());
    this.render();
  }

  // ---- actions -----------------------------------------------------------

  private slots(): SpiritSlot[] {
    return slotList(this.spirits, balance);
  }

  private equipToSlotIndex(index: number): void {
    const slot = this.slots()[index];
    if (!slot || this.selectedId === null) return;
    if (!this.canEquip) {
      this.message = 'Spirits can only be swapped at a checkpoint.';
    } else {
      const next = equipSpirit(this.spirits, this.selectedId, slot.key, findFamily, balance);
      if (next === this.spirits) {
        const blocked = slot.element !== null && !getFamily(this.selectedId).elements.includes(slot.element);
        this.message = blocked ? `That slot only takes ${slot.element} spirits.` : '';
      } else {
        this.message = `Equipped in slot ${index + 1}`;
      }
      this.spirits = next;
    }
    this.render();
  }

  private unequipSelected(): void {
    if (this.selectedId === null) return;
    const key = slotOf(this.spirits, this.selectedId);
    if (key === null) return;
    if (!this.canEquip) this.message = 'Spirits can only be swapped at a checkpoint.';
    else {
      this.spirits = unequipSlot(this.spirits, key);
      this.message = 'Unequipped';
    }
    this.render();
  }

  private close(): void {
    this.onClose(this.spirits);
    this.scene.stop();
  }

  // ---- drawing -----------------------------------------------------------

  private render(): void {
    this.children.removeAll(true);
    this.add.graphics().fillStyle(0x0b0d14, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.label(LEFT_X, 16, 'SPIRITS', BRIGHT, 20);
    const hint = this.canEquip
      ? 'Click a spirit to inspect · number keys equip to a slot · U unequip · C or Esc close'
      : 'Spirits can be swapped only at a checkpoint · C or Esc close';
    this.label(LEFT_X, 46, hint, this.canEquip ? DIM : '#ffd166', 13);

    let y = 84;
    this.label(LEFT_X, y, 'SLOTS', DIM, 13);
    y += 22;
    this.slots().forEach((slot, index) => {
      const familyId = this.spirits.equipped[slot.key];
      const spirit = this.spirits.spirits.find((s) => s.familyId === familyId);
      const kind = slot.element ?? 'Any';
      this.label(LEFT_X, y, `${index + 1}`, DIM, 14);
      this.label(LEFT_X + 22, y, kind, slot.element ? css(ELEMENT_COLOR[slot.element]) : DIM, 14);
      if (spirit) this.spiritRow(LEFT_X + 100, y, spirit);
      else this.label(LEFT_X + 100, y, 'empty', FAINT, 14);
      if (index === 0) this.label(LEFT_X + 330, y, 'ability slot', FAINT, 12);
      y += 23;
    });

    y += 10;
    this.label(LEFT_X, y, 'ATTUNEMENT  captures toward the next slot of each element', DIM, 13);
    y += 21;
    ELEMENTS.forEach((element, index) => {
      const progress = nextAttunement(this.spirits, element, balance);
      const text = progress ? `${element} ${progress.have}/${progress.need}` : `${element} max`;
      this.label(LEFT_X + (index % 3) * 150, y + Math.floor(index / 3) * 20, text, css(ELEMENT_COLOR[element]), 13);
    });

    y += 52;
    this.label(LEFT_X, y, `COLLECTION  ${this.spirits.spirits.length} captured`, DIM, 13);
    y += 22;
    if (this.spirits.spirits.length === 0) {
      this.label(LEFT_X, y, 'None yet. Bring a creature to zero health,', FAINT, 14);
      this.label(LEFT_X, y + 20, 'then press F beside it to capture its spirit.', FAINT, 14);
    }
    const rows = Math.max(1, Math.floor((GAME_HEIGHT - 44 - y) / 23));
    this.spirits.spirits.forEach((spirit, index) => {
      this.spiritRow(LEFT_X + Math.floor(index / rows) * 230, y + (index % rows) * 23, spirit);
    });

    this.renderDetails();
    if (this.message) this.label(LEFT_X, GAME_HEIGHT - 28, this.message, '#ffd166', 14);
  }

  private renderDetails(): void {
    this.add.graphics().lineStyle(1, 0x2a3042).lineBetween(DETAIL_X - 20, 84, DETAIL_X - 20, GAME_HEIGHT - 50);
    const spirit = this.spirits.spirits.find((s) => s.familyId === this.selectedId);
    if (!spirit) {
      this.label(DETAIL_X, 106, 'Select a spirit to see what it gives you.', DIM, 14);
      return;
    }
    const family = getFamily(spirit.familyId);
    const stage = stageOf(spirit, family, balance);
    const level = levelOf(spirit, balance);
    const color = css(ELEMENT_COLOR[family.elements[0]!]);

    this.label(DETAIL_X, 84, spiritName(spirit, family, balance), color, 20);
    const boss = spirit.perkMult > 1 ? ' · boss spirit' : '';
    this.label(DETAIL_X, 112, `Stage ${stage} · Lv ${level} · ${family.elements.join('/')} · ${family.role} · ${capitalize(family.rarity)}${boss}`, DIM, 13);
    // Lore where it has been written; the real species it is based on otherwise.
    const lore = loreFor(spiritName(spirit, family, balance));
    this.add.text(DETAIL_X, 131, lore ?? `Based on: ${family.inspiration}`, {
      fontFamily: FONT,
      fontSize: '12px',
      color: FAINT,
      fontStyle: lore ? 'italic' : 'normal',
      wordWrap: { width: 430 },
    });
    this.label(DETAIL_X, 165, growthLine(spirit, family), DIM, 13);

    let y = 190;
    const stats = spiritStats(spirit, family, balance);
    SPIRIT_STATS.forEach((stat, index) => {
      const x = DETAIL_X + (index % 2) * 210;
      const rowY = y + Math.floor(index / 2) * 19;
      this.label(x, rowY, capitalize(stat), DIM, 13);
      this.label(x + 80, rowY, `${Math.round(stats[stat])}`, BRIGHT, 13);
    });

    y += 48;
    this.label(DETAIL_X, y, 'WHEN EQUIPPED', DIM, 13);
    y += 20;
    for (const line of perkLines(spirit, family)) {
      this.label(DETAIL_X, y, line, BRIGHT, 13);
      y += 18;
    }

    y += 8;
    const [abilityName, abilityText] = family.ability.split(':').map((part) => part.trim());
    const effect = balance.abilities.byRole[family.role] ?? '';
    this.label(DETAIL_X, y, `ABILITY  ${abilityName}`, DIM, 13);
    y += 20;
    const effectText = capitalize(EFFECT_TEXT[effect] ?? effect);
    this.add.text(DETAIL_X, y, `${effectText}. Right click to use while this spirit is in slot 1.\nLore: ${abilityText}.`, {
      fontFamily: FONT,
      fontSize: '12px',
      color: FAINT,
      wordWrap: { width: 430 },
    });

    if (!this.canEquip) return;
    const buttonY = GAME_HEIGHT - 62;
    let x = DETAIL_X;
    this.slots().forEach((slot, index) => {
      if (slot.element !== null && !family.elements.includes(slot.element)) return;
      if (x > GAME_WIDTH - 170) return;
      this.button(x, buttonY, `Slot ${index + 1}`, () => this.equipToSlotIndex(index));
      x += 84;
    });
    if (slotOf(this.spirits, spirit.familyId) !== null) this.button(x, buttonY, 'Unequip', () => this.unequipSelected());
  }

  private spiritRow(x: number, y: number, spirit: Spirit): void {
    const family = getFamily(spirit.familyId);
    const selected = spirit.familyId === this.selectedId;
    const name = `${selected ? '>' : ' '} ${spiritName(spirit, family, balance)}  Lv ${levelOf(spirit, balance)}`;
    const text = this.label(x, y, name, css(ELEMENT_COLOR[family.elements[0]!]), 14);
    if (selected) text.setBackgroundColor('#1c2233');
    text.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.selectedId = spirit.familyId;
      this.message = '';
      this.render();
    });
  }

  private button(x: number, y: number, text: string, action: () => void): void {
    this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '13px', color: BRIGHT, backgroundColor: '#2a3042', padding: { x: 8, y: 6 } })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color });
  }
}

const EFFECT_TEXT: Record<string, string> = {
  burst: 'damages enemies around you',
  bolt: 'fires a heavy elemental shot',
  shield: 'makes you briefly invulnerable',
  heal: 'restores health',
  field: 'inflicts its status around the reticle',
};

const pct = (fraction: number): string => `${Number((fraction * 100).toFixed(1))}%`;

function growthLine(spirit: Spirit, family: CreatureFamily): string {
  const level = levelOf(spirit, balance);
  const stage = stageOf(spirit, family, balance);
  const toNext = balance.growth.perLevel - (spirit.growth % balance.growth.perLevel);
  const levelText = level >= balance.growth.maxLevel ? 'Max level' : `${Number(toNext.toFixed(1))} growth to Lv ${level + 1}`;
  if (stage === 3) return `${levelText} · fully evolved`;
  return `${levelText} · becomes ${family.stages[stage]} at Lv ${family.evolvesAt[stage - 1]}`;
}

/** What this one spirit contributes when equipped. */
function perkLines(spirit: Spirit, family: CreatureFamily): string[] {
  const stats = spiritStats(spirit, family, balance);
  const p = balance.perks;
  return [
    `+${pct(stats.power * p.damagePerPower)} weapon damage    +${pct(stats.focus * p.critPerFocus)} crit chance`,
    `+${pct(stats.agility * p.speedPerAgility)} move speed      -${pct(stats.agility * p.reloadPerAgility)} reload time`,
    `+${Number((stats.vitality * p.hpPerVitality).toFixed(2))} max health      -${pct(stats.focus * p.cooldownPerFocus)} ability cooldown`,
    `+${pct(p.affinityDamage)} damage with ${family.elements.join(' and ')} weapons`,
  ];
}
