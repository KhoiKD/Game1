# CLAUDE.md — Working Title: "Tamerunner" (rename freely)

Web-based side-scrolling run-and-gun with creature lore and looter-shooter depth.

## Design Pillars
1. **Contra feel:** tight, responsive run-and-gun. Free mouse aiming, jump, short i-frames, pattern-based bosses.
2. **Creature lore:** an original world of creatures, types, evolutions, factions. Creatures are the narrative and ability layer.
3. **Looter-shooter depth:** weapon archetypes, rarities, rolled perks, elemental damage, class abilities, build crafting.
4. **Fusion rule:** every system must reinforce the others. Creatures supply elements and abilities; weapons supply damage and playstyle; levels test both.

## IP Rules (hard constraint)
- No Pokémon, Contra, or Destiny names, characters, designs, music, or art. Mechanics and genre conventions are fine; expression is not.
- All creatures, factions, places, weapons, and story are original. Use placeholder names from `data/lore.json`.
- Only use assets with licenses recorded in `ASSETS.md`.

## Tech Stack
- Phaser 4 (Arcade Physics), TypeScript (strict), Vite. Check Phaser 4 docs before relying on Phaser 3 patterns from memory.
- Tiled for levels (JSON export), Vitest for unit tests, Playwright for smoke tests
- Persistence: localStorage (versioned save schema)
- Deploy: static build to Netlify or GitHub Pages

## Architecture
```
src/
  main.ts            # Phaser config/boot
  scenes/            # Boot, Menu, Level, Hub, Inventory, GameOver
  entities/          # Player, Enemy (base), Boss, Projectile, Pickup
  systems/           # combat, loot, perks, elements, creatures, progression, save
  data/              # JSON: weapons, perks, creatures, enemies, levels, lore
  ui/                # HUD, menus, tooltips
  level/             # Tiled object-layer parsing (spawn, checkpoints, pickups)
  util/              # rng (seedable), math, events
tests/               # Vitest for systems/
public/assets/       # sprites, audio, tilemaps
```
Rules:
- **Data-driven:** content lives in `src/data/*.json`, validated by schema at load. Adding content must not require engine changes.
- **Systems are pure where possible** (damage, loot, perk rolls take inputs, return outputs, use a seedable RNG) so they're testable.
- Entities hold state; systems hold logic. Communicate via a typed event bus.
- Fixed-step gameplay logic; no frame-rate-dependent behavior.

## Core Gameplay
**Player**
- Run, jump (variable height), crouch/prone, free aim toward the mouse pointer (360°), hold-to-fire or tap-to-fire per weapon.
- Health bar (small pool), brief i-frames on hit, respawn at last checkpoint.
- Controls: WASD/arrows to move, Space to jump, mouse to aim, left click to fire, right click for creature ability, Q/E to swap weapon/creature, R to reload. No gamepad in v1.
- Aim reticle replaces the OS cursor in-game. Aim angle is computed from the player's weapon pivot to the pointer in world coordinates (account for camera scroll).
- Single-player only. No online features, co-op, or leaderboards.

**Levels**
- Side-scrolling stages with branching paths, hazards, mini-bosses, and a stage boss.
- Enemy waves tied to stage biome; biome favors certain elements.
- **Checkpoints:** placed roughly every 60–90 seconds of play, before every mini-boss and boss, and after major hazard sections. Activating one saves position, health refill amount, ammo, loadout, and collected loot for that run. Checkpoint state is persisted so reloading the page resumes from it.
- **Death penalty:** dying respawns the player at the last activated checkpoint and rolls back everything gained since it: items and loot picked up, weapon advancements (upgrades, perk unlocks, weapon XP/levels), and spirits captured. Stage progress also resets to the checkpoint (defeated enemies respawn, opened chests re-close). Everything gained before the checkpoint is kept. No lives counter, no permadeath. Implement as a snapshot taken at checkpoint activation and restored on death; the player's run state must be fully serializable.
- The HUD should make the risk legible: show a "unsecured gains" indicator (items, weapon progress, spirits earned since the last checkpoint) so players can judge whether to push on or backtrack to a checkpoint.
- Optional vertical sections.

