import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { balance, getFamily } from '../data/creatureData';
import { resolveWeaponInstance } from '../data/lootData';
import { findClass, progression } from '../data/progressionData';
import { weaponData } from '../data/weaponData';
import { getSession, resetSession, saveSession, setProfile, setRun } from '../state/session';
import { equippedItems } from '../systems/inventory';
import { levelProgress, powerScore, tierStatus, type StageDef, type TierRule } from '../systems/progression';
import { equippedSpirits, levelOf, spiritName } from '../systems/spirits';
import { rarityCss } from '../ui/rarity';
import type { InventorySceneData } from './InventoryScene';
import type { SpiritsSceneData } from './SpiritsScene';

const FONT = 'monospace';
const DIM = '#9aa4bf';
const BRIGHT = '#e6ebf5';
const FAINT = '#586179';
const X = 24;
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];

/**
 * The hub between stages: review the character, manage weapons and spirits,
 * change class, and pick a stage and tier to play.
 */
export class HubScene extends Phaser.Scene {
  private message = '';

  constructor() {
    super('Hub');
  }

  create(): void {
    this.input.setDefaultCursor('default');
    this.message = '';
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    const onPress = (key: string, action: () => void): void => {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (!event.repeat) action();
      });
    };
    onPress('I', () => this.openInventory());
    onPress('C', () => this.openSpirits());
    onPress('K', () => this.scene.start('ClassSelect'));
    onPress('F9', () => {
      resetSession();
      this.scene.start('Boot');
    });
    const firstStage = progression.stages[0];
    progression.tiers.forEach((tier, index) => {
      const key = DIGIT_KEYS[index];
      if (key && firstStage) onPress(key, () => this.startStage(firstStage, tier));
    });
    this.render();
  }

  // ---- actions -----------------------------------------------------------

  private power(): number {
    const { profile } = getSession();
    return powerScore(profile.inventory, levelProgress(profile.xp, progression).level, progression);
  }

  private startStage(stage: StageDef, tier: TierRule): void {
    const { profile } = getSession();
    const status = tierStatus(tier.tier, this.power(), profile.cleared[stage.id] ?? 0, progression);
    if (status !== 'open') {
      this.message =
        status === 'needs-power'
          ? `${tier.name} needs Power ${tier.requiredPower}. Equip rarer weapons or level up.`
          : `Clear ${progression.tiers[tier.tier - 2]?.name ?? 'the tier below'} of ${stage.name} first.`;
      this.render();
      return;
    }
    setRun(null);
    saveSession();
    this.scene.start('Level', { stageId: stage.id, tier: tier.tier });
  }

  private openInventory(): void {
    if (this.scene.isActive('Inventory') || this.scene.isActive('Spirits')) return;
    const data: InventorySceneData = {
      inventory: getSession().profile.inventory,
      onClose: (inventory) => {
        setProfile({ ...getSession().profile, inventory });
        saveSession();
        this.scene.resume();
        this.render();
      },
    };
    this.scene.launch('Inventory', data);
    this.scene.pause();
  }

  private openSpirits(): void {
    if (this.scene.isActive('Inventory') || this.scene.isActive('Spirits')) return;
    const data: SpiritsSceneData = {
      spirits: getSession().profile.spirits,
      canEquip: true, // the hub is always a safe place to swap spirits
      onClose: (spirits) => {
        setProfile({ ...getSession().profile, spirits });
        saveSession();
        this.scene.resume();
        this.render();
      },
    };
    this.scene.launch('Spirits', data);
    this.scene.pause();
  }

  // ---- drawing -----------------------------------------------------------

  private render(): void {
    this.children.removeAll(true);
    this.add.graphics().fillStyle(0x0b0d14, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const { profile } = getSession();
    const classDef = findClass(profile.classId);
    const progress = levelProgress(profile.xp, progression);
    const power = this.power();

    this.label(X, 16, 'HUB', BRIGHT, 22);
    this.label(X, 50, 'Pick a stage and tier to play. Everything here is saved.', DIM, 13);

    let y = 84;
    this.label(X, y, 'CHARACTER', DIM, 13);
    y += 22;
    const xpText = progress.needed > 0 ? `XP ${progress.into}/${progress.needed}` : 'max level';
    this.label(X, y, `${classDef?.name ?? 'No class'} · Level ${progress.level} · ${xpText} · Power ${power}`, BRIGHT, 16);
    y += 26;
    if (classDef) {
      const archetypes = classDef.affinity.archetypes.map((a) => weaponData.archetypes[a]?.label ?? a).join(', ');
      this.label(X, y, `Passive: ${classDef.passiveText}`, DIM, 13);
      this.label(X, y + 19, `Favoured weapons: ${archetypes} (+${Math.round(classDef.affinity.damage * 100)}% damage)`, DIM, 13);
      this.label(X, y + 38, `Ability (Shift): ${classDef.ability.name}. ${classDef.ability.description}`, DIM, 13);
      y += 62;
    }

    this.label(X, y, 'WEAPONS', DIM, 13);
    let wx = X + 90;
    for (const item of equippedItems(profile.inventory)) {
      const text = this.label(wx, y, resolveWeaponInstance(item).name, rarityCss(item.rarity), 13);
      wx += text.width + 18;
    }
    y += 20;
    this.label(X, y, 'SPIRITS', DIM, 13);
    const spirits = equippedSpirits(profile.spirits, balance)
      .map((s) => `${spiritName(s, getFamily(s.familyId), balance)} Lv ${levelOf(s, balance)}`)
      .join('   ');
    this.label(X + 90, y, spirits || 'none equipped', spirits ? BRIGHT : FAINT, 13);

    y += 36;
    this.label(X, y, 'STAGES', DIM, 13);
    y += 22;
    for (const stage of progression.stages) {
      const cleared = profile.cleared[stage.id] ?? 0;
      this.label(X, y, stage.name, BRIGHT, 16);
      this.label(X + 130, y + 2, stage.blurb, FAINT, 13);
      y += 28;
      progression.tiers.forEach((tier, index) => {
        const status = tierStatus(tier.tier, power, cleared, progression);
        const done = cleared >= tier.tier;
        let note = done ? 'cleared · play again' : 'ready';
        if (status === 'needs-power') note = `needs Power ${tier.requiredPower}`;
        if (status === 'needs-clear') note = 'clear the tier below first';
        const open = status === 'open';
        const text = this.add
          .text(X + index * 300, y, `${index + 1}  ${tier.name}\n   ${note}\n   enemy health x${tier.enemyHpMult} · XP x${tier.xpMult}`, {
            fontFamily: FONT,
            fontSize: '13px',
            color: open ? BRIGHT : FAINT,
            backgroundColor: open ? '#2a3042' : '#141824',
            padding: { x: 10, y: 8 },
            fixedWidth: 284,
          })
          .setInteractive({ useHandCursor: open });
        text.on('pointerdown', () => this.startStage(stage, tier));
      });
      y += 84;
    }

    const buttonY = GAME_HEIGHT - 78;
    this.button(X, buttonY, 'I  Inventory', () => this.openInventory());
    this.button(X + 150, buttonY, 'C  Spirits', () => this.openSpirits());
    this.button(X + 280, buttonY, 'K  Change class', () => this.scene.start('ClassSelect'));
    this.label(X, GAME_HEIGHT - 30, this.message || 'F9 erases the save and starts over.', this.message ? '#ffd166' : FAINT, 13);
  }

  private button(x: number, y: number, text: string, action: () => void): void {
    this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '14px', color: BRIGHT, backgroundColor: '#2a3042', padding: { x: 10, y: 7 } })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color });
  }
}
