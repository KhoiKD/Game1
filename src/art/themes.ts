/**
 * The look of each stage: ground materials for the tileset and colours for the
 * parallax backdrop. Keyed by stage id; a stage without an entry uses the first.
 */
export interface StageTheme {
  /** Surface material on exposed tops: light, mid, dark. */
  top: readonly [string, string, string];
  /** Material inside the ground. */
  body: readonly [string, string, string];
  /** Small details: pebbles, shells, crystals. */
  accent: string;
  /** Whether accents glow (crystals, fungus). */
  glowingAccent: boolean;
  /** Sky gradient, top to horizon. */
  sky: readonly [string, string, string];
  /** Sun or moon colour and its height (0 top, 1 horizon). */
  orb: { colour: string; y: number; radius: number };
  /** Far, middle, and near backdrop layers, darkest last. */
  layers: readonly [string, string, string];
  /** Haze laid over the far layers. */
  haze: string;
  /** What stands in the middle layer. */
  scenery: 'thorn-forest' | 'sea-stacks' | 'fungus-cavern';
  /** Stars in the sky. */
  stars: boolean;
}

export const STAGE_THEMES: Record<string, StageTheme> = {
  // Thornway: overgrown causeway in late afternoon.
  level1: {
    top: ['#9be36b', '#4fae4a', '#2b6b3a'],
    body: ['#a77a4f', '#7a5236', '#4a2f22'],
    accent: '#d9c9a3',
    glowingAccent: false,
    sky: ['#3d6fa8', '#8fc0d8', '#f2d9a6'],
    orb: { colour: '#fff1c2', y: 0.62, radius: 46 },
    layers: ['#6f9aa6', '#3f6b5c', '#24443a'],
    haze: '#e9e0c0',
    scenery: 'thorn-forest',
    stars: false,
  },
  // Brinemere: storm-lashed shore under grey-blue cloud.
  level2: {
    top: ['#f1e2b8', '#cdb684', '#8f7a52'],
    body: ['#7f8ea3', '#56637a', '#323b4f'],
    accent: '#8ff0e0',
    glowingAccent: false,
    sky: ['#26304f', '#5b7393', '#a9c1cf'],
    orb: { colour: '#e6f2ff', y: 0.3, radius: 30 },
    layers: ['#6d84a0', '#3e5272', '#22304a'],
    haze: '#c7dbe6',
    scenery: 'sea-stacks',
    stars: false,
  },
  // Duskhollow: sunless cavern lit by fungus and crystal.
  level3: {
    top: ['#b48ae6', '#7a52b3', '#4a2f78'],
    body: ['#4b3b63', '#33284a', '#1d1630'],
    accent: '#7ff0ff',
    glowingAccent: true,
    sky: ['#0d0a1a', '#21183a', '#3d2a5c'],
    orb: { colour: '#c9a6ff', y: 0.25, radius: 22 },
    layers: ['#3b2d5e', '#281f45', '#160f2b'],
    haze: '#6a4fa0',
    scenery: 'fungus-cavern',
    stars: true,
  },
};

export function themeFor(stageId: string): StageTheme {
  return STAGE_THEMES[stageId] ?? STAGE_THEMES.level1!;
}