**Bosses**
- 2–3 phases, readable telegraphs, weak points, element vulnerabilities.

## Combat & Elements
- Elements (placeholder): Ember, Tide, Volt, Verdant, Umbra, Gale. Each has strengths/weaknesses in a simple wheel (`data/elements.json`).
- Damage = base × weapon mods × perk mods × element multiplier × crit. Formula lives in `systems/combat.ts` with tests.
- Status effects: burn, soak, shock, root, blind, slow. Max one of each type per target.

## Weapons (Destiny-style depth)
- **Archetypes:** pulse rifle, spread gun, beam, launcher, sidearm, melee-burst, charge cannon. Each defines fire pattern, ammo, recoil/spread, and base stats.
- **Rarities:** Common, Uncommon, Rare, Epic, Legendary. Rarity sets perk-slot count and stat ranges.
- **Perks:** 2–4 slots per weapon (barrel, magazine, trait, signature). Rolled from archetype-specific pools. Perks can modify stats, add on-kill/on-hit effects, or interact with creature abilities.
- **Elements:** each weapon has an element or is kinetic.
- **Stats:** damage, fire rate, range, stability, reload, magazine size, handling.
- Weapons defined in `data/weapons.json`; perks in `data/perks.json`.

## Creatures (Pokémon-style lore, original IP)
- **Roster:** 150 creatures = 50 evolution families x 3 stages, each based on a real animal, plant, or fungus. Source of truth: `src/data/creatures.json` (families, inspiration species, elements, role, rarity, ability, evolution levels, stage names). Do not rename or reorder entries without asking; dex numbers derive from file order.
- Names, designs, and lore are original. Real species supply inspiration only (silhouette, behavior, habitat). Evolution stages should keep the species recognizable while becoming more fantastical.
- Each creature: name, type(s), lore blurb, base stats, ability, evolution line, rarity, habitat.
- Lore blurbs and per-stage ability upgrades are written later, in batches by element. Stats are computed from the balance formula below, not hand-entered.
- **Lore:** original region with 3–4 factions, a central mystery, and a recurring rival character. Details in `data/lore.json` and `LORE.md`.

**Spirit capture (core mechanic)**
- Wild creatures appear as enemies and mini-bosses. Fight one normally: deplete its health to zero.
- At zero health the creature is **weakened** instead of dying: it staggers and glows for a short capture window (default 3s; longer for rarer creatures, shorter for bosses). While it is in range, press the Capture button (default `F`) to capture its **spirit**.
- Pressing nothing in time defeats it normally (loot drop, no spirit). Capturing is guaranteed if the window is met; no RNG. The risk is positioning and timing under fire.
- A captured spirit is added to the player's collection and, when equipped in a spirit slot, **adds perks to the character's fighting mechanics**: stat bonuses, on-hit/on-kill effects, movement upgrades, and the creature's signature ability (from `creatures.json`) usable on right click. Elemental affinity boosts matching weapons.
- **Bosses can be captured.** A boss uses the same flow (deplete health, then capture within the window) with a shorter window (default 2s). Boss spirits grant the **largest perks relative to the level of the stage they come from**: perk magnitudes use a boss multiplier on top of the normal formula (see Stat balancing), and scale with the stage's level so a boss spirit is always the strongest option available at that point in the game. Bosses are drawn from the 150-creature roster (typically stage-3 forms of rare, epic, or legendary families).
- **Spirit slots grow by attunement.** Every capture counts toward an attunement track for the captured creature's element (dual-element creatures count toward both). Reaching a threshold unlocks an additional spirit slot that accepts that element. Start with 2 universal slots. Default thresholds per element: 5, 15, and 30 captures (3 bonus slots per element, capped by `balance.json`). Interpretation: "spirit type" = element; change in `balance.json` if you meant species.
- Equipped spirits can be swapped at checkpoints and in the hub, not mid-fight.
- Capturing a creature you already own does not add a second copy; it grows the existing spirit (see below).
- Spirits captured after the last checkpoint are lost on death (see death penalty).

