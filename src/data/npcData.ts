import { NPC_ART } from '../art/sprites';
import { progression } from './progressionData';
import raw from './npcs.json';

/** Characters the player meets in a stage, and what they say there. */
export interface NpcDef {
  name: string;
  title: string;
  /** Lines by stage id, spoken in order while the player stands nearby. */
  lines: Record<string, string[]>;
}

/** Checks npcs.json at load. */
export function validateNpcs(input: unknown): Record<string, NpcDef> {
  const npcs = (input as { npcs?: Record<string, NpcDef> } | null)?.npcs;
  if (!npcs || Object.keys(npcs).length === 0) throw new Error('npcs.json: expected "npcs"');
  const stageIds = new Set(progression.stages.map((s) => s.id));
  for (const [id, npc] of Object.entries(npcs)) {
    const where = `npcs.json: "${id}"`;
    if (!npc.name || !npc.title) throw new Error(`${where}: needs a name and a title`);
    if (!NPC_ART[id]) throw new Error(`${where}: has no art in src/art/sprites.ts`);
    for (const [stageId, lines] of Object.entries(npc.lines ?? {})) {
      if (!stageIds.has(stageId)) throw new Error(`${where}: lines for unknown stage "${stageId}"`);
      if (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== 'string' || line.trim() === '')) {
        throw new Error(`${where}: stage "${stageId}" needs at least one line`);
      }
    }
  }
  return npcs;
}

export const npcDefs = validateNpcs(raw);

export function getNpc(id: string): NpcDef {
  const npc = npcDefs[id];
  if (!npc) throw new Error(`Unknown NPC "${id}" (see src/data/npcs.json)`);
  return npc;
}
