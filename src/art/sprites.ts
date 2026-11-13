import type { WeaponElement } from '../data/weaponData';
import { BASE_PALETTE, ELEMENT_RAMPS, WARN_RAMP, rampPalette, type Ramp } from './palette';
import { layer, mirror, replaceRows, swapChars, type Grid } from './pixel';

/**
 * All the pixel art, as text grids (see pixel.ts). Sprites face right; the
 * game flips them to face left. An outline is added when they are drawn, so
 * the grids hold only the fill. "a", "b", and "c" are the light, mid, and dark
 * shades of the creature's or weapon's element.
 *
 * Every design here is original. The style (chunky outlined sprites,
 * three-tone shading, big-headed characters) follows 16-bit console RPGs.
 */
export type Palette = Readonly<Record<string, string>>;

export interface SpriteArt {
  /** Pixels per grid cell when drawn. */
  scale: number;
  palette: Palette;
  /** Animation frames, all the same size. */
  frames: Grid[];
}

const palette = (extra: Record<string, string> = {}, ramp?: Ramp): Palette => ({
  ...BASE_PALETTE,
  ...(ramp ? rampPalette(ramp) : {}),
  ...extra,
});

// ---- player characters ----------------------------------------------------

/** Characters are 14 x 30 cells at scale 2: 32 x 64 pixels with the outline. */
export const CHARACTER_SCALE = 2;
const CHARACTER_HEIGHT = 30;

/** Upper bodies (21 rows), drawn over a leg pose. */
const TORSOS: Record<string, Grid> = {
  // Armoured knight: steel helm with a red crest, red mantle, gold emblem.
  vanguard: [
    '......rr......',
    '.....rrsr.....',
    '....dddddd....',
    '...ddddddddde.',
    '..deeeeeeeeed.',
    '..dfppppppppd.',
    '..dfppkpppkpd.',
    '..dfppkpppkpd.',
    '..dfpppppppqd.',
    '..ddfppqqqppd.',
    '...ddddddddd..',
    '...srrrrrrrs..',
    '..sddddddddds.',
    '..sdeeyyeedds.',
    '..sdeeyyeedds.',
    '..sdeeeeeedds.',
    '..s.deeeeed.s.',
    '..s.ddddddd.s.',
    '....yzzzzy....',
    '....deeeed....',
    '....deeeed....',
  ],
  // Scout: green hood, trailing orange scarf, belted tunic.
  skirmisher: [
    '.....iiii.....',
    '....hiiiii....',
    '...hhiiiiil...',
    '..hhiiiiiiil..',
    '..hiilppppil..',
    '..hilppppppl..',
    '..hilppkppkp..',
    '..hilppkppkp..',
    '..hillppppqp..',
    '..hiiluuuuuu..',
    '.tuuuuuuuut...',
    'tt.iiiiiiil...',
    't..hiiiiiil...',
    '...hiiiiiil...',
    '...hiiwiiil...',
    '...hiiiiiil...',
    '...lllllll....',
    '...xvvvvvx....',
    '....iiiiii....',
    '....iiiiil....',
    '....il..il....',
  ],
  // Mystic: teal hooded robe with white trim and a gold circlet.
  warden: [
    '....iiiiii....',
    '...hiiiiiil...',
    '..hiiiiiiiil..',
    '..hyyyyyyyyz..',
    '..hilppppppl..',
    '..hilppkppkp..',
    '..hilppkppkp..',
    '..hilppppppq..',
    '..hiilppqqpl..',
    '..hiiiwwwwil..',
    '.hiiiiwiiiiil.',
    '.hiiiiwiiiiil.',
    'hiiiiiwiiiiiil',
    'hiiiiiwiiiiiil',
    'hhiiiiwiiiiill',
    '.hiiyyyyyyiil.',
    '.hiiiiwiiiiil.',
    '.hiiiiwiiiiil.',
    '..hiiiwiiiil..',
    '..hiiiwiiiil..',
    '..hhiiwiiiil..',
  ],
};

/** Leg poses (9 rows): g and j are trousers, m and n are boots. */
const LEGS: Record<'stand' | 'stride' | 'pass' | 'jump', Grid> = {
  stand: [
    '....gggggg....',
    '....gggggg....',
    '....ggj.gg....',
    '....gg..gg....',
    '....gj..gj....',
    '....gj..gj....',
    '....mm..mm....',
    '....mmm.mmm...',
    '....nnn.nnn...',
  ],
  stride: [
    '....gggggg....',
    '....gggggg....',
    '...gggj.ggg...',
    '..ggj....ggj..',
    '.ggj......gj..',
    '.gj.......gj..',
    'mm........mmm.',
    'mmn.......mmmn',
    '.nn.......nnn.',
  ],
  pass: [
    '....gggggg....',
    '....gggggg....',
    '....ggjggg....',
    '.....gjgg.....',
    '.....gjgj.....',
    '....mmgj......',
    '....mmnmm.....',
    '.....nmmmm....',
    '......nnnn....',
  ],
  jump: [
    '....gggggg....',
    '....gggggg....',
    '....ggjggg....',
    '...ggj..ggg...',
    '..mmj....gj...',
    '..mmn....gj...',
    '...n.....mmm..',
    '..........nnn.',
    '..............',
  ],
};

