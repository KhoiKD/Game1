import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { getPerk, resolveWeaponInstance } from '../data/lootData';
import type { ResolvedWeapon } from '../data/weaponData';
import {
  EQUIP_SLOTS,
  INVENTORY_CAPACITY,
  backpackItems,
  discard,
  equip,
  isEquipped,
  type Inventory,
} from '../systems/inventory';
import type { WeaponInstance } from '../systems/loot';
import { capitalize, rarityCss } from '../ui/rarity';

export interface InventorySceneData {
  inventory: Inventory;
  /** Called once when the screen closes, with the inventory as the player left it. */
  onClose: (inventory: Inventory) => void;
}

const FONT = 'monospace';
const DIM = '#9aa4bf';
const BRIGHT = '#e6ebf5';
const LEFT_X = 24;
const DETAIL_X = 500;
const BACKPACK_ROWS = 9;

/**
 * Inventory screen, shown over the paused level. Click a weapon to inspect it,
 * then equip it to a slot or discard it.
 */
export class InventoryScene extends Phaser.Scene {
  private inventory!: Inventory;
  private onClose!: (inventory: Inventory) => void;
  private selectedUid: string | null = null;
  private message = '';

  constructor() {
    super('Inventory');
  }

  init(data: InventorySceneData): void {
    this.inventory = data.inventory;
    this.onClose = data.onClose;
    this.selectedUid = data.inventory.equipped.find((uid) => uid !== null) ?? data.inventory.items[0]?.uid ?? null;
    this.message = '';
  }

  create(): void {
    this.input.setDefaultCursor('default');
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    keyboard.addCapture('TAB');
    const onPress = (key: string, action: () => void): void => {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (!event.repeat) action();
      });
    };
    onPress('ONE', () => this.equipSelected(0));
    onPress('TWO', () => this.equipSelected(1));
    onPress('THREE', () => this.equipSelected(2));
    onPress('X', () => this.discardSelected());
    for (const key of ['I', 'TAB', 'ESC']) onPress(key, () => this.close());
    this.render();
  }

  // ---- actions -----------------------------------------------------------

  private equipSelected(slot: number): void {
    if (this.selectedUid === null) return;
    const next = equip(this.inventory, this.selectedUid, slot);
    this.message = next === this.inventory ? '' : `Equipped to slot ${slot + 1}`;
    this.inventory = next;
    this.render();
  }

  private discardSelected(): void {
    const uid = this.selectedUid;
    if (uid === null) return;
    if (isEquipped(this.inventory, uid)) {
      this.message = 'Equipped weapons cannot be discarded. Equip another weapon in that slot first.';
    } else {
      this.inventory = discard(this.inventory, uid);
      this.selectedUid = this.inventory.equipped.find((u) => u !== null) ?? null;
      this.message = 'Discarded';
    }
    this.render();
  }

  private close(): void {
    this.onClose(this.inventory);
    this.scene.stop();
  }

  // ---- drawing -----------------------------------------------------------

  private render(): void {
    this.children.removeAll(true);
    // Opaque, so the level's HUD cannot show through behind the text.
    this.add.graphics().fillStyle(0x0b0d14, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.label(LEFT_X, 16, 'INVENTORY', BRIGHT, 20);
    this.label(LEFT_X, 46, 'Click a weapon to inspect · 1 2 3 equip to slot · X discard · I or Esc close', DIM, 13);

    this.label(LEFT_X, 84, 'EQUIPPED', DIM, 13);
    for (let slot = 0; slot < EQUIP_SLOTS; slot++) {
      const uid = this.inventory.equipped[slot] ?? null;
      const item = uid === null ? undefined : this.inventory.items.find((i) => i.uid === uid);
      const y = 106 + slot * 26;
      this.label(LEFT_X, y, `${slot + 1}`, DIM, 15);
      if (item) this.itemRow(LEFT_X + 24, y, item);
      else this.label(LEFT_X + 24, y, 'empty', '#586179', 15);
    }

    const backpack = backpackItems(this.inventory);
    this.label(LEFT_X, 204, `BACKPACK  ${this.inventory.items.length}/${INVENTORY_CAPACITY} carried`, DIM, 13);
    if (backpack.length === 0) {
      this.label(LEFT_X, 226, 'Nothing here yet. Defeated enemies sometimes drop weapons.', '#586179', 14);
    }
    backpack.forEach((item, index) => {
      const column = Math.floor(index / BACKPACK_ROWS);
      const row = index % BACKPACK_ROWS;
      this.itemRow(LEFT_X + column * 230, 226 + row * 26, item);
    });

    this.renderDetails();
    if (this.message) this.label(LEFT_X, GAME_HEIGHT - 30, this.message, '#ffd166', 14);
  }

  private renderDetails(): void {
    const item = this.inventory.items.find((i) => i.uid === this.selectedUid);
    this.add.graphics().lineStyle(1, 0x2a3042).lineBetween(DETAIL_X - 20, 84, DETAIL_X - 20, GAME_HEIGHT - 50);
    if (!item) {
      this.label(DETAIL_X, 106, 'Select a weapon to see its stats.', DIM, 14);
      return;
    }
    const weapon = resolveWeaponInstance(item);
    this.label(DETAIL_X, 84, weapon.name, rarityCss(item.rarity), 20);
    this.label(DETAIL_X, 112, `${capitalize(item.rarity)} · ${weapon.archetypeLabel} · ${weapon.element}`, DIM, 14);

    let y = 146;
    for (const [name, value] of statLines(weapon)) {
      this.label(DETAIL_X, y, name, DIM, 14);
      this.label(DETAIL_X + 110, y, value, BRIGHT, 14);
      y += 21;
    }

    y += 10;
    this.label(DETAIL_X, y, 'PERKS', DIM, 13);
    y += 22;
    if (item.perks.length === 0) this.label(DETAIL_X, y, 'None', '#586179', 14);
    for (const id of item.perks) {
      const perk = getPerk(id);
      this.label(DETAIL_X, y, `${perk.name}`, BRIGHT, 14);
      this.label(DETAIL_X + 130, y, perk.description, DIM, 14);
      y += 21;
    }

    const buttonY = GAME_HEIGHT - 62;
    for (let slot = 0; slot < EQUIP_SLOTS; slot++) {
      this.button(DETAIL_X + slot * 106, buttonY, `Equip ${slot + 1}`, () => this.equipSelected(slot));
    }
    this.button(DETAIL_X + EQUIP_SLOTS * 106, buttonY, 'Discard', () => this.discardSelected());
  }

  private itemRow(x: number, y: number, item: WeaponInstance): void {
    const weapon = resolveWeaponInstance(item);
    const selected = item.uid === this.selectedUid;
    const text = this.label(x, y, `${selected ? '>' : ' '} ${weapon.name}`, rarityCss(item.rarity), 15);
    if (selected) text.setBackgroundColor('#1c2233');
    text.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.selectedUid = item.uid;
      this.message = '';
      this.render();
    });
  }

  private button(x: number, y: number, text: string, action: () => void): void {
    this.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: '14px',
        color: BRIGHT,
        backgroundColor: '#2a3042',
        padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color });
  }
}

