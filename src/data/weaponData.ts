import raw from './weapons.json';

export const ARCHETYPE_IDS = [
  'pulse-rifle',
  'spread-gun',
  'beam',
  'launcher',
  'sidearm',
  'melee-burst',
  'charge-cannon',
] as const;
export const TRIGGER_MODES = ['auto', 'semi', 'burst', 'charge'] as const;
export const WEAPON_ELEMENTS = ['kinetic', 'Ember', 'Tide', 'Volt', 'Verdant', 'Umbra', 'Gale'] as const;
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export type TriggerMode = (typeof TRIGGER_MODES)[number];
export type WeaponElement = (typeof WEAPON_ELEMENTS)[number];
export type Rarity = (typeof RARITIES)[number];

/**
 * Everything that defines how a weapon behaves. An archetype sets every value;
 * a weapon may override any of them under its "stats" key.
 */
export interface WeaponStats {
  /** auto: hold to fire. semi: one shot per click. burst: hold for repeated bursts. charge: hold, then release. */
  trigger: TriggerMode;
  /** Minimum time between trigger pulls (fire rate). */
  fireIntervalMs: number;
  burstCount: number;
  burstIntervalMs: number;
  /** Hold time a charge weapon needs before it will fire. */
  chargeMs: number;
  /** Damage per projectile. */
  damage: number;
  /** Projectiles per shot. */
  pellets: number;
  /** Angle between neighbouring pellets. */
  spreadDeg: number;
  projectileSpeed: number;
  /** Distance a projectile travels before it disappears, in pixels. */
  range: number;
  /** 0-100. Higher means less random scatter. */
  stability: number;
  reloadMs: number;
  magazine: number;
  /** 0-100. Higher means the weapon is ready sooner after a swap. */
  handling: number;
  /** How many extra enemies a projectile passes through. */
  pierce: number;
  /** 0 flies straight; 1 falls at full world gravity. */
  gravity: number;
  /** Greater than 0 makes the projectile explode on impact. */
  blastRadius: number;
  /** Texture key for the projectile. */
  projectile: string;
}

export interface ArchetypeDef extends WeaponStats {
  label: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  archetype: string;
  element: WeaponElement;
  rarity: Rarity;
  stats?: Partial<WeaponStats>;
}

export interface WeaponData {
  archetypes: Record<string, ArchetypeDef>;
  weapons: WeaponDef[];
  starterLoadout: string[];
}

/** A weapon with its archetype's values and its own overrides merged. */
export interface ResolvedWeapon extends WeaponStats {
  id: string;
  name: string;
  archetype: string;
  archetypeLabel: string;
  element: WeaponElement;
  rarity: Rarity;
}

const NUMERIC_STATS = [
  'fireIntervalMs', 'burstCount', 'burstIntervalMs', 'chargeMs', 'damage', 'pellets', 'spreadDeg',
  'projectileSpeed', 'range', 'stability', 'reloadMs', 'magazine', 'handling', 'pierce', 'gravity', 'blastRadius',
] as const;

function checkStats(stats: WeaponStats, where: string): void {
  const fail = (message: string): never => {
    throw new Error(`weapons.json: ${where}: ${message}`);
  };
  if (!TRIGGER_MODES.includes(stats.trigger)) fail(`unknown trigger "${String(stats.trigger)}"`);
  for (const key of NUMERIC_STATS) {
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`"${key}" must be a number >= 0`);
  }
  if (typeof stats.projectile !== 'string' || stats.projectile === '') fail('"projectile" must be a texture key');
  for (const key of ['fireIntervalMs', 'damage', 'projectileSpeed', 'range', 'reloadMs'] as const) {
    if (stats[key] <= 0) fail(`"${key}" must be greater than 0`);
  }
  for (const key of ['pellets', 'magazine', 'burstCount'] as const) {
    if (!Number.isInteger(stats[key]) || stats[key] < 1) fail(`"${key}" must be a whole number >= 1`);
  }
  for (const key of ['stability', 'handling'] as const) {
    if (stats[key] > 100) fail(`"${key}" must be between 0 and 100`);
  }
  if (stats.trigger === 'burst' && stats.burstCount < 2) fail('a burst weapon needs burstCount >= 2');
  if (stats.trigger === 'charge' && stats.chargeMs <= 0) fail('a charge weapon needs chargeMs > 0');
}

export function resolveWeapon(def: WeaponDef, archetypes: Record<string, ArchetypeDef>): ResolvedWeapon {
  const archetype = archetypes[def.archetype];
  if (!archetype) throw new Error(`weapons.json: weapon "${def.id}": unknown archetype "${def.archetype}"`);
  const { label, ...base } = archetype;
  const resolved: ResolvedWeapon = {
    ...base,
    ...(def.stats ?? {}),
    id: def.id,
    name: def.name,
    archetype: def.archetype,
    archetypeLabel: label,
    element: def.element,
    rarity: def.rarity,
  };
  checkStats(resolved, `weapon "${def.id}"`);
  return resolved;
}

/** Checks the whole file at load so bad data fails loudly instead of misbehaving in play. */
export function validateWeaponData(input: unknown): WeaponData {
  const data = input as WeaponData;
  if (!data || typeof data !== 'object' || !data.archetypes || !Array.isArray(data.weapons)) {
    throw new Error('weapons.json: expected "archetypes" and "weapons"');
  }
  for (const id of ARCHETYPE_IDS) {
    if (!data.archetypes[id]) throw new Error(`weapons.json: missing archetype "${id}"`);
  }
  for (const [id, archetype] of Object.entries(data.archetypes)) {
    if (typeof archetype.label !== 'string' || archetype.label === '') {
      throw new Error(`weapons.json: archetype "${id}": needs a label`);
    }
    checkStats(archetype, `archetype "${id}"`);
  }

  const ids = new Set<string>();
  for (const weapon of data.weapons) {
    if (!weapon.id || !weapon.name) throw new Error('weapons.json: every weapon needs an id and a name');
    if (ids.has(weapon.id)) throw new Error(`weapons.json: duplicate weapon id "${weapon.id}"`);
    ids.add(weapon.id);
    if (!WEAPON_ELEMENTS.includes(weapon.element)) {
      throw new Error(`weapons.json: weapon "${weapon.id}": unknown element "${String(weapon.element)}"`);
    }
    if (!RARITIES.includes(weapon.rarity)) {
      throw new Error(`weapons.json: weapon "${weapon.id}": unknown rarity "${String(weapon.rarity)}"`);
    }
    resolveWeapon(weapon, data.archetypes);
  }

  if (!Array.isArray(data.starterLoadout) || data.starterLoadout.length === 0) {
    throw new Error('weapons.json: "starterLoadout" must list at least one weapon id');
  }
  for (const id of data.starterLoadout) {
    if (!ids.has(id)) throw new Error(`weapons.json: starterLoadout: unknown weapon "${id}"`);
  }
  return data;
}

export const weaponData = validateWeaponData(raw);

export function getWeapon(id: string): ResolvedWeapon {
  const def = weaponData.weapons.find((w) => w.id === id);
  if (!def) throw new Error(`Unknown weapon "${id}" (see src/data/weapons.json)`);
  return resolveWeapon(def, weaponData.archetypes);
}

export function starterLoadout(): ResolvedWeapon[] {
  return weaponData.starterLoadout.map(getWeapon);
}