const CHARACTER_PALETTES: Record<string, Palette> = {
  vanguard: palette({ g: '#9aa6bd', j: '#5c6680', m: '#dfe6f2', n: '#5c6680' }),
  skirmisher: palette({
    h: '#7ed36b', i: '#3f9a4a', l: '#22603a', u: '#f2a03a', t: '#b8641f',
    g: '#a8703f', j: '#6e4424', m: '#4a3a5a', n: '#2c2238',
  }),
  warden: palette({
    h: '#6fd6c8', i: '#2f8f9a', l: '#1d5560',
    g: '#2f8f9a', j: '#1d5560', m: '#5a3a2a', n: '#3a2418',
  }),
};

/** Animation frames for a class character, by index. */
export const CHARACTER_FRAMES = { idle: [0, 1], run: [2, 3, 4, 5], jump: [6] } as const;

export const CHARACTER_CLASSES = Object.keys(TORSOS);

/** Seven frames: idle (2), run (4), jump (1). The upper body bobs a row on alternate frames. */
export function characterArt(classId: string): SpriteArt {
  const torso = TORSOS[classId];
  const colours = CHARACTER_PALETTES[classId];
  if (!torso || !colours) throw new Error(`No character art for class "${classId}"`);
  const pose = (legs: Grid, bob: number): Grid => layer(legs, torso, bob, CHARACTER_HEIGHT);
  const strideOther = swapChars(LEGS.stride, { g: 'j', j: 'g' });
  return {
    scale: CHARACTER_SCALE,
    palette: colours,
    frames: [
      pose(LEGS.stand, 0),
      pose(LEGS.stand, 1),
      pose(LEGS.stride, 0),
      pose(LEGS.pass, 1),
      pose(strideOther, 0),
      pose(LEGS.pass, 1),
      pose(LEGS.jump, 0),
    ],
  };
}

// ---- the guide -----------------------------------------------------------

/** Veska the Wayfinder: an elder in a blue cloak, with a staff and a lantern. */
const WAYFINDER: Grid = [
  '.....hhhh.....',
  '....hhhhhi..y.',
  '...hhhhhhii.x.',
  '..hhhhhhhii.x.',
  '..hhiippppi.x.',
  '..hiipppkpi.x.',
  '..hiippppqi.x.',
  '..hiiwwwwwi.x.',
  '..hiiwwwwwiix.',
  '..hhiiwwwiipx.',
  '.hhhiiiwiiiix.',
  '.hhiiiiiiiiix.',
  '.hhiiiiiiiiix.',
  '.hhiiiiiiaayx.',
  '.hhiiiiiiayyx.',
  '.hhiiiiiiaayx.',
  '.hhiiiiiiiiix.',
  '.hhiiiiiiiiix.',
  '.hhiiiiiiiiix.',
  'hhhiiiiiiiiix.',
  'hhiiiiiiiiiix.',
  'hhiiiiiiiiiix.',
  'hhiiiiiiiiiix.',
  'hhhiiiiiiiiix.',
  '.hhhiiiiiiiix.',
  '.hhhhiiiiiiix.',
  '..hhhhiiiiiix.',
  '...mm...mm..x.',
  '..mmm..mmm..x.',
  '..nnn..nnn.vvv',
];

export const NPC_ART: Record<string, SpriteArt> = {
  wayfinder: {
    scale: CHARACTER_SCALE,
    palette: palette({ h: '#5b6aa8', i: '#39407a', a: '#fff3b0', m: '#4a3a5a', n: '#2c2238' }),
    // The lantern flickers.
    frames: [WAYFINDER, replaceRows(WAYFINDER, 13, ['.hhiiiiiiyayx.', '.hhiiiiiiyaax.', '.hhiiiiiiyayx.'])],
  },
};

// ---- weapons ----------------------------------------------------------------

