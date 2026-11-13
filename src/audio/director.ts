import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { getSettings, setSettings } from '../state/settings';
import { gameEvents, type At } from '../util/events';
import { AudioEngine } from './engine';
import { SOUNDS, hitRecipe, lootRecipe, shotRecipe, type Recipe, type SoundName } from './synth';

/**
 * Connects game events to sound. Created once at boot on Phaser's own audio
 * context (which Phaser resumes on the first click or key press, as browsers
 * require). Without Web Audio the game simply stays silent.
 */
let engine: AudioEngine | null = null;
let game: Phaser.Game | null = null;

export function installAudio(target: Phaser.Game): void {
  if (engine) return;
  game = target;
  const manager = target.sound as Partial<Phaser.Sound.WebAudioSoundManager>;
  if (!manager.context) return;
  engine = new AudioEngine(manager.context, getSettings());
  // Debug and headless checks.
  (window as unknown as { __tamerunnerAudio?: AudioEngine }).__tamerunnerAudio = engine;

  const sfx = (key: string, recipe: Recipe, at?: At): void => engine?.play(key, recipe, at ? panFor(at.x) : 0);
  const fixed = (name: SoundName, at?: At): void => sfx(name, SOUNDS[name], at);

  gameEvents.on('shot', (e) => sfx(`shot-${e.archetype}`, shotRecipe(e.archetype, e.element), e));
  gameEvents.on('enemyHit', (e) => sfx(e.crit ? 'crit' : 'hit', hitRecipe(e.element, e.crit, e.effect), e));
  gameEvents.on('weakened', (e) => fixed('weakened', e));
  gameEvents.on('captured', (e) => fixed('captured', e));
  gameEvents.on('defeated', (e) => fixed(e.boss ? 'bossDefeated' : 'defeated', e));
  gameEvents.on('explosion', (e) => fixed('explosion', e));
  gameEvents.on('playerHurt', (e) => fixed('hurt', e));
  gameEvents.on('playerDied', (e) => fixed('died', e));
  gameEvents.on('checkpoint', (e) => fixed('checkpoint', e));
  gameEvents.on('pickup', (e) => fixed('pickup', e));
  gameEvents.on('lootPickup', (e) => sfx('loot', lootRecipe(e.rarity), e));
  gameEvents.on('telegraph', (e) => fixed(e.boss ? 'bossTelegraph' : 'telegraph', e));
  gameEvents.on('bossPhase', (e) => fixed('bossPhase', e));
  gameEvents.on('stageClear', (e) => fixed('stageClear', e));
  gameEvents.on('ability', (e) => fixed('ability', e));
  gameEvents.on('reload', (e) => fixed('reload', e));
  gameEvents.on('swap', (e) => fixed('swap', e));
  gameEvents.on('music', (e) => engine?.playMusic(e.track));

  // M mutes everywhere.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) toggleMute();
  });
}

/** Stereo position for a world x: the camera of the running stage, if any. */
function panFor(x: number): number {
  const level = game?.scene.getScene('Level');
  if (!level || !game?.scene.isActive('Level')) return 0;
  const camera = level.cameras.main;
  return ((x - camera.scrollX) / GAME_WIDTH - 0.5) * 1.2;
}

export function playUiSound(name: SoundName = 'click'): void {
  engine?.play(name, SOUNDS[name]);
}

export function toggleMute(): void {
  const settings = getSettings();
  applySettings({ ...settings, muted: !settings.muted });
}

export function applySettings(next: ReturnType<typeof getSettings>): void {
  setSettings(next);
  engine?.setVolumes(getSettings());
}
