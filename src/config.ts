// Core tuning constants. Gameplay values that will grow (weapons, creatures,
// balance) belong in src/data/*.json, not here.

export const TILE = 32;
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const WORLD_WIDTH = 3200;

export const GRAVITY = 1500;

// Player
export const MOVE_SPEED = 260;
export const JUMP_SPEED = 620;
export const JUMP_CUT_FACTOR = 0.45; // velocity multiplier when jump is released early
export const COYOTE_MS = 100;

// Placeholder weapon (replaced by data-driven weapons in milestone 4)
export const FIRE_INTERVAL_MS = 110;
export const BULLET_SPEED = 900;
export const BULLET_LIFETIME_MS = 900;