/** One look per weapon archetype; the element colours its glowing parts. A fist holds the grip on the left. */
const WEAPON_GRIDS: Record<string, Grid> = {
  'pulse-rifle': [
    '.....dd........',
    'xxx.deeeeeeeeee',
    'xxxbbbbbbbbbddd',
    'ppxeeeeffff....',
    'pp....ff.......',
  ],
  'spread-gun': [
    '...........ddd',
    'xxxeeeeeeeedde',
    'xxxbbbbbbbbbde',
    'ppxeeeeeeeedde',
    'pp..ff.....ddd',
  ],
  beam: [
    '............aa.',
    '.xxdddddddddaba',
    'ppxeeeebbbeeabw',
    'pp.ffff...ddaba',
    '............aa.',
  ],
  launcher: [
    '....dddddddddd.',
    '...deeeeeeeeeed',
    'xx.ebbbbbbbbbbe',
    'ppxeeeeeeeeeeed',
    'pp..dfffddddd..',
    '.....ff........',
  ],
  sidearm: [
    '...dddddd',
    'ppdeeeeee',
    'ppfbbbeef',
    '..ff.....',
    '..ff.....',
  ],
  'melee-burst': [
    '......aaaaaaaaa.',
    '...y.abbbbbbbbbw',
    'ppxyycccccccccc.',
    'pp.y............',
  ],
  'charge-cannon': [
    '....dddddddddd..',
    'xx.dbebebebebedd',
    'xxxeeeeeeeeeeeaw',
    'ppxdbebebebebedd',
    'pp..ffffdddddd..',
    '....ff..........',
  ],
};

export const WEAPON_ARCHETYPES = Object.keys(WEAPON_GRIDS);

export function weaponArt(archetype: string, element: WeaponElement): SpriteArt {
  const grid = WEAPON_GRIDS[archetype];
  if (!grid) throw new Error(`No weapon art for archetype "${archetype}"`);
  return { scale: 2, palette: palette({}, ELEMENT_RAMPS[element]), frames: [grid] };
}

// ---- creatures --------------------------------------------------------------

interface CreatureGrid {
  grid: Grid;
  /** Rows swapped in for the second animation frame. */
  alt: { at: number; rows: Grid };
  /** Grid and alt rows are left halves, mirrored to make a symmetric sprite. */
  mirrored?: boolean;
  /** Colours beyond the element ramp. */
  extra?: Record<string, string>;
}