**Growth**
- Spirits gain XP from the player's kills while equipped, evolve at their listed levels (stage 2, stage 3), and unlock stronger perks per stage. Evolving changes perks and visuals, not the creature's identity.
- **Capture growth:** every capture awards growth points to that spirit. The amount depends on the **rarity and evolution stage of the creature captured**: `growth = baseGrowth × rarityGrowth × stageGrowth`. A first capture of a creature at stage 2 or 3 gives you that spirit at the captured stage, with starting growth from the same formula. Growth points feed the spirit's level and evolution progress.

**Stat balancing (by rarity, evolution stage, element)**
- Spirit stats: Power (damage perks), Vitality (health/defense perks), Agility (speed, dash, fire rate), Focus (cooldown, crit, ability potency).
- Formula: `stat = roleBase[stat] × rarityMult × stageMult × elementTilt[element][stat]`, with perk magnitudes derived from the final stat. Dual-element creatures average the tilts of their two elements.
- All tuning values live in `src/data/balance.json`; nothing hardcoded in systems.
- **Boss multiplier:** perk magnitudes from a boss spirit use `bossMult` (start 1.5), applied after rarity and stage, and scaled to the stage's level.
- **Capture growth multipliers (starting values):** rarityGrowth common 1, uncommon 1.5, rare 2.5, epic 4, legendary 6; stageGrowth stage 1 = 1, stage 2 = 2, stage 3 = 4. baseGrowth is tuned so a common stage-1 capture is a small step and a legendary stage-3 capture is a major one.
- Starting values (tune by playtest and simulation tests):
  - **Rarity:** common 1.00, uncommon 1.10, rare 1.25, epic 1.45, legendary 1.70
  - **Stage:** stage 1 = 1.0, stage 2 = 1.6, stage 3 = 2.4
  - **Element tilt** (a bias, not a power difference; each element's tilts sum to the same total): Ember favors Power; Tide favors Vitality and sustain; Volt favors Agility and fire rate; Verdant favors Vitality and defense; Umbra favors Focus, crit, and lifesteal; Gale favors Agility and mobility.
  - **Role base:** each role (Tank, Striker, Support, Skirmisher, etc.) defines a base distribution across the four stats.
- Add a Vitest simulation that computes all 150 creatures and fails if any one's total stat budget deviates beyond a set band from its rarity-and-stage target, or if any single element or role dominates.

## Loot & Progression
- Drops: enemies, chests, bosses, secrets. Seeded RNG; drop tables in `data/drops.json`.
- Inventory: weapons, bonds, consumables, materials.
- Power progression: level plus a gear-score-style "Power" stat that gates stage difficulty tiers.
- Classes (3 to start): each has a unique ability, passive, and weapon affinity. Placeholder: Vanguard, Skirmisher, Warden.
- Hub scene: manage loadout, bonds, shops, stage select.
- Save: versioned JSON in localStorage with migration function.

## Milestones (build in vertical slices; commit after each)
1. (done) Player movement, jump, mouse aiming, shoot, flat test level, placeholder art.
2. (done) Tiled tilemap level, scrolling camera, checkpoints (activation, respawn, persisted resume). Death rollback currently covers pickups; items, weapon advancements, and spirits join `systems/runState.ts` as they are built.
3. Enemy base class, health, hit detection, one stage boss.
4. Weapon data model and archetypes loaded from JSON.
5. Loot drops, inventory UI, perk rolling (with Vitest coverage).
6. Element system and status effects.
7. Spirit capture, equipped-spirit perks and abilities, evolution, stat balancing formula and simulation test.
8. Classes, hub, progression, save/load.
9. Content pass: 3 stages, 6 enemy types, 3 bosses, 20 weapons, first 12 creature families (36 creatures) fully implemented. Remaining families added in batches by element.
10. Audio, polish, performance, deploy.

## Conventions
- TypeScript strict; no `any` without a comment explaining why.
- Small modules; one responsibility per file.
- Naming: `camelCase` vars/functions, `PascalCase` classes/types, `kebab-case` data files.
- Placeholder art: colored rectangles and shapes until mechanics feel right.
- Commit messages: imperative, scoped (e.g., `combat: add element multiplier`).
- Levels are authored in Tiled: edit `public/assets/levels/level1.json` with tileset `public/assets/tilesets/tiles.png`. Object layer types: `spawn` (point on the floor), `checkpoint` (rectangle on the floor, int property `order`), `pickup` (point). Each checkpoint and pickup needs a unique name, which becomes its id in save data.
- Save data is versioned (`SAVE_VERSION` in `systems/save.ts`). Changing its shape means bumping the version and adding a migration case.
- Dev shortcut: F9 clears the save and restarts the level.

## Art Direction
- **Look:** "pixel-grid vector." Sprites read as 32px-scale pixel art (chunky silhouettes, limited palette per sprite, hard-edged shapes snapped to a 32px grid) but carry vector-level detail: crisp anti-aliased edges, smooth gradients and rim lighting, fine line details, subtle glow on elemental effects.
- **Implementation:** author sprites as SVG or high-res PNG (4x), render at a base 32px grid unit, scale with nearest-neighbor or integer scaling for crispness. Pixel-snap positions in rendering (`roundPixels: true`) so movement stays crisp.
- **Grid:** tiles are 32x32. Player is ~1x2 tiles; small creatures 1x1, bosses 4x4 or larger.
- **Palette:** each element owns a hue family (Ember red-orange, Tide blue, Volt yellow, Verdant green, Umbra violet, Gale cyan-white). Keep backgrounds lower contrast than interactables and projectiles for readability.
- **Animation:** 4–8 frames for run, 2–4 for idle; telegraph frames for enemy attacks are mandatory.
- Record every asset's source and license in `ASSETS.md`.

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm test` — Vitest
- `npm run typecheck` — TypeScript check
- `npm run test:e2e` — Playwright smoke test (game boots, player moves, shot fires). Not set up yet.
- `npm run lint` — Not set up yet.

## Working Agreement for Claude
- Use plan mode before each milestone; propose the approach, wait for approval.
- Implement one milestone slice at a time; keep diffs reviewable.
- Run typecheck and tests after changes; fix failures before reporting done.
- After gameplay changes, launch the game and verify in the browser; report what was observed.
- Ask before adding dependencies, changing the data schema, or altering core pillars.
- Add or update tests for any change to damage, loot, perk, or save logic.
- Never use third-party IP. Flag any request that would.

## Decisions (locked)
- Single-player only.
- Mouse-pointer aiming (360°); no 8-direction lock.
- Checkpoint-based progression; no permadeath. Death rolls back all items, weapon advancements, and captured spirits gained since the last checkpoint.
- Capture: deplete a creature's health, then press the Capture button within the window to take its spirit; spirits add perks to the player's fighting mechanics.
- Bosses are capturable and give the largest perks relative to the level of their stage.
- Spirit slots grow by capturing creatures of the same type (element attunement thresholds).
- Spirit growth from a capture scales with the captured creature's rarity and evolution stage.
- Stat balancing: formula by rarity, evolution stage, and element, driven by `balance.json`.
- Art: 32px-grid pixel look with vector-level detail (see Art Direction).
- Roster: 150 creatures (50 families x 3 stages) based on real fauna/flora.

## Open Questions (decide early)
- Is "spirit type" for slot growth the element (current default) or the species?
- Attunement thresholds, max slot cap, and whether bosses need a special capture condition beyond the shorter window.
- Mobile/touch support (currently out of scope).