const round = (value: number, digits = 1): string => String(Number(value.toFixed(digits)));

/** Player-facing stat lines for the details panel. */
export function statLines(weapon: ResolvedWeapon): Array<[string, string]> {
  const isBurst = weapon.trigger === 'burst' || weapon.trigger === 'semi-burst';
  const shotsPerPull = isBurst ? weapon.burstCount : 1;
  const cycleMs = weapon.fireIntervalMs + (weapon.trigger === 'charge' ? weapon.chargeMs : 0);
  const damage = weapon.pellets > 1 ? `${round(weapon.damage, 2)} x ${weapon.pellets}` : round(weapon.damage, 2);
  const lines: Array<[string, string]> = [
    ['Damage', damage],
    ['Fire rate', `${round((shotsPerPull * 1000) / cycleMs)} shots/s`],
    ['Range', `${Math.round(weapon.range)}`],
    ['Stability', `${Math.round(weapon.stability)}`],
    ['Reload', `${round(weapon.reloadMs / 1000, 2)}s`],
    ['Magazine', `${weapon.magazine}`],
    ['Handling', `${Math.round(weapon.handling)}`],
  ];
  if (weapon.pierce > 0) lines.push(['Pierce', weapon.pierce >= 99 ? 'all enemies' : `+${weapon.pierce}`]);
  if (weapon.blastRadius > 0) lines.push(['Blast', `${Math.round(weapon.blastRadius)}`]);
  if (weapon.trigger === 'charge') lines.push(['Charge', `${round(weapon.chargeMs / 1000, 2)}s`]);
  return lines;
}
