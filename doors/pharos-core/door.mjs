// pharos-core: the same two files as the legacy `install <repoDir>`, built by the same library function.
import fs from 'node:fs';
import path from 'node:path';
import { installFiles } from '../../install/legacy.mjs';
import { sha256 } from '../../install/journal.mjs';

const validPointer = (buf) => { try { const p = JSON.parse(buf.toString('utf8')); return p && p.kind === 'pharos-pointer' && p.wrote && typeof p.wrote === 'object'; } catch { return false; } };

export default {
  scope: 'target',
  options: {},
  async detect(ctx) {
    const pj = ctx.readFile(path.join(ctx.target, 'pharos.json'));
    const hj = ctx.exists(path.join(ctx.target, 'holon.json'));
    return { present: !!pj && validPointer(pj), version: 1, missing: pj ? [] : ['pharos.json'], conflicts: pj && !validPointer(pj) ? ['pharos.json exists and is not a pharos pointer'] : [], holon_stub: hj };
  },
  steps: {
    pointer: {
      plan(ctx) {
        const pj = path.join(ctx.target, 'pharos.json'), hj = path.join(ctx.target, 'holon.json');
        const cur = ctx.readFile(pj);
        if (cur) {
          if (validPointer(cur)) return { actions: [], why: 'pharos.json is already a pharos pointer' };
          return { blocked: 'pharos.json exists and is not a pharos pointer; not overwriting' };
        }
        // holon.json left by an interrupted run of this door (journaled, not undone, same bytes) is still ours
        const stubSha = sha256(Buffer.from(JSON.stringify({ name: path.basename(ctx.target), ground: [], figure: [], pattern: [], out: [] }, null, 2) + '\n'));
        let owned = false;
        try { owned = ctx.journal.active().some((x) => x.intent.door === ctx.id && x.intent.op === 'write' && x.intent.path === hj && x.intent.before && !x.intent.before.exists && x.intent.after?.sha256 === stubSha) && ctx.readFile(hj) !== null && sha256(ctx.readFile(hj)) === stubSha; } catch { owned = false; }
        const f = installFiles(ctx.target, { ownedHolon: owned });
        const actions = [];
        if (f.wroteHj) actions.push({ op: 'write', path: hj, content: f.stub });
        actions.push({ op: 'write', path: pj, content: f.pointer });
        return { actions };
      },
    },
  },
};
