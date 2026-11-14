// vendor.mjs: loads the vendored frozen library and the placed API ONLY after their sha256 pins match.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EoqlError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VENDOR_DIR = path.join(HERE, '..', 'vendor');
export const PINS = {
  'cells.json': 'a8eb76c95b47ee130a0d75ddfa76eec3fbf5841c3a626d36779d3c7bd6607c44',
  'lib/pharos.mjs': 'e869302bbaafd31cde17ceced135be6188f6ec92bab00c6f9ba446fc7b7c3e16',
  'placed/cells.json': 'a8eb76c95b47ee130a0d75ddfa76eec3fbf5841c3a626d36779d3c7bd6607c44',
  'placed/core.mjs': '986ec7080fcf5f70ed8e5f7891e2ba3cec71b221b67b53411efff9aa8918e009',
  'placed/placed.mjs': '1a19e43697745641ec66ee75970a8144b9d2b3830a0165edccc9287e6eac0ebc',
  'placed/placement.mjs': '1c0d9d210967f9cff75c73bb01ab81b429f0c20076b9ab42091c684e00f570d5',
  'placed/reader.mjs': 'b26b533ed4d391964c9efc72d870bb4708c4f84f89c3a220ec9e164aed00bfb2',
  'placed/region.mjs': 'b8de9e10fa25e5a649f863743ff0404375e6ef0cc220f111c97f44f395906e04',
};
for (const [f, h] of Object.entries(PINS)) {
  const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(VENDOR_DIR, f))).digest('hex');
  if (got !== h) throw new EoqlError('E_SOURCE', `vendored file ${f} does not match its pin`, { detail: { expected: h, got } });
}
export const lib = await import(pathToFileURL(path.join(VENDOR_DIR, 'lib/pharos.mjs')).href);
export const placed = await import(pathToFileURL(path.join(VENDOR_DIR, 'placed/placed.mjs')).href);
export const placedCore = await import(pathToFileURL(path.join(VENDOR_DIR, 'placed/core.mjs')).href);
export const CELLS = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'cells.json'), 'utf8'));
export const CELL_RANK = new Map(CELLS.cells.map((c) => [c.id, c.rank]));
export const CELL_OP = new Map(CELLS.cells.map((c) => [c.id, c.op]));
export const CELL_GRAIN = new Map(CELLS.cells.map((c) => [c.id, c.grain]));
export const BOOT = { frame: 'NUL·Ground', kind: 'DEF·Figure', holon: 'DEF·Pattern', retract: 'NUL·Figure' };
