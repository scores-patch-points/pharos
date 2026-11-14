// reader-stack: see steps/index.mjs. The originals are not in this tree: upstream/SOURCE.json pins their commit and hashes.
import fs from 'node:fs';
import path from 'node:path';
import { steps, SHA, PORTS, DAEMON_ENV, answers, resolveHead } from './steps/index.mjs';


export default {
  scope: 'home',
  checkoutDir: 'khora', // default folder name under HOME when --khora-dir is not given
  options: { '--opencode-config': { value: true, repeat: true }, '--plugin-source': { value: true }, '--npm-scripts': {} },
  steps,
  async detect(ctx) {
    const tools = {};
    for (const t of ctx.manifest.requires.tools) tools[t] = !!ctx.which(t);
    const dir = ctx.khoraDir, head = resolveHead(dir);
    const missing = ['git', 'node', 'npm'].filter((t) => !tools[t]);
    return { present: !!head, version: head === SHA ? SHA : null, pinned: SHA, platform: process.platform, tools, khora_dir: dir, khora_head: head, missing, conflicts: process.platform === 'darwin' ? [] : [`unsupported platform ${process.platform}`] };
  },
  async verify(ctx) {
    const applied = new Set(ctx.journal.active().filter((x) => x.done && x.intent.door === ctx.id).map((x) => x.intent.step));
    // soft checks look at effects of external tools (brew, npm, launchctl, ollama, git): right after apply they only warn,
    // because the tool's own exit code already answered; an explicit `verify` counts them. Hard checks are files this door wrote.
    const out = [];
    const add = (id, ok, detail, soft = false) => out.push({ id, ok, detail, ...(soft ? { soft: true } : {}) });
    const dir = ctx.khoraDir;
    if (applied.has('clone-khora') || applied.has('update-khora')) add('khora-at-pinned-commit', resolveHead(dir) === SHA, `${dir}: ${resolveHead(dir)}`, true);
    if (applied.has('node')) add('node-on-path', !!ctx.which('node'), 'node', true);
    if (applied.has('npm-deps')) add('node-modules', ctx.exists(path.join(dir, 'node_modules')), path.join(dir, 'node_modules'), true);
    if (applied.has('ollama')) add('ollama-on-path', !!ctx.which('ollama'), 'ollama', true);
    if (applied.has('daemon-env')) for (const [n, d] of Object.entries(DAEMON_ENV)) { const r = ctx.probe('launchctl', ['getenv', n]); add(`env-${n}`, r.found && r.stdout.trim() === (process.env[n] || d), n, true); }
    if (applied.has('models')) { const r = ctx.probe('ollama', ['list']); const want = ctx.journal.active().filter((x) => x.intent.door === ctx.id && x.intent.step === 'models').map((x) => x.intent.argv[1]); for (const t of want) add(`model-${t}`, r.found && r.stdout.split('\n').some((l) => l.split(/\s+/)[0] === t), t, true); }
    if (applied.has('npm-link')) add('er7-proxy-on-path', !!ctx.which('er7-proxy'), 'er7-proxy', true);
    if (applied.has('services')) { add('proxy-answers', await answers(PORTS.proxy), `127.0.0.1:${PORTS.proxy}`, true); add('fleet-answers', await answers(PORTS.fleet), `127.0.0.1:${PORTS.fleet}`, true); }
    if (applied.has('opencode-config')) for (const x of ctx.journal.active().filter((y) => y.intent.door === ctx.id && y.intent.step === 'opencode-config' && y.intent.op === 'write')) { let ok = false; try { ok = !!JSON.parse(fs.readFileSync(x.intent.path, 'utf8')).provider?.fold; } catch { /* not ok */ } add(`opencode-${path.basename(x.intent.path)}`, ok, x.intent.path); }
    if (applied.has('opencode-plugin')) add('opencode-plugin', ctx.exists(path.join(ctx.home, '.config', 'opencode', 'plugin', 'er7-session.mjs')), 'er7-session.mjs');
    if (applied.has('claude-plugin')) add('claude-plugin', true, 'not verifiable by a detect-class call; run: claude plugin list');
    if (!out.length) add('nothing-applied', true, 'no reader-stack step is applied; nothing to verify');
    return out;
  },
};
