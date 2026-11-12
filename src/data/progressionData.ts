import { CLASS_EFFECTS, type ClassDef, type ProgressionRules, type StageDef } from '../systems/progression';
import rawClasses from './classes.json';
import rawProgression from './progression.json';
import { RARITIES, weaponData } from './weaponData';

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Checks progression.json at load. */
export function validateProgression(input: unknown): ProgressionRules {
  const p = input as ProgressionRules;
  if (!p?.xp || !p.perLevel || !p.weaponPower || !Array.isArray(p.tiers) || !Array.isArray(p.stages)) {
    throw new Error('progression.json: a required section is missing');
  }
  if (!positive(p.xp.base) || !Number.isInteger(p.xp.maxLevel) || p.xp.maxLevel < 2) throw new Error('progression.json: bad xp settings');
  if (p.perLevel.damage < 0 || p.perLevel.hpEvery < 0) throw new Error('progression.json: bad perLevel settings');
  let previousPower = 0;
  for (const rarity of RARITIES) {
    if (!positive(p.weaponPower[rarity]) || p.weaponPower[rarity] < previousPower) {
      throw new Error('progression.json: weaponPower must rise with rarity');
    }
    previousPower = p.weaponPower[rarity];
  }
  if (p.tiers.length === 0) throw new Error('progression.json: needs at least one tier');
  p.tiers.forEach((tier, index) => {
    if (tier.tier !== index + 1) throw new Error('progression.json: tiers must be numbered 1, 2, 3, ... in order');
    if (!tier.name || tier.requiredPower < 0 || tier.stageBonus < 0 || !positive(tier.bossHpMult) || !positive(tier.xpMult)) {
      throw new Error(`progression.json: tier ${tier.tier}: bad values`);
    }
    const below = p.tiers[index - 1];
    if (below && (tier.requiredPower < below.requiredPower || tier.bossHpMult < below.bossHpMult || tier.stageBonus < below.stageBonus)) {
      throw new Error(`progression.json: tier ${tier.tier} must not be easier than the tier below it`);
    }
  });
  if (p.tiers[0]!.requiredPower !== 0) throw new Error('progression.json: tier 1 must need no Power');
  const ids = new Set<string>();
  for (const stage of p.stages) {
    if (!stage.id || !stage.name || !stage.map || ids.has(stage.id)) throw new Error('progression.json: every stage needs a unique id, a name, and a map');
    if (stage.requires !== null && !ids.has(stage.requires)) throw new Error(`progression.json: stage "${stage.id}" requires a stage that is not listed before it`);
    if (typeof stage.powerOffset !== 'number' || stage.powerOffset < 0) throw new Error(`progression.json: stage "${stage.id}": bad powerOffset`);
    ids.add(stage.id);
  }
  if (p.stages.length === 0) throw new Error('progression.json: needs at least one stage');
  return p;
}

/** Checks classes.json at load. */
export function validateClasses(input: unknown): Record<string, ClassDef> {
  const classes = (input as { classes?: Record<string, ClassDef> } | null)?.classes;
  if (!classes || Object.keys(classes).length === 0) throw new Error('classes.json: expected "classes"');
  for (const [id, def] of Object.entries(classes)) {
    const where = `classes.json: class "${id}"`;
    if (!def.name || !def.summary || !def.passiveText) throw new Error(`${where}: needs name, summary, and passiveText`);
    const passive = def.passive;
    if (!passive || passive.maxHp < 0 || !positive(passive.moveSpeedMult) || !positive(passive.reloadMult) || !positive(passive.statusBuildupMult) || !positive(passive.spiritCooldownMult)) {
      throw new Error(`${where}: bad passive`);
    }
    if (!Array.isArray(def.affinity?.archetypes) || def.affinity.archetypes.length === 0 || def.affinity.damage < 0) {
      throw new Error(`${where}: needs a weapon affinity`);
    }
    for (const archetype of def.affinity.archetypes) {
      if (!weaponData.archetypes[archetype]) throw new Error(`${where}: unknown archetype "${archetype}"`);
    }
    const ability = def.ability;
    if (!ability?.name || !ability.description || !CLASS_EFFECTS.includes(ability.effect) || !positive(ability.cooldownMs)) {
      throw new Error(`${where}: bad ability`);
    }
    if (ability.effect === 'guard' && !positive(ability.durationMs)) throw new Error(`${where}: guard needs durationMs`);
    if (ability.effect === 'dash' && (!positive(ability.durationMs) || !positive(ability.speed))) throw new Error(`${where}: dash needs durationMs and speed`);
    if (ability.effect === 'stasis' && !positive(ability.radius)) throw new Error(`${where}: stasis needs radius`);
  }
  return classes;
}

export const progression = validateProgression(rawProgression);
export const classDefs = validateClasses(rawClasses);
export const classIds = Object.keys(classDefs);

export function findClass(id: string | null): ClassDef | null {
  return id !== null ? (classDefs[id] ?? null) : null;
}

export function getStage(id: string): StageDef {
  const stage = progression.stages.find((s) => s.id === id);
  if (!stage) throw new Error(`Unknown stage "${id}" (see src/data/progression.json)`);
  return stage;
}
