// cells: the 27 cells (nine operators x three grains), read-only, from cells.json (data, never code). Node built-ins only.
// The one home of the cube for every repo that works with pharos: a repo asks pharos for a cell, it does not import another repo's copy.
// Contract (the same as the cube readers it replaces): cellOf(op, grain) -> a frozen { id, rank, op, grain, mode, domain, terrain, stance }, or { gap, reason, known } for an unknown operator or grain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'cells.json'), 'utf8'));
export const CHAIN = Object.freeze([...DATA.chain]);
export const GRAINS = Object.freeze([...DATA.grains]);
export const CELLS = Object.freeze(DATA.cells.map((c) => Object.freeze({ ...c })));
const BY = new Map(CELLS.map((c) => [`${c.op}|${c.grain}`, c]));
export const cellOf = (op, grain) => {
  if (!CHAIN.includes(op)) return { gap: 'unknown_spec', reason: `no such operator: ${op}`, known: CHAIN };
  if (!GRAINS.includes(grain)) return { gap: 'unknown_spec', reason: `no such grain: ${grain}`, known: GRAINS };
  return BY.get(`${op}|${grain}`);
};
/** a cell by its id ("DEF·Pattern"), or undefined */
export const cellById = (id) => CELLS.find((c) => c.id === id);
