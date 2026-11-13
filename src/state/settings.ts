/**
 * Player settings (volume and mute), kept apart from the save so they survive
 * a save reset and never touch the versioned save schema.
 */
export interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = { music: 0.7, sfx: 0.8, muted: false };
const KEY = 'tamerunner-settings';

const level = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

/** Reads stored settings, falling back to defaults for anything missing or malformed. */
export function parseSettings(raw: string | null): Settings {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    // Unreadable settings are replaced by the defaults.
  }
  return {
    music: level(data.music, DEFAULT_SETTINGS.music),
    sfx: level(data.sfx, DEFAULT_SETTINGS.sfx),
    muted: typeof data.muted === 'boolean' ? data.muted : DEFAULT_SETTINGS.muted,
  };
}

let current: Settings | null = null;

export function getSettings(): Settings {
  if (!current) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      // Storage can be unavailable (private mode); defaults apply.
    }
    current = parseSettings(raw);
  }
  return current;
}

export function setSettings(next: Settings): void {
  current = parseSettings(JSON.stringify(next));
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted, but still applied for this session.
  }
}
