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
- Deploy: GitHub Pages at https://khoikd.github.io/Game1/. `.github/workflows/deploy.yml` typechecks, tests, builds, and publishes on every push to main.

## Architecture
```
src/
  main.ts            # Phaser config/boot
  scenes/            # Boot, ClassSelect, Hub, Level, Inventory, Spirits
  state/             # session: the live profile and stage run, loaded from and written to the save
  entities/          # Player, Enemy (base) and behaviors, Boss, Npc, Bullet
  art/               # sprite grids, palette, shading, tiles, stage backdrops, effects
  systems/           # combat, loot, perks, elements, creatures, progression, save
  data/              # JSON: weapons, perks, creatures, enemies, levels, lore
  ui/                # HUD, menus, tooltips, shared display helpers (rarity colours)
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
- Controls: WASD/arrows to move, Space to jump, mouse to aim, left click to fire, right click for the spirit ability, Shift for the class ability, Q/E to swap weapon, R to reload, F to capture, I inventory, C spirits, Esc to the hub. No gamepad in v1.
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
- Elements: Ember, Tide, Volt, Verdant, Umbra, Gale, in one ring (`data/elements.json`): Tide beats Ember beats Verdant beats Volt beats Gale beats Umbra beats Tide. Strong hits deal 1.5x, resisted hits 0.67x; kinetic is always neutral.
- Damage = base (weapon stats after roll and perks) x element multiplier x crit x target status multiplier. Formula lives in `systems/combat.ts` with tests. Every hit on an enemy goes through `LevelScene.hitEnemy`.
- Status effects, one per element: burn (Ember, damage over time), soak (Tide, target takes 25% more damage), shock (Volt, part of each hit arcs to nearby enemies), root (Verdant, cannot move), blind (Umbra, aimed attacks go wide), slow (Gale, slower movement and attacks). Max one of each per target, no refreshing while active.
- Statuses apply by build-up (`systems/status.ts`): elemental damage fills a per-status meter and the status starts at the threshold. Bosses need 5x the build-up and recover in half the time. An enemy is immune to its own element's status.
- Enemies read `this.mods` (from `statusModifiers`) in `act()` to respect statuses. New enemy behaviors must honor `rooted`, `speedMult`, `cooldownMult`, and `aimErrorRad`.
- Enemy and boss elements are set by `element` in `enemies.json`. A test requires a weapon that is strong against each boss, and at least one weapon of every element.

## Weapons (Destiny-style depth)
- **Archetypes:** pulse rifle, spread gun, beam, launcher, sidearm, melee-burst, charge cannon. Each defines fire pattern, ammo, recoil/spread, and base stats.
- **Rarities:** Common, Uncommon, Rare, Epic, Legendary. Rarity sets perk-slot count and stat ranges.
- **Perks:** 2–4 slots per weapon (barrel, magazine, trait, signature). Rolled from archetype-specific pools. Perks can modify stats, add on-kill/on-hit effects, or interact with creature abilities.
- **Elements:** each weapon has an element or is kinetic.
- **Stats:** damage, fire rate, range, stability, reload, magazine size, handling.
- Weapons defined in `data/weapons.json`; perks in `data/perks.json`.
- A weapon the player owns is a `WeaponInstance` (`systems/loot.ts`): a base weapon id plus its rolled rarity, damage roll, and perk ids. `resolveWeaponInstance` turns it into playable stats: base, then damage roll, then perks.
- A base weapon's `rarity` in `weapons.json` is a floor: it never drops below that rarity.
- Rarity rules in `drops.json`: common and uncommon roll barrel and magazine perks, rare and epic add a trait, legendary adds a signature. Each rarity has its own damage-roll range.
- A perk lists the archetypes it can roll on (`"*"` for any) and its stat mods (`add` or `mul`). Every archetype must keep at least one perk per slot; a test enforces this.
- Drop tables in `drops.json` are keyed by creature rarity (`common` to `legendary`) plus `boss`; rarer creatures drop more often and better.
- `weapons.json` layout: `archetypes` hold every stat; each entry in `weapons` names an archetype and may override any stat under `stats`. The file is validated at load (`data/weaponData.ts`), so bad data throws with the offending weapon and field.
- Trigger modes: `auto` (hold), `semi` (one shot per click), `burst` (hold for repeated bursts), `semi-burst` (one full burst per click; the Field Carbine uses this), `charge` (hold, release when full; releasing early cancels).
- Stat effects: stability sets random scatter, handling sets the delay after a swap, range and projectile speed set how long a shot lives, `pierce` passes through extra enemies, `gravity` arcs the shot, `blastRadius` explodes on impact.
- A new weapon needs only a `weapons` entry. A new projectile look needs a texture in `src/art/effects.ts` and its key in `projectile`.

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
- **Spirit slots grow by attunement to an element.** Every capture counts toward an attunement track for the captured creature's element (dual-element creatures count toward both). Reaching a threshold unlocks an additional spirit slot that accepts that element. Start with 2 universal slots. Thresholds per element: 5, 15, and 30 captures (3 bonus slots per element, set in `balance.json`).
- Equipped spirits can be swapped at checkpoints and in the hub, not mid-fight.
- Capturing a creature you already own does not add a second copy; it grows the existing spirit (see below).
- **Implementation:** an enemy is a creature when its `enemies.json` entry has `creature: { family, stage }`; its element must be that family's first element (a test enforces this). `LevelScene.weaken` starts the capture window, `tryCapture` handles F, and a captured creature leaves no loot. Collection logic is pure in `systems/spirits.ts`; every change goes through `LevelScene.applySpirits`.
- **Perks from stats** (`balance.json` `perks`): Power raises weapon damage, Vitality raises max health, Agility raises move speed and shortens reloads, Focus raises crit chance and shortens the ability cooldown. Stats of all equipped spirits are summed. Weapons matching an equipped spirit's element deal 10% more.
- **Abilities:** right click uses the ability of the spirit in the first slot. The effect comes from the creature's role via `balance.json` `abilities.byRole`: burst, bolt, shield, heal, or field. The name shown is the creature's own ability name.
- **Screen:** C opens the spirits screen. Outside the swap range of the active checkpoint it is read-only.
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
  - **Element tilt** (a bias, not a power difference; each element's tilts sum to the same total; the favored stat is 1.15x, the rest about 0.95x): Ember favors Power; Tide favors Vitality and sustain; Volt favors Agility and fire rate; Verdant favors Vitality and defense; Umbra favors Focus, crit, and lifesteal; Gale favors Agility and mobility.
  - **Role base:** each role (Tank, Striker, Support, Skirmisher, etc.) defines a base distribution across the four stats.
- `tests/spirits.test.ts` simulates all 150 creatures and fails if any one's total stat budget is more than 10% from its rarity-and-stage target, or if any element or role averages more than 6% off. Re-run it after changing `roleBase` or `elementTilt`.

## Loot & Progression
- Drops: enemies, chests, bosses, secrets. Seeded RNG; drop tables in `data/drops.json`.
- Inventory: weapons, bonds, consumables, materials. Weapons only so far (`systems/inventory.ts`): 20 carried, 3 equipped, equipped weapons cannot be discarded. The inventory follows the checkpoint rule as a snapshot: death restores the inventory as last banked, including discards and loadout changes.
- **Levels:** enemies give experience (`xp` in `enemies.json`, times the tier's `xpMult`). Level L to L+1 costs `xp.base x L`. Each level adds 2% weapon damage; every 5 levels adds 1 max health. Experience follows the checkpoint rule like everything else.
- **Power:** average `weaponPower` (by rarity) of the three weapon slots, an empty slot counting zero, plus the player's level (`systems/progression.ts`).
- **Tiers:** each stage has tiers from `progression.json`. A tier opens when the previous stage has been cleared (any tier), the tier below is cleared, and Power meets the tier's `requiredPower` plus the stage's `powerOffset`. Higher tiers raise creature evolution stage (`stageBonus`), boss health, and experience. The boss spirit scales with `stageLevel` (stage position plus tier).
- **Classes** (`classes.json`): Vanguard (+1 health; spread gun and melee burst; Bulwark invulnerability), Skirmisher (speed and reload; sidearm and pulse rifle; Slipstream dash), Warden (status build-up and spirit cooldown; beam, charge cannon, launcher; Stasis Pulse slow). Every weapon archetype belongs to exactly one class (a test enforces this). Class can be changed in the hub; weapons, spirits, and level are shared across classes.
- **Bonuses:** `withClassAndLevel` folds class and level into the spirit bonuses, and `applyBonuses` applies the result to each weapon. `LevelScene.refreshBonuses` is the one place that recomputes them.
- **Hub** (`scenes/HubScene.ts`): character summary, stage and tier select (number keys: 1 to 3 for the first stage, 4 to 6 for the second, 7 to 9 for the third), inventory (I), spirits (C, always swappable here), class change (K). No shops or currency yet.
- **Flow:** Boot goes to class select for a new player, to the stage in progress if there is one, otherwise the hub. In a stage, Esc returns to the hub: one press after the stage is cleared, two presses mid-stage, which abandons the stage and loses anything at risk.
- **Save** (`systems/save.ts`, version 5): `profile` (class, experience, inventory, spirits, highest tier cleared per stage) plus `run` (stage, tier, checkpoint, banked pickups and defeats), which is null in the hub or before the first checkpoint. Versions 1 to 4 migrate to a profile with no class and a tier 1 run. `state/session.ts` holds the live profile and run; scenes change them through `setProfile` and `setRun` and call `saveSession`.

## Milestones (build in vertical slices; commit after each)
1. (done) Player movement, jump, mouse aiming, shoot, flat test level, placeholder art.
2. (done) Tiled tilemap level, scrolling camera, checkpoints (activation, respawn, persisted resume). Death rollback currently covers pickups; items, weapon advancements, and spirits join `systems/runState.ts` as they are built.
3. (done) Enemy base class, health, hit detection, one stage boss. Player has 5 HP with i-frames; walker and turret enemies; two-phase boss (Komodrake) with telegraphed volleys. Defeating the boss clears the stage and banks all progress. Enemy and boss stats live in `src/data/enemies.json`. Boss capture comes with milestone 7.
4. (done) Weapon data model and archetypes loaded from JSON. All seven archetypes are playable; firing logic is a pure state machine in `systems/weapon.ts`. Until loot exists, the player carries the `starterLoadout` from `weapons.json` (one weapon per archetype). Elements are labels only until milestone 6.
5. (done) Loot drops, inventory UI, perk rolling (with Vitest coverage). Enemies drop weapons from `drops.json` tables; rarity sets perk slots and the damage roll; perks come from `perks.json`. The player starts with two starter weapons, carries up to 20, and equips 3. Perks are stat modifiers only; on-hit and on-kill perks come with milestone 6.
6. (done) Element system and status effects. Six-element wheel, damage formula with crits, six statuses applied by build-up, enemy elements with a pip above each enemy, floating damage numbers. Weapon stats gained `critChance`, `statusBuildup`, and `killRefund`, with perks for each. Statuses affect enemies only; the player cannot be afflicted yet.
7. (done) Spirit capture, equipped-spirit perks and abilities, evolution, stat balancing formula and simulation test. Creatures are weakened at zero health and captured with F; spirits give stat perks, elemental affinity, and a right-click ability; element slots unlock by attunement; the balance simulation covers all 150 creatures. Abilities are five generic effects chosen by role, not yet the unique ability each creature's text describes.
8. (done) Classes, hub, progression, save/load. Three classes with a passive, favoured weapon archetypes, and a Shift ability; a hub for loadout, spirits, class, and stage select; player levels from experience; a Power score that unlocks harder tiers of a stage; saves split into a profile and the stage in progress. The hub is a menu, not a walkable area, and has no shops yet.
9. (done) Content pass: 3 stages (Thornway, Brinemere, Duskhollow), 6 enemy behaviors, 3 bosses (Komodrake, Abyssalon, Atroposphinx), 22 weapons, and 12 creature families (36 creatures, each with a lore line) playable as enemies at all three evolution stages. Remaining 38 families can be added in batches by element: an entry in `enemies.json` `creatures`, lore lines, and placements in `tools/gen-levels.mjs`.
10. Audio, polish, performance, deploy.

## Conventions
- TypeScript strict; no `any` without a comment explaining why.
- Small modules; one responsibility per file.
- Naming: `camelCase` vars/functions, `PascalCase` classes/types, `kebab-case` data files.
- All art is authored in code (see Art Direction); the only image file is the plain collision tileset.
- Commit messages: imperative, scoped (e.g., `combat: add element multiplier`).
- Levels are generated by `tools/gen-levels.mjs` (run `node tools/gen-levels.mjs`), which checks that every enemy has ground under it, roaming enemies have room, and the boss arena is unbroken. The output is Tiled JSON in `public/assets/levels/` (tileset `public/assets/tilesets/tiles.png`), so a level can be opened in Tiled, but re-running the script overwrites hand edits. A new stage also needs an entry in `progression.json` and an import in `tests/content.test.ts`. Object layer types: `spawn` (point on the floor), `checkpoint` (rectangle on the floor, int property `order`; it activates when the player touches any part of the column above the rectangle's base, up to the top of the map, so jumping over the flag counts), `pickup` (point), `enemy` (point on the surface it stands on, or its hover line for flyers; string property `kind` is a creature family id from `enemies.json` `creatures`, optionally with a starting stage such as `verdant-oak@2`) `boss` (point on the floor; `kind` is a key in `enemies.json` `bosses`), and `npc` (point on the floor; string property `npc` is a key in `src/data/npcs.json`, which holds the NPC's name and lines per stage). Each checkpoint, pickup, enemy, and boss needs a unique name, which becomes its id in save data.
- Enemies: extend `entities/Enemy.ts` and implement `act()`. Every ranged, leaping, or charging attack needs a telegraph beat (`showWarning(true)`, which swaps to the pale `-warn` texture) before it lands. Do not name a field `originX`, `originY`, or `state`; Phaser sprites already use those.
- Scene fields survive a scene restart: in `create()`, never assume an object from the previous run is alive (check `obj?.scene`).
- **Enemies are creatures** (`enemies.json`): `behaviors` hold base numbers for the six behaviors (walker, turret, hopper, flyer, charger, lobber); `creatures` maps each family to a behavior with optional `overrides`; `stageScaling` scales health, experience, contact damage, speed, cooldowns, and size by evolution stage. An enemy's element and drop table come from its family (drop tables are keyed by creature rarity, plus `boss`). The tier's `stageBonus` raises every creature's stage, capped at 3.
- **Bosses** are the stage 3 form of a family, set in `enemies.json` `bosses`. Each phase picks a pattern: `aimed` (fan at the player), `ring` (all directions, rotating each volley), or `rain` (a line falling from above the player, spaced `BOSS_RAIN_SPACING` apart). A test checks every pattern leaves gaps the player can fit through.
- Enemy textures come in every element's colours, generated in `BootScene.makeEnemyTextures`; use `enemyTexture(shape, element)`.
- Creature lore lines live in `src/data/creature-lore.json`, keyed by creature name, and show in the spirits screen.
- `window.__tamerunner` exposes the Phaser game for console debugging and headless smoke tests.
- Save data is versioned (`SAVE_VERSION` in `systems/save.ts`). Changing its shape means bumping the version and adding a migration case.
- Dev shortcut: F9 (in a stage or the hub) erases the save and restarts from class select.
- Read one-shot key presses (swap, reload) from `keydown-<KEY>` events, not `JustDown` polling, which misses taps shorter than a frame.
- Read clicks from `pointerdown` events for the same reason.
- Overlay screens (inventory, spirits) are their own scene launched over the paused level; they hand their result back through an `onClose` callback. All inventory changes in the level go through `applyInventory`.

## Art Direction
- **Look:** detailed 2D, like late-90s pre-rendered sprites: big-headed characters with smooth, rounded shading (light from the upper left, cool violet shadows, warm lights), specular highlights on metal, a rim light on the far edge, a thin dark outline (`#1b1426`), soft contact shadows, and a glow around element-coloured parts. Every design is original; the IP rules apply to art as much as names.
- **Resolution:** scenes lay out in the logical 960 x 540 view; the canvas is `RENDER_SCALE` (2, or 1 on small screens) times larger and each scene's camera is zoomed to match with `useDetailCamera` (`src/ui/detailCamera.ts`), which also corrects Phaser's follow, centre, bounds, and culling maths for a top-left origin. Text is rasterised at the canvas resolution. Read the pointer as `pointer.worldX`, or `pointer.x / RENDER_SCALE` for screen-fixed UI.
- **How it is made:** sprites are text grids in `src/art/sprites.ts` (one character per cell, palette letters from `src/art/palette.ts`, `.` transparent). `src/art/shade.ts` (pure, tested) upscales each grid with Scale2x and lights every texel as a 3D form; `src/art/render.ts` puts the result into canvas textures at boot. Textures hold more texels than world pixels, so scale every sprite by `displayScale(key)`; world sizes are unchanged.
- **Stages:** `src/art/stageArt.ts` paints a detailed tileset per stage from `src/art/themes.ts` (tile shapes chosen by which neighbours are solid, in `src/art/tiles.ts`), draws it as a half-scale layer over the hidden collision layer, adds a three-layer parallax backdrop, and keeps shadows under the player, NPCs, and enemies. A new stage needs a theme entry (otherwise it uses Thornway's).
- **Effects:** projectiles (one texture per element: `<projectile>-<Element>`), pickups, loot crates, checkpoints, the reticle, and the shadow are painted with canvas gradients in `src/art/effects.ts`.
- **Characters:** 14 x 30 cells at scale 2 (32 x 64 pixels with the outline), built from a class upper body layered over a leg pose. Seven frames: idle (2), run (4), jump (1). Each class has its own look; the guide NPC uses the same size.
- **Creatures:** one sprite per family, two-frame idle loop, scale 2, about one tile. "a", "b", "c" in a grid are the family's element colours, so a sprite takes its element's hue. A pale "-warn" version plays during the telegraph before an attack. A family without art falls back to a plain shape in its element colour (`enemyTexture`).
- **Bosses:** scale 5, about four tiles wide, two-frame loop, plus a warn version.
- **Weapons:** one sprite per archetype, recoloured by element, with a fist on the grip; the player shows whichever weapon is active.
- **Palette:** each element owns a hue family (Ember red-orange, Tide blue, Volt yellow, Verdant green, Umbra violet, Gale cyan-white). Keep backgrounds lower contrast than interactables and projectiles for readability.
- **Adding art:** add a grid to `sprites.ts` (facing right, no outline), give it a second frame with `alt` rows, and run the tests. A symmetric sprite can be written as its left half with `mirrored: true`.
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
- Spirit slots grow by capturing creatures of the same element (attunement thresholds), not the same species.
- Spirit growth from a capture scales with the captured creature's rarity and evolution stage.
- Stat balancing: formula by rarity, evolution stage, and element, driven by `balance.json`.
- Art: detailed 2D at twice the old pixel density, shaded like pre-rendered 3D (see Art Direction).
- Roster: 150 creatures (50 families x 3 stages) based on real fauna/flora.

## Open Questions (decide early)
- Attunement thresholds (5, 15, 30) and whether bosses need a special capture condition beyond the shorter window.
- Whether each creature should get its own unique ability, or keep the five role-based effects.
- Mobile/touch support (currently out of scope).
