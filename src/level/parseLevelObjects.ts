/**
 * Turns the Tiled "objects" layer into typed level data.
 *
 * Object types recognised in Tiled:
 *   spawn       point; x, y = floor surface where the player starts
 *   checkpoint  rectangle standing on the floor; custom int property "order"
 *               (1, 2, 3, ... in the order the player should reach them)
 *   pickup      point; x, y = centre of the pickup
 *   enemy       point; x, y = surface the enemy stands on; custom string
 *               property "kind" (a key under "enemies" in src/data/enemies.json)
 *   boss        point; x, y = floor surface; custom string property "kind"
 *               (a key under "bosses" in src/data/enemies.json)
 * Each checkpoint, pickup, enemy, and boss needs a unique name; it is used as its id.
 */
export interface RawObject {
  name?: string;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: ReadonlyArray<{ name: string; value: unknown }>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CheckpointDef {
  id: string;
  order: number;
  rect: Rect;
}

export interface PickupDef {
  id: string;
  x: number;
  y: number;
}

export interface EnemyDef {
  id: string;
  kind: string;
  x: number;
  y: number;
  boss: boolean;
}

export interface LevelObjects {
  spawn: { x: number; y: number };
  checkpoints: CheckpointDef[];
  pickups: PickupDef[];
  enemies: EnemyDef[];
}

export function parseLevelObjects(objects: readonly RawObject[]): LevelObjects {
  let spawn: LevelObjects['spawn'] | null = null;
  const checkpoints: CheckpointDef[] = [];
  const pickups: PickupDef[] = [];
  const enemies: EnemyDef[] = [];
  const seen = new Set<string>();

  const claimId = (obj: RawObject): string => {
    const id = obj.name;
    if (!id) throw new Error(`Level object of type "${obj.type}" at (${obj.x}, ${obj.y}) needs a name`);
    if (seen.has(id)) throw new Error(`Duplicate level object name "${id}"`);
    seen.add(id);
    return id;
  };
  const property = (obj: RawObject, name: string): unknown =>
    obj.properties?.find((p) => p.name === name)?.value;

  for (const obj of objects) {
    switch (obj.type) {
      case 'spawn':
        if (spawn) throw new Error('Level has more than one spawn');
        spawn = { x: obj.x, y: obj.y };
        break;
      case 'checkpoint': {
        const id = claimId(obj);
        const order = property(obj, 'order');
        if (typeof order !== 'number') throw new Error(`Checkpoint "${id}" needs an int property "order"`);
        checkpoints.push({
          id,
          order,
          rect: { x: obj.x, y: obj.y, width: obj.width ?? 32, height: obj.height ?? 96 },
        });
        break;
      }
      case 'pickup':
        pickups.push({ id: claimId(obj), x: obj.x, y: obj.y });
        break;
      case 'enemy':
      case 'boss': {
        const id = claimId(obj);
        const kind = property(obj, 'kind');
        if (typeof kind !== 'string' || kind === '') {
          throw new Error(`${obj.type === 'boss' ? 'Boss' : 'Enemy'} "${id}" needs a string property "kind"`);
        }
        enemies.push({ id, kind, x: obj.x, y: obj.y, boss: obj.type === 'boss' });
        break;
      }
      default:
        break; // unknown types are ignored so the map can carry editor-only objects
    }
  }

  if (!spawn) throw new Error('Level has no spawn object');
  checkpoints.sort((a, b) => a.order - b.order);
  return { spawn, checkpoints, pickups, enemies };
}

/**
 * The area that activates a checkpoint: the flag's column from the top of the
 * map down to the flag's base. Touching any part of it counts, including
 * jumping over the flag.
 */
export function checkpointTriggerZone(rect: Rect): Rect {
  return { x: rect.x, y: 0, width: rect.width, height: rect.y + rect.height };
}