/** The twelve families that appear as enemies, keyed by family id. Drawn at scale 2. */
const CREATURE_GRIDS: Record<string, CreatureGrid> = {
  // Twiglet: a stick insect, long body, antennae swept forward.
  'verdant-stickinsect': {
    grid: [
      '..............b.',
      '.............b..',
      '...........bb..b',
      '..........abbab.',
      'aabbbbbbbbbbbwk.',
      'cbbbbbbbbbbbbbbb',
      '.ccc.c..c..c.cc.',
      '..c..c..c..c....',
      '.c...c...c..c...',
      '.c..c....c...c..',
      'c...c.....c..c..',
    ],
    alt: {
      at: 6,
      rows: ['.ccc.c..c..c.cc.', '...c.c...c.c....', '..c..c...c..c...', '..c...c..c...c..', '.c....c...c...c.'],
    },
  },
  // Acornet: a walking acorn with a leafy cap.
  'verdant-oak': {
    grid: [
      '.....aa.....',
      '...abbbbba..',
      '..abbcbcbba.',
      '.abcbcbcbcba',
      '.cccccccccc.',
      '..xxxxxxxx..',
      '.xxwkxxwkxx.',
      '.xxwkxxwkxx.',
      '.xxxxxxxxxx.',
      '..xxvvvvxx..',
      '...vvvvvv...',
      '...v....v...',
    ],
    alt: { at: 10, rows: ['...vvvvvv...', '..v......v..'] },
  },
  // Snapsprout: a toothed trap-jaw plant on a short stem.
  'volt-flytrap': {
    grid: [
      '.b..b..b..b.',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      '.cwrrrrrrwc.',
      '..rrrrrrrr..',
      '.cwrrrrrrwc.',
      'abbbbbbbbbba',
      '.abbbbbbbba.',
      '....cccc....',
      '.....cc.....',
      '..xxxxxxxx..',
    ],
    alt: { at: 3, rows: ['.cwwwwwwwwc.', '.cbbbbbbbbc.', '.cwwwwwwwwc.'] },
  },
  // Glowfly: a beetle with a glowing tail.
  'volt-firefly': {
    grid: [
      '....www..www...',
      '...wwwwwwwwww..',
      '.aaycccccccbbk.',
      'ayyycccccccbbbb',
      '.aaycccccccbb..',
      '....c.c..c.c...',
      '...c..c..c..c..',
    ],
    alt: { at: 0, rows: ['...............', '....wwwwwwww...'] },
  },
  // Sparkant: an ember-backed ant with snapping mandibles.
  'ember-fireant': {
    grid: [
      '...........b.b.',
      '..........b.b..',
      '.bbb.....abba..',
      'bbaab.bb.bbwkb.',
      'bccbbcbbcbbbbbw',
      '.cccc.cc.cccc..',
      '..c.c..c..c.c..',
      '.c..c..c..c..c.',
      'c...c...c..c..c',
    ],
    alt: { at: 6, rows: ['...c.c.c.c.c...', '..c..c.c..c.c..', '.c...c..c.c...c'] },
  },
  // Komodle: a young monitor lizard tasting the air.
  'ember-komodo': {
    grid: [
      '..........bbbb..',
      '.........bbbwkb.',
      'bb......bbbbbbbr',
      '.bbbbcbbbcbbbb.r',
      '..bbaaaaaaaabb..',
      '...cccccccccc...',
      '...cc..c..cc....',
      '..cc..cc..cc....',
    ],
    alt: { at: 6, rows: ['....cc.c.cc.....', '...cc..cc.cc....'] },
  },
  // Blowpuff: a spiny round fish.
  'tide-pufferfish': {
    grid: [
      '..c..c..c...',
      '...bbbbbb...',
      'c.bbbbbbbbc.',
      '.bbbbbbbwkb.',
      'cbbbbbbbwkbc',
      '.bbbbbbbbbbr',
      'caaaaaaaaab.',
      '.aaaaaaaaaa.',
      'c.aaaaaaaa.c',
      '..aaaaaaaa..',
      '...c.cc.c...',
    ],
    alt: { at: 0, rows: ['.c..c..c..c.', 'c..bbbbbb..c', '..bbbbbbbb..'] },
  },
  // Whalelet: a small whale with a proud spout.
  'tide-bluewhale': {
    grid: [
      '...........w.w..',
      '............w...',
      '......bbbbbbbb..',
      'c...bbbbbbbbbbb.',
      'cc.bbbbbbbbbwkb.',
      'ccbbbbbbbbbbbbbb',
      '.cbaaaaaaaaaaab.',
      '..caaaaaaaaaac..',
      '....cccccccc....',
      '......cc..c.....',
    ],
    alt: { at: 0, rows: ['................', '............w...'] },
  },
  // Latrolet: a round spider with a red hourglass.
  'umbra-blackwidow': {
    mirrored: true,
    grid: ['....bbb', '...bbbb', 'c..bbbr', '.c.bbrr', '..cbbbr', 'c..cbwk', '.c.cbbb', 'c.c..cc', '.c..c..', 'c..c...'],
    alt: { at: 7, rows: ['.cc..cc', 'c...c..', '...c...'] },
  },
  // Grimlarva: a moth with a pale skull mark.
  'umbra-hawkmoth': {
    mirrored: true,
    grid: ['bb......', 'abbb..c.', 'aabbb..c', '.aabbbcw', '..abbbwk', '..cbbbcw', '..cbb.cc', '...cc.cc', '......c.'],
    alt: { at: 0, rows: ['........', 'bbbb..c.'] },
  },
  // Hummlet: a hummingbird with a needle beak.
  'gale-hummingbird': {
    grid: [
      '...ww.........',
      '..wwww........',
      '...wwbbbb.....',
      '....bbbbbwk...',
      '...cbbbbbbbddd',
      '..ccaaaabb....',
      '.cc..aaab.....',
      'c......c.c....',
    ],
    alt: { at: 0, rows: ['..............', '..............', '..wwwbbbb.....'] },
    extra: { w: '#ffffff' },
  },
  // Fluffseed: a dandelion puff on a leafy stem.
  'gale-dandelion': {
    grid: [
      '..a.a.a.a..',
      '.aaaaaaaaa.',
      'a.abbbbba.a',
      '.aabwkwkba.',
      'a.abbbbba.a',
      '.aaaaaaaaa.',
      '..a.a.a.a..',
      '.....c.....',
      '..c..c.....',
      '..cc.c.cc..',
      '...ccccc...',
      '.....c.....',
      '....ccc....',
    ],
    alt: { at: 0, rows: ['.a.a.a.a.a.'] },
  },
};

// ---- bosses -----------------------------------------------------------------

