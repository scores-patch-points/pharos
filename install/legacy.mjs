// The bytes the legacy `install <repoDir>` writes, computed without writing them. lib/pharos.mjs is
// left byte-identical to its pre-installer form (the pointer records its sha256), so this mirrors
// install() there; test/install-core-parity.test.mjs asserts the two cannot diverge. One deliberate difference:
// the pointer's `lib` is the library path RELATIVE to the target, so pharos.json carries no absolute home path.
// (The legacy `install <repoDir>` still writes the absolute path; changing lib/pharos.mjs would change its sha256.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PharosError, libHash } from '../lib/pharos.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const present = (p) => fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
const LIB = fileURLToPath(new URL('../lib/pharos.mjs', import.meta.url));

// ownedHolon: holon.json is already here and an interrupted run of this installer wrote it, so the pointer still records it
export function installFiles(dir, { ownedHolon = false } = {}) {
  const target = path.resolve(dir);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new PharosError('NO_TARGET', `${target} is not a directory`);
  const pj = path.join(target, 'pharos.json'), hj = path.join(target, 'holon.json');
  if (present(pj)) throw new PharosError('ALREADY_INSTALLED', 'pharos.json already exists');
  const written = {}, skipped = [];
  const stub = JSON.stringify({ name: path.basename(target), ground: [], figure: [], pattern: [], out: [] }, null, 2) + '\n';
  const wroteHj = !present(hj);
  if (wroteHj || ownedHolon) written['holon.json'] = sha(stub); else skipped.push('holon.json');
  const pointer = JSON.stringify({ v: 1, kind: 'pharos-pointer', lib: path.relative(fs.realpathSync(target), fs.realpathSync(LIB)), sha256: libHash(), wrote: written }, null, 2) + '\n';
  return { target, pj, hj, stub, wroteHj, pointer, written, skipped };
}
