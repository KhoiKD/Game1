import { describe, expect, it } from 'vitest';
import { SOUNDS, hitRecipe, lootRecipe, recipeLength, shotRecipe, type Recipe } from '../src/audio/synth';
import { STEPS, TRACKS, midiToFreq, parsePattern } from '../src/audio/tracks';
import { ARCHETYPE_IDS, RARITIES, WEAPON_ELEMENTS } from '../src/data/weaponData';
import { progression } from '../src/data/progressionData';
import { DEFAULT_SETTINGS, parseSettings, prefersLowRes } from '../src/state/settings';

/** Short, audible, and never so loud that layered sounds clip. */
function expectSafe(recipe: Recipe, label: string): void {
  expect(recipe.length, label).toBeGreaterThan(0);
  for (const v of recipe) {
    expect(v.gain, label).toBeGreaterThan(0);
    expect(v.gain, label).toBeLessThanOrEqual(0.6);
    expect(v.attack, label).toBeGreaterThan(0);
    expect(v.decay, label).toBeGreaterThan(0);
    if (v.wave !== 'noise') {
      expect(v.freq, label).toBeGreaterThanOrEqual(20);
      expect(v.freq, label).toBeLessThanOrEqual(12000);
    }
    if (v.filter) expect(v.filter.freq, label).toBeGreaterThan(20);
  }
  expect(recipeLength(recipe), label).toBeLessThanOrEqual(2);
  // Peak gain of voices that can overlap stays bounded.
  expect(recipe.reduce((sum, v) => sum + v.gain, 0), label).toBeLessThanOrEqual(1.6);
}

describe('sound recipes', () => {
  it('has a safe firing sound for every archetype in every element', () => {
    for (const archetype of ARCHETYPE_IDS) for (const element of WEAPON_ELEMENTS) expectSafe(shotRecipe(archetype, element), `${archetype} ${element}`);
  });

  it('has safe hit sounds, with a different sound per element and for crits', () => {
    for (const element of WEAPON_ELEMENTS) {
      for (const effect of ['strong', 'resisted', 'neutral'] as const) {
        expectSafe(hitRecipe(element, false, effect), `${element} ${effect}`);
        expectSafe(hitRecipe(element, true, effect), `${element} ${effect} crit`);
      }
    }
    expect(hitRecipe('Ember', false, 'neutral')).not.toEqual(hitRecipe('Tide', false, 'neutral'));
    expect(hitRecipe('Ember', true, 'neutral').length).toBeGreaterThan(hitRecipe('Ember', false, 'neutral').length);
  });

  it('plays a longer jingle for rarer loot', () => {
    const lengths = RARITIES.map((r) => lootRecipe(r).length);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]!);
  });

  it('keeps every fixed sound safe', () => {
    for (const [name, recipe] of Object.entries(SOUNDS)) expectSafe(recipe, name);
  });
});

describe('music', () => {
  it('has a track for every stage, the boss fight, and the hub', () => {
    for (const stage of progression.stages) expect(TRACKS[stage.id], stage.id).toBeDefined();
    expect(TRACKS.boss).toBeDefined();
    expect(TRACKS.hub).toBeDefined();
  });

  for (const [id, track] of Object.entries(TRACKS)) {
    it(`${id}: every pattern is ${STEPS} steps and every note is in range`, () => {
      for (const part of ['lead', 'bass', 'kick', 'snare', 'hat'] as const) expect(track[part], part).toHaveLength(STEPS);
      expect(track.lead).toMatch(/^[0-9a-e.-]+$/);
      expect(track.bass).toMatch(/^[0-9a-e.-]+$/);
      for (const drum of [track.kick, track.snare, track.hat]) expect(drum).toMatch(/^[x.]+$/);
      const notes = [...parsePattern(track.lead, track.root, track.scale), ...parsePattern(track.bass, track.root - 24, track.scale)];
      expect(notes.length).toBeGreaterThan(4);
      for (const n of notes) {
        expect(midiToFreq(n.midi)).toBeGreaterThan(30);
        expect(midiToFreq(n.midi)).toBeLessThan(2500);
      }
      expect(track.bpm).toBeGreaterThanOrEqual(60);
      expect(track.bpm).toBeLessThanOrEqual(180);
    });
  }

  it('parses degrees, holds, and rests', () => {
    expect(parsePattern('0-.2', 60, [0, 2, 4])).toEqual([
      { step: 0, length: 2, midi: 60 },
      { step: 3, length: 1, midi: 64 },
    ]);
    // Degrees past the scale climb an octave.
    expect(parsePattern('3', 60, [0, 2, 4])[0]!.midi).toBe(72);
    expect(midiToFreq(69)).toBeCloseTo(440);
  });
});

describe('settings', () => {
  it('falls back to defaults for missing or broken data and clamps volumes', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"music":2,"sfx":-1,"muted":true,"quality":"ultra"}')).toEqual({ ...DEFAULT_SETTINGS, music: 1, sfx: 0, muted: true });
    expect(prefersLowRes(parseSettings('{"quality":"low"}'))).toBe(true);
    expect(prefersLowRes(parseSettings('{"autoLowRes":true}'))).toBe(true);
    expect(prefersLowRes(parseSettings('{"quality":"high","autoLowRes":true}'))).toBe(false);
    expect(parseSettings('{"music":"loud"}').music).toBe(DEFAULT_SETTINGS.music);
  });
});
