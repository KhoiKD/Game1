import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { balance, getFamily } from '../data/creatureData';
import { resolveWeaponInstance } from '../data/lootData';
import { findClass, progression } from '../data/progressionData';
import { weaponData } from '../data/weaponData';
import { getSession, resetSession, saveSession, setProfile, setRun } from '../state/session';
import { equippedItems } from '../systems/inventory';
import { levelProgress, powerScore, requiredPower, tierStatus, type StageDef, type TierRule } from '../systems/progression';
import { equippedSpirits, levelOf, spiritName } from '../systems/spirits';
import { rarityCss } from '../ui/rarity';
import type { InventorySceneData } from './InventoryScene';
import type { SpiritsSceneData } from './SpiritsScene';
import { useDetailCamera } from '../ui/detailCamera';
import { gameEvents } from '../util/events';

const FONT = 'monospace';
const DIM = '#9aa4bf';
const BRIGHT = '#e6ebf5';
const FAINT = '#586179';
const X = 24;
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

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
    useDetailCamera(this).fadeIn(250, 0, 0, 0);
    gameEvents.emit('music', { track: 'hub' });
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
    // Number keys start a stage tier: 1-3 for the first stage, 4-6 for the second, and so on.
    this.choices().forEach(({ stage, tier }, index) => {
      const key = DIGIT_KEYS[index];
      if (key) onPress(key, () => this.startStage(stage, tier));
    });
    this.render();
  }

  // ---- actions -----------------------------------------------------------

  private choices(): Array<{ stage: StageDef; tier: TierRule }> {
    return progression.stages.flatMap((stage) => progression.tiers.map((tier) => ({ stage, tier })));
  }

  private power(): number {
    const { profile } = getSession();
    return powerScore(profile.inventory, levelProgress(profile.xp, progression).level, progression);
  }

  private status(stage: StageDef, tier: TierRule) {
    const { cleared } = getSession().profile;
    return tierStatus(tier.tier, this.power(), cleared[stage.id] ?? 0, progression, stage, cleared);
  }

  /** Why a tier cannot be started yet, or an empty string when it can. */
  private lockReason(stage: StageDef, tier: TierRule): string {
    switch (this.status(stage, tier)) {
      case 'needs-stage': {
        const needed = progression.stages.find((s) => s.id === stage.requires)?.name ?? 'the stage before it';
        return `clear ${needed} first`;
      }
      case 'needs-clear':
        return `clear ${progression.tiers[tier.tier - 2]?.name ?? 'the tier below'} first`;
      case 'needs-power':
        return `needs Power ${requiredPower(tier.tier, stage, progression)}`;
      case 'open':
        return '';
    }
  }

  private startStage(stage: StageDef, tier: TierRule): void {
    const reason = this.lockReason(stage, tier);
    if (reason) {
      this.message = `${stage.name} ${tier.name}: ${reason}.`;
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

    this.label(X, 14, 'HUB', BRIGHT, 22);
    this.label(X + 70, 21, 'Pick a stage and tier to play. Everything here is saved.', DIM, 13);

    let y = 52;
    const xpText = progress.needed > 0 ? `XP ${progress.into}/${progress.needed}` : 'max level';
    this.label(X, y, `${classDef?.name ?? 'No class'} · Level ${progress.level} · ${xpText} · Power ${this.power()}`, BRIGHT, 16);
    y += 25;
    if (classDef) {
      const archetypes = classDef.affinity.archetypes.map((a) => weaponData.archetypes[a]?.label ?? a).join(', ');
      this.label(X, y, `Passive: ${classDef.passiveText} · Favoured: ${archetypes} (+${Math.round(classDef.affinity.damage * 100)}%)`, DIM, 13);
      this.label(X, y + 18, `Ability (Shift): ${classDef.ability.name}. ${classDef.ability.description}`, DIM, 13);
      y += 40;
    }
    this.label(X, y, 'WEAPONS', DIM, 13);
    let wx = X + 90;
    for (const item of equippedItems(profile.inventory)) {
      const text = this.label(wx, y, resolveWeaponInstance(item).name, rarityCss(item.rarity), 13);
      wx += text.width + 18;
    }
    y += 18;
    this.label(X, y, 'SPIRITS', DIM, 13);
    const spirits = equippedSpirits(profile.spirits, balance)
      .map((s) => `${spiritName(s, getFamily(s.familyId), balance)} Lv ${levelOf(s, balance)}`)
      .join('   ');
    this.label(X + 90, y, spirits || 'none equipped', spirits ? BRIGHT : FAINT, 13);

    y += 30;
    this.label(X, y, 'STAGES  higher tiers bring evolved creatures, a tougher boss, and more experience', DIM, 13);
    y += 22;
    let choice = 0;
    for (const stage of progression.stages) {
      const cleared = profile.cleared[stage.id] ?? 0;
      this.label(X, y, stage.name, BRIGHT, 15);
      this.label(X + 120, y + 2, stage.blurb, FAINT, 13);
      y += 23;
      progression.tiers.forEach((tier, index) => {
        choice += 1;
        const reason = this.lockReason(stage, tier);
        const note = reason || (cleared >= tier.tier ? 'cleared · play again' : 'ready');
        const text = this.add
          .text(X + index * 304, y, `${choice}  ${tier.name} · ${note}\n   creatures +${tier.stageBonus} · boss x${tier.bossHpMult} · XP x${tier.xpMult}`, {
            fontFamily: FONT,
            fontSize: '12px',
            color: reason ? FAINT : BRIGHT,
            backgroundColor: reason ? '#141824' : '#2a3042',
            padding: { x: 8, y: 6 },
            fixedWidth: 292,
          })
          .setInteractive({ useHandCursor: !reason });
        text.on('pointerdown', () => this.startStage(stage, tier));
      });
      y += 54;
    }

    const buttonY = GAME_HEIGHT - 62;
    this.button(X, buttonY, 'I  Inventory', () => this.openInventory());
    this.button(X + 150, buttonY, 'C  Spirits', () => this.openSpirits());
    this.button(X + 280, buttonY, 'K  Change class', () => this.scene.start('ClassSelect'));
    this.label(X, GAME_HEIGHT - 24, this.message || 'F9 erases the save and starts over.', this.message ? '#ffd166' : FAINT, 13);
  }

  private button(x: number, y: number, text: string, action: () => void): void {
    this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '14px', color: BRIGHT, backgroundColor: '#2a3042', padding: { x: 10, y: 6 } })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color });
  }
}
