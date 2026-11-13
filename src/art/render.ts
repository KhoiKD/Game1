import Phaser from 'phaser';
import { creatureFamilies } from '../data/creatureData';
import { WEAPON_ELEMENTS } from '../data/weaponData';
import { OUTLINE } from './palette';
import { rasterize } from './pixel';
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

/**
 * Draws a sprite's frames side by side into one canvas texture, with frames
 * named 0, 1, 2, ... and nearest-neighbour filtering so scaled pixels stay crisp.
 */
export function drawSprite(scene: Phaser.Scene, key: string, art: SpriteArt): void {
  if (scene.textures.exists(key)) return; // Boot runs again after a save reset
  const frames = art.frames.map((frame) => rasterize(frame, art.palette, OUTLINE));
  const frameWidth = frames[0]!.width * art.scale;
  const frameHeight = frames[0]!.height * art.scale;
  const texture = scene.textures.createCanvas(key, frameWidth * frames.length, frameHeight);
  if (!texture) throw new Error(`Could not create texture "${key}"`);
  const context = texture.getContext();
  frames.forEach((frame, index) => {
    for (const [x, y, colour] of frame.pixels) {
      context.fillStyle = colour;
      context.fillRect(index * frameWidth + x * art.scale, y * art.scale, art.scale, art.scale);
    }
    texture.add(index, 0, index * frameWidth, 0, frameWidth, frameHeight);
  });
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** A looping animation over a texture's frames. Named after the texture unless `name` is given. */
function loop(scene: Phaser.Scene, key: string, frames: readonly number[], frameRate: number, name = key): void {
  if (scene.anims.exists(name)) return;
  scene.anims.create({ key: name, frames: frames.map((frame) => ({ key, frame })), frameRate, repeat: -1 });
}

/** Draws every character, weapon, creature, boss, and NPC, and sets up their animations. */
export function drawAllArt(scene: Phaser.Scene): void {
  for (const classId of CHARACTER_CLASSES) {
    const key = artKeys.character(classId);
    drawSprite(scene, key, characterArt(classId));
    loop(scene, key, CHARACTER_FRAMES.idle, 3, `${key}-idle`);
    loop(scene, key, CHARACTER_FRAMES.run, 10, `${key}-run`);
    loop(scene, key, CHARACTER_FRAMES.jump, 1, `${key}-jump`);
  }

  for (const [npcId, art] of Object.entries(NPC_ART)) {
    const key = artKeys.npc(npcId);
    drawSprite(scene, key, art);
    loop(scene, key, [0, 1], 2);
  }

  for (const archetype of WEAPON_ARCHETYPES) {
    for (const element of WEAPON_ELEMENTS) drawSprite(scene, artKeys.weapon(archetype, element), weaponArt(archetype, element));
  }

  // Creatures and bosses: an idle loop, and a pale version shown before each attack.
  const elementOf = (familyId: string) => creatureFamilies.find((f) => f.id === familyId)?.elements[0] ?? 'kinetic';
  const creature = (key: string, make: (warn: boolean) => SpriteArt | null, frameRate: number): void => {
    for (const warn of [false, true]) {
      const art = make(warn);
      if (!art) continue;
      const name = warn ? artKeys.warn(key) : key;
      drawSprite(scene, name, art);
      loop(scene, name, [0, 1], warn ? frameRate * 3 : frameRate);
    }
  };
  for (const familyId of CREATURE_FAMILIES) {
    creature(artKeys.creature(familyId), (warn) => creatureArt(familyId, elementOf(familyId), warn), 4);
  }
  for (const familyId of BOSS_FAMILIES) {
    creature(artKeys.boss(familyId), (warn) => bossArt(familyId, elementOf(familyId), warn), 2);
  }
}