/** Bosses are drawn at scale 5: about 130 pixels wide. */
const BOSS_GRIDS: Record<string, CreatureGrid> = {
  // Komodrake: an ancient fire lizard with gold horns and a spined back.
  'ember-komodo': {
    grid: [
      '................yy.y....',
      '...............bbbbb....',
      '..............bbbbbbb...',
      '......c.c.c..bbbbbwkbb..',
      '.....bbbbbbbbbbbbbbbbbb.',
      '....bbbbbbbbbbbbbbbbbbrr',
      '...bbbbbbbbbbbbbbbaawwa.',
      '..bbbcbbbcbbbcbbbbaaaa..',
      '.bbbbbbbbbbbbbbbbbbb....',
      'bbbbaaaaaaaaaaaabbbb....',
      'bb.baaaaaaaaaaaaabb.....',
      'b...caaaaaaaaaaacb......',
      'b....cccccccccccc.......',
      '.b...ccc..cc..ccc.......',
      '..b..ccc..cc..ccc.......',
      '...bccc..cc..ccc........',
      '....ccw..cw...ccw.......',
    ],
    alt: {
      at: 13,
      rows: ['.b....ccc.cc.ccc........', '..b...ccc.cc.ccc........', '...b.ccc..cc..ccc.......', '.....ccw..cw...ccw......'],
    },
  },
  // Abyssalon: a vast whale with glowing spots.
  'tide-bluewhale': {
    grid: [
      '...................w.w..',
      '....................w...',
      '..........bbbbbbbbb.....',
      '.......bbbbbbbbbbbbbbb..',
      'c....bbbbbbbbbbbbbbbbbb.',
      'cc..bbbbabbbbabbbbbwkbb.',
      'ccc.bbbbbbbbbbbbbbbbbbbb',
      '.ccbbbbbbbbbbbbbbbbbbbbb',
      '..cbbbbbbbbbbbbbbbbbbbbc',
      '...cbaaaaaaaaaaaaaaaaaab',
      '....caaaawaaaawaaaaaaab.',
      '.....caaaaaaaaaaaaaaac..',
      '......ccaaaaaaaaaaacc...',
      '........cccccccccc......',
      '...........ccc..........',
      '..........cc............',
    ],
    alt: { at: 14, rows: ['............ccc.........', '.............cc.........'] },
  },
  // Atroposphinx: a great moth whose thorax bears a skull.
  'umbra-hawkmoth': {
    mirrored: true,
    grid: [
      'bb..........',
      'abbb......c.',
      'aabbbb.....c',
      'aaabbbbb..cc',
      '.aaabbbbbccw',
      '.aaaabbbbcww',
      '..aaabbbbckw',
      '..aaaabbbcww',
      '...abbbbbcwc',
      '...cbbbbb.cc',
      '..cbbbbbb.cc',
      '.cbbbbbbb.cc',
      '.cbbabbbb.cc',
      '..cbbbbb..cc',
      '...cccc...cc',
      '..........c.',
    ],
    alt: { at: 0, rows: ['............', 'bb........c.', 'abbbb......c', 'aabbbbbb..cc'] },
  },
};

export const CREATURE_FAMILIES = Object.keys(CREATURE_GRIDS);
export const BOSS_FAMILIES = Object.keys(BOSS_GRIDS);

function framesOf(art: CreatureGrid): Grid[] {
  const grid = art.mirrored ? mirror(art.grid) : art.grid;
  const alt = art.mirrored ? mirror(art.alt.rows) : art.alt.rows;
  return [grid, replaceRows(grid, art.alt.at, alt)];
}

function creatureSprite(art: CreatureGrid, scale: number, ramp: Ramp): SpriteArt {
  return { scale, palette: palette(art.extra ?? {}, ramp), frames: framesOf(art) };
}

/**
 * A creature's two-frame idle animation in its element's colours, or with
 * `warn` set, the pale version shown before it attacks.
 */
export function creatureArt(familyId: string, element: WeaponElement, warn = false): SpriteArt | null {
  const art = CREATURE_GRIDS[familyId];
  return art ? creatureSprite(art, 2, warn ? WARN_RAMP : ELEMENT_RAMPS[element]) : null;
}

export function bossArt(familyId: string, element: WeaponElement, warn = false): SpriteArt | null {
  const art = BOSS_GRIDS[familyId];
  return art ? creatureSprite(art, 5, warn ? WARN_RAMP : ELEMENT_RAMPS[element]) : null;
}

/** Texture keys, shared by the code that draws the art and the entities that use it. */
export const artKeys = {
  character: (classId: string) => `character-${classId}`,
  npc: (npcId: string) => `npc-${npcId}`,
  weapon: (archetype: string, element: WeaponElement) => `weapon-${archetype}-${element}`,
  creature: (familyId: string) => `creature-${familyId}`,
  boss: (familyId: string) => `boss-${familyId}`,
  warn: (key: string) => `${key}-warn`,
};
