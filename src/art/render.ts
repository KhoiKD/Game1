import Phaser from 'phaser';
import { creatureFamilies } from '../data/creatureData';
import { WEAPON_ELEMENTS } from '../data/weaponData';
import { RENDER_SCALE } from '../config';
import { ELEMENT_RAMPS, OUTLINE, WARN_RAMP } from './palette';
import { powerOfTwoAtMost, shadeGrid, type ShadeOptions } from './shade';
import {
  BOSS_FAMILIES,
  CHARACTER_CLASSES,
  CHARACTER_FRAMES,
  CREATURE_FAMILIES,
  NPC_ART,
  WEAPON_ARCHETYPES,
  artKeys,
  bossArt,
  characterArt,
  creatureArt,
  weaponArt,
  type SpriteArt,
} from './sprites';

/** How much to scale each texture by so it shows at its intended size in the world. */
const DISPLAY_SCALE = new Map<string, number>();

/** Scale to give a sprite using `key`: detailed textures hold more texels than world pixels. */
export function displayScale(key: string): number {
  return DISPLAY_SCALE.get(key) ?? 1;
}

/** Records that texture `key` holds `texelsPerPixel` texels per world pixel. */
export function registerDetail(key: string, texelsPerPixel: number): void {
  DISPLAY_SCALE.set(key, 1 / texelsPerPixel);
}

type Look = Omit<ShadeOptions, 'detail' | 'palette' | 'outline'>;

/**
 * Draws a sprite's frames side by side into one canvas texture, with frames
 * named 0, 1, 2, ... Each grid cell becomes a block of shaded texels (see
 * shade.ts), at the screen's full resolution.
 */
export function drawSprite(scene: Phaser.Scene, key: string, art: SpriteArt, look: Look = {}): void {
  const detail = powerOfTwoAtMost(art.scale * RENDER_SCALE);
  registerDetail(key, detail / art.scale);
  if (scene.textures.exists(key)) return; // Boot runs again after a save reset
  const frames = art.frames.map((frame) => shadeGrid(frame, { ...look, detail, palette: art.palette, outline: OUTLINE }));
  const frameWidth = frames[0]!.width;
  const frameHeight = frames[0]!.height;
  const texture = scene.textures.createCanvas(key, frameWidth * frames.length, frameHeight);
  if (!texture) throw new Error(`Could not create texture "${key}"`);
  const context = texture.getContext();
  frames.forEach((frame, index) => {
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), index * frameWidth, 0);
    texture.add(index, 0, index * frameWidth, 0, frameWidth, frameHeight);
  });
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

const METAL = 'defyz';
const CHARACTER_LOOK: Look = { metal: METAL, rim: '#bfe8ff' };

/** A looping animation over a texture's frames. Named after the texture unless `name` is given. */
function loop(scene: Phaser.Scene, key: string, frames: readonly number[], frameRate: number, name = key): void {
  if (scene.anims.exists(name)) return;
  scene.anims.create({ key: name, frames: frames.map((frame) => ({ key, frame })), frameRate, repeat: -1 });
}

/** Draws every character, weapon, creature, boss, and NPC, and sets up their animations. */
export function drawAllArt(scene: Phaser.Scene): void {
  for (const classId of CHARACTER_CLASSES) {
    const key = artKeys.character(classId);
    drawSprite(scene, key, characterArt(classId), CHARACTER_LOOK);
    loop(scene, key, CHARACTER_FRAMES.idle, 3, `${key}-idle`);
    loop(scene, key, CHARACTER_FRAMES.run, 10, `${key}-run`);
    loop(scene, key, CHARACTER_FRAMES.jump, 1, `${key}-jump`);
  }

  for (const [npcId, art] of Object.entries(NPC_ART)) {
    const key = artKeys.npc(npcId);
    drawSprite(scene, key, art, CHARACTER_LOOK);
    loop(scene, key, [0, 1], 2);
  }

  for (const archetype of WEAPON_ARCHETYPES) {
    for (const element of WEAPON_ELEMENTS) {
      // Kinetic weapons are plain brass; elemental ones glow in their element's colour.
      const look: Look = element === 'kinetic' ? { metal: METAL + 'abc' } : { metal: METAL, emissive: 'a', glow: ELEMENT_RAMPS[element][1] };
      drawSprite(scene, artKeys.weapon(archetype, element), weaponArt(archetype, element), look);
    }
  }

  // Creatures and bosses: an idle loop, and a pale version shown before each attack.
  const elementOf = (familyId: string) => creatureFamilies.find((f) => f.id === familyId)?.elements[0] ?? 'kinetic';
  const creature = (familyId: string, key: string, make: (warn: boolean) => SpriteArt | null, frameRate: number): void => {
    for (const warn of [false, true]) {
      const art = make(warn);
      if (!art) continue;
      const name = warn ? artKeys.warn(key) : key;
      const ramp = ELEMENT_RAMPS[elementOf(familyId)];
      // Before an attack the whole element-coloured body flares pale gold.
      const look: Look = warn
        ? { emissive: 'abc', glow: WARN_RAMP[1], rim: WARN_RAMP[0] }
        : { emissive: 'a', glow: ramp[1], rim: ramp[0], metal: 'w' };
      drawSprite(scene, name, art, look);
      loop(scene, name, [0, 1], warn ? frameRate * 3 : frameRate);
    }
  };
  for (const familyId of CREATURE_FAMILIES) {
    creature(familyId, artKeys.creature(familyId), (warn) => creatureArt(familyId, elementOf(familyId), warn), 4);
  }
  for (const familyId of BOSS_FAMILIES) {
    creature(familyId, artKeys.boss(familyId), (warn) => bossArt(familyId, elementOf(familyId), warn), 2);
  }
}
