// agents-md: one marked block, written once, removed exactly.
import path from 'node:path';

const ID = 'agents-md';
const BEGIN = `<!-- pharos:begin ${ID} v1 -->`;
const END = `<!-- pharos:end ${ID} -->`;
export const BLOCK = `${BEGIN}
## pharos (shared log)

This repo is wired to pharos, the one shared log. \`pharos.json\` in this directory points at the library.

- Ask the log, do not read its files: \`node <pharos>/bin/pharos.mjs fold --dir <pharos dir>\`.
- Record a step as an entry with \`weave\`; never edit the log by hand.
- Never edit \`.pharos/\` (the installer's journal). To remove this wiring: \`node <pharos>/bin/pharos.mjs undo-door all --target <this dir>\`.
${END}
`;

const FILES = ['AGENTS.md', 'CLAUDE.md'];
const region = (text) => { const b = text.indexOf(`<!-- pharos:begin ${ID}`); if (b < 0) return null; const e = text.indexOf(END, b); if (e < 0) return null; return [b, e + END.length + (text[e + END.length] === '\n' ? 1 : 0)]; };

export default {
  scope: 'target',
  options: { '--file': { value: true } },
  async detect(ctx) {
    const found = FILES.filter((f) => (ctx.readFile(path.join(ctx.target, f))?.toString('utf8') || '').includes(`pharos:begin ${ID}`));
    return { present: found.length > 0, version: 1, missing: found.length ? [] : ['marked block'], conflicts: [], files: found };
  },
  async verify(ctx) {
    const found = FILES.filter((f) => { const t = ctx.readFile(path.join(ctx.target, f))?.toString('utf8') || ''; return t.includes(`<!-- pharos:begin ${ID}`) && t.includes(END); });
    return [{ id: 'block-present', ok: found.length > 0, detail: found.length ? found.join(', ') : 'no pharos block in AGENTS.md or CLAUDE.md' }];
  },
  steps: {
    block: {
      plan(ctx) {
        const name = ctx.val('--file') || 'AGENTS.md';
        if (!FILES.includes(name)) throw Object.assign(new Error(`--file must be AGENTS.md or CLAUDE.md, got ${name}`), { code: 'USAGE', exit: 2 });
        const abs = path.join(ctx.target, name);
        const cur = ctx.readFile(abs);
        const old = cur ? cur.toString('utf8') : '';
        if (cur && old.includes(BLOCK)) return { actions: [], why: `${name} already has the current block` };
        const r = region(old);
        if (r) return { actions: [{ op: 'write', path: abs, content: old.slice(0, r[0]) + BLOCK + old.slice(r[1]), note: 'refreshes an older pharos block in place', block: { inserted: BLOCK, replaced: old.slice(r[0], r[1]) } }] };
        const prefix = old === '' ? '' : old.endsWith('\n') ? '\n' : '\n\n';
        return { actions: [{ op: 'write', path: abs, content: old + prefix + BLOCK, block: { inserted: prefix + BLOCK } }] };
      },
    },
  },
};
