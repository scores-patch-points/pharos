// The refactor of khora's install tools (upstream/) as door steps. Every step is declarative: it returns the
// actions it WOULD take, and the runner decides whether to run them (flag gating, dry run, journal, backups).
// What changed against the originals, step by step, is listed in ../DIFF.md.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Usage, Refused } from '../../../install/guard.mjs';
import { StepFailed, which } from '../../../install/runner.mjs';
import { sha256 } from '../../../install/journal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE = JSON.parse(fs.readFileSync(path.join(here, '..', 'upstream', 'SOURCE.json'), 'utf8'));
export const SHA = SOURCE.sha;
const REPO_URL = `https://github.com/${SOURCE.repo}.git`;
export const PORTS = { proxy: 11436, fleet: 11438, upstream: 11434 };
export const DEFAULT_MODELS = ['gemma2:2b', 'smollm2:1.7b', 'qwen2.5-coder:1.5b', 'nomic-embed-text'];
export const DAEMON_ENV = { OLLAMA_KEEP_ALIVE: '1h', OLLAMA_MAX_LOADED_MODELS: '3', OLLAMA_CONTEXT_LENGTH: '8192', OLLAMA_NUM_PARALLEL: '4' };
const UNSUPPORTED = process.platform === 'darwin' ? null : `unsupported platform ${process.platform}: reader-stack is macOS only in v1`;

const isGit = (d) => fs.existsSync(path.join(d, '.git'));
const headOf = (d) => { try { return fs.readFileSync(path.join(d, '.git', 'HEAD'), 'utf8').trim(); } catch { return null; } };
// The commit HEAD points at, read in-process (a branch name is followed through refs/ and packed-refs).
export function resolveHead(d) {
  const h = headOf(d);
  if (!h) return null;
  if (!h.startsWith('ref:')) return h;
  const ref = h.slice(4).trim();
  if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(ref) || ref.split('/').includes('..')) return null;
  try { return fs.readFileSync(path.join(d, '.git', ref), 'utf8').trim(); } catch { /* packed? */ }
  try { for (const l of fs.readFileSync(path.join(d, '.git', 'packed-refs'), 'utf8').split('\n')) { const [sha, name] = l.split(' '); if (name === ref) return sha; } } catch { /* none */ }
  return null;
}
const nonEmpty = (d) => { try { return fs.readdirSync(d).length > 0; } catch { return false; } };
const blocked = (m) => ({ blocked: m });
const gate = (f) => (ctx) => UNSUPPORTED ? blocked(UNSUPPORTED) : f(ctx);

function healthy(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, (r) => { r.resume(); res(r.statusCode >= 200 && r.statusCode < 500); });
    req.on('error', () => res(false)); req.on('timeout', () => { req.destroy(); res(false); });
  });
}
const answers = (port) => healthy(port);
// any listener at all, not only one that answers /health: a port conflict is a conflict either way
const listening = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port, timeout: 1000 }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); }); });
async function poll(port, tries = 20) { for (let i = 0; i < tries; i++) { if (await healthy(port)) return true; await new Promise((r) => setTimeout(r, 500)); } return false; }

// Hash every file SOURCE.json lists inside a checkout (read in-process; no tool, no network).
export function checkSourceTree(dir) {
  const bad = [];
  for (const f of SOURCE.files) {
    let b = null;
    try { b = fs.readFileSync(path.join(dir, f.path)); } catch { /* missing */ }
    if (!b) bad.push(`${f.path}: missing`); else if (sha256(b) !== f.sha256) bad.push(`${f.path}: sha256 differs from SOURCE.json`);
  }
  return bad;
}

// The pin covers what RUNS, not only what was cloned: a step that runs or copies code from the checkout refuses
// unless HEAD is the pinned commit and the listed files hash to SOURCE.json (both read in-process) ...
export function pinProblem(dir) {
  if (!isGit(dir)) return `${dir} is not a git checkout`;
  const head = resolveHead(dir);
  if (head !== SHA) return `${dir} is at ${head || 'an unknown commit'}, not the pinned commit ${SHA}; nothing from it is run (use --with-update, or a fresh --with-clone)`;
  const bad = checkSourceTree(dir);
  if (bad.length) return `${dir} does not match SOURCE.json: ${bad.join('; ')}`;
  return null;
}
// ... and, at apply, unless git reports no change to any tracked file.
const pinPre = (dir) => (ctx) => {
  const p = pinProblem(dir);
  if (p) throw new StepFailed(p);
  const r = ctx.gitStatus(dir);
  if (!r.found || r.code !== 0) throw new StepFailed(`could not check ${dir} with git status (${r.found ? `exit ${r.code}` : 'git not found'}); nothing from it is run`);
  if (String(r.stdout).trim() !== '') throw new StepFailed(`${dir} has changes to tracked files; nothing from it is run`);
};
const PIN_NOTE = 'before this runs, apply checks that the checkout is at the pinned commit, that the listed files hash to SOURCE.json, and (git status) that no tracked file is changed';
// when the checkout is already there and this run does not move it, a wrong commit is known at plan time
const pinBlocked = (ctx, dir) => (ctx.exists(dir) && !ctx.has('--with-update') ? pinProblem(dir) : null);
const NPM_SAFE = (ctx) => (ctx.has('--npm-scripts') ? [] : ['--ignore-scripts']);
const NPM_NOTE = (ctx) => (ctx.has('--npm-scripts') ? 'package lifecycle scripts WILL run (--npm-scripts)' : 'package lifecycle scripts are not run (--ignore-scripts); pass --npm-scripts only if a dependency needs its install script');
const loopback = (u) => { try { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(u).hostname); } catch { return false; } };

export const steps = {
  // Fetch each khora install file read-only at the pinned commit and compare its sha256 to SOURCE.json.
  // The files are not shipped in this tree and nothing is written: only the bytes' hash is kept.
  'verify-source': {
    plan: gate(() => ({
      actions: SOURCE.files.map((f) => ({
        op: 'exec', tool: 'gh', raw: true,
        argv: ['api', `repos/${SOURCE.repo}/contents/${f.path}?ref=${SHA}`, '-H', 'Accept: application/vnd.github.raw'],
        note: `expects sha256 ${f.sha256}`,
        check: (_c, r) => { const got = sha256(r.stdout); if (got !== f.sha256) throw new StepFailed(`${f.path} at ${SHA}: sha256 ${got} differs from SOURCE.json (${f.sha256})`); },
      })),
      notes: ['network: api.github.com (read only); writes nothing; a hash mismatch fails the step', ...(which('gh') ? [] : ['WARNING: gh is not on PATH, so this step will fail at apply; install the GitHub CLI (and sign in if the API asks)'])],
    })),
  },
  'clone-khora': {
    plan: gate((ctx) => {
      const dir = ctx.khoraDir;
      if (ctx.exists(dir)) {
        if (isGit(dir)) return { actions: [], why: `${dir} is already a git checkout (use --with-update to move it to the pinned commit)` };
        return blocked(`${dir} exists and is not a git checkout; not touching it`);
      }
      if (!ctx.exists(path.dirname(dir))) return blocked(`parent directory ${path.dirname(dir)} does not exist`);
      return {
        actions: [
          { op: 'exec', tool: 'git', argv: ['clone', '--no-checkout', REPO_URL, dir], creates: [dir], note: `pinned to ${SHA}, never main` },
          { op: 'exec', tool: 'git', argv: ['-C', dir, 'checkout', '--detach', SHA], check: () => { const bad = checkSourceTree(dir); if (bad.length) throw new StepFailed(`checkout does not match SOURCE.json: ${bad.join('; ')}`); } },
        ],
        notes: [`network: github.com (read)`],
      };
    }),
  },
  'update-khora': {
    plan: gate((ctx) => {
      const dir = ctx.khoraDir;
      if (!ctx.exists(dir) && ctx.has('--with-clone')) return { actions: [], why: 'the clone step in this run already checks out the pinned commit' };
      if (!isGit(dir)) return blocked(`${dir} is not a git checkout`);
      const head = resolveHead(dir);
      if (resolveHead(dir) === SHA) return { actions: [], why: 'checkout is already at the pinned commit' };
      return {
        actions: [
          { op: 'exec', tool: 'git', argv: ['-C', dir, 'fetch', 'origin', SHA] },
          { op: 'exec', tool: 'git', argv: ['-C', dir, 'merge', '--ff-only', SHA], check: () => { const p = pinProblem(dir); if (p) throw new StepFailed(`after the update: ${p}`); }, undoNote: `to look at the commit it was on: git -C ${dir} checkout ${head || '<the previous commit>'} (never run automatically)` },
        ],
      };
    }),
  },
  node: {
    plan: gate((ctx) => {
      if (ctx.which('node')) return { actions: [], why: 'node is on PATH' };
      if (!ctx.which('brew')) return blocked('node is missing and brew is not on PATH; install node from its website');
      return { actions: [{ op: 'exec', tool: 'brew', argv: ['install', 'node'], undoNote: 'to remove: brew uninstall node (never run automatically)' }] };
    }),
  },
  'npm-deps': {
    plan: gate((ctx) => {
      const dir = ctx.khoraDir;
      const cloning = ctx.has('--with-clone') && !ctx.exists(dir);
      if (!cloning) {
        if (!ctx.exists(path.join(dir, 'package.json'))) return blocked(`${dir} has no package.json (clone first)`);
        if (!ctx.exists(path.join(dir, 'package-lock.json'))) return blocked('no package-lock.json: npm ci needs it');
        if (ctx.exists(path.join(dir, 'node_modules'))) return { actions: [], why: 'node_modules is already present' };
        const p = pinBlocked(ctx, dir); if (p) return blocked(p);
      }
      return { actions: [{ op: 'exec', tool: 'npm', argv: ['ci', '--omit=dev', '--no-audit', '--no-fund', ...NPM_SAFE(ctx)], cwd: dir, creates: [path.join(dir, 'node_modules')], pre: pinPre(dir) }], notes: ['network: registry.npmjs.org (read)', NPM_NOTE(ctx), PIN_NOTE] };
    }),
  },
  ollama: {
    plan: gate((ctx) => {
      if (ctx.which('ollama')) return { actions: [], why: 'ollama is on PATH' };
      if (!ctx.which('brew')) return blocked('ollama is missing and brew is not on PATH; pass --with-ollama-vendor-script to fetch the vendor script for review');
      return { actions: [{ op: 'exec', tool: 'brew', argv: ['install', 'ollama'], undoNote: 'to remove: brew uninstall ollama (never run automatically)' }], notes: ['the daemon is not started here: the proxy owns it'] };
    }),
  },
  'ollama-vendor-script': {
    plan: gate((ctx) => {
      const file = path.join(ctx.state, 'downloads', 'ollama-install.sh');
      return {
        actions: [{ op: 'exec', tool: 'curl', argv: ['-fsSL', 'https://ollama.com/install.sh', '-o', file], mkdirs: [path.dirname(file)], creates: [file],
          then: (c) => { const b = c.readFile(file); return b ? `downloaded ${file}; sha256 ${sha256(b)}; review it, this door does not run it` : null; } }],
        notes: ['the script is downloaded for review and never executed by this door (no shell is declared)'],
      };
    }),
  },
  'daemon-env': {
    plan: gate(() => ({
      actions: Object.entries(DAEMON_ENV).map(([name, d]) => ({ op: 'setenv', name, value: process.env[name] || d })),
      notes: ['current values are read with `launchctl getenv` at apply time and journaled; a running Ollama server picks them up only after it restarts'],
    })),
  },
  models: {
    plan: gate((ctx) => {
      const raw = ctx.val('--with-models');
      const list = typeof raw === 'string' && raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_MODELS;
      // a tag starts with a letter or a digit: one that starts with '-' would be read by ollama as an option
      for (const t of list) if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(t)) throw new Usage(`bad model tag ${JSON.stringify(t)}`);
      return {
        actions: list.map((tag) => ({ op: 'exec', tool: 'ollama', argv: ['pull', tag], reverse: { tool: 'ollama', argv: ['rm', tag] },
          skipIf: (c) => { const r = c.probe('ollama', ['list']); return r.found && r.stdout.split('\n').some((l) => l.split(/\s+/)[0] === tag); } })),
        notes: ['network: registry.ollama.ai (read); tags already present are skipped at apply and are not removed by undo'],
      };
    }),
  },
  'npm-link': {
    plan: gate((ctx) => {
      const cli = path.join(ctx.khoraDir, 'cli');
      const cloning = ctx.has('--with-clone') && !ctx.exists(ctx.khoraDir);
      if (!cloning) { const p = pinBlocked(ctx, ctx.khoraDir) || (ctx.exists(ctx.khoraDir) ? null : `${ctx.khoraDir} does not exist (clone first)`); if (p) return blocked(p); }
      return { actions: [{ op: 'exec', tool: 'npm', argv: ['link', ...NPM_SAFE(ctx)], cwd: cli, reverse: { tool: 'npm', argv: ['unlink', '-g'], cwd: cli }, note: 'writes under the global npm prefix (outside the state dir and the checkout)', pre: pinPre(ctx.khoraDir) }], notes: [NPM_NOTE(ctx), PIN_NOTE] };
    }),
  },
  services: {
    plan: gate((ctx) => {
      const dir = ctx.khoraDir;
      const cloning = ctx.has('--with-clone') && !ctx.exists(dir);
      if (!cloning && !(ctx.exists(path.join(dir, 'proxy.mjs')) && ctx.exists(path.join(dir, 'heimdall-fleet.mjs')))) return blocked(`${dir} lacks proxy.mjs or heimdall-fleet.mjs (clone first)`);
      if (!cloning) { const p = pinBlocked(ctx, dir); if (p) return blocked(p); }
      const pin = pinPre(dir);
      const portFree = async (port) => { pin(ctx); if (await listening(port)) throw new StepFailed(`port ${port} already has a listener; refusing to start a second one`); };
      return {
        actions: [
          { op: 'spawn', tool: 'node', argv: ['heimdall-fleet.mjs', '--operator', 'log'], cwd: dir, env: { ER7_EXTERNAL_HEIMDALL: '1' }, log: path.join(ctx.state, 'logs', 'fleet.log'), creates: [path.join(ctx.state, 'logs', 'fleet.log')], pre: () => portFree(PORTS.fleet), ready: async () => { if (!(await poll(PORTS.fleet))) throw new StepFailed(`fleet did not answer /health on :${PORTS.fleet}`); } },
          { op: 'spawn', tool: 'node', argv: ['proxy.mjs'], cwd: dir, env: { ER7_EXTERNAL_HEIMDALL: '1' }, log: path.join(ctx.state, 'logs', 'proxy.log'), creates: [path.join(ctx.state, 'logs', 'proxy.log')], pre: () => portFree(PORTS.proxy), ready: async () => { if (!(await poll(PORTS.proxy))) throw new StepFailed(`proxy did not answer /health on :${PORTS.proxy}`); } },
        ],
        notes: [`ports ${PORTS.fleet} and ${PORTS.proxy}; logs in the state dir, not in the khora folder; readiness is polled with a bound, never a sleep`, 'the credential scrape of local-up.sh is dropped', PIN_NOTE],
      };
    }),
  },
  'opencode-config': {
    plan: gate((ctx) => {
      const given = ctx.vals('--opencode-config');
      if (!given.length) throw new Usage('--with-opencode needs --opencode-config <path> (repeatable); no directory is scanned');
      const actions = [], notes = [];
      for (const g of given) {
        if (typeof g !== 'string' || g.split(/[\\/]+/).includes('..')) throw new Refused(`--opencode-config contains a '..' segment: ${g}`);
        const abs = path.resolve(g);
        if (!/opencode\.jsonc?$/.test(abs)) throw new Refused(`${abs} is not an opencode.json or opencode.jsonc`);
        if (!ctx.declared(abs)) throw new Refused(`${abs} is outside the declared places for opencode configs (~/.config/opencode/ or the target)`);
        const cur = ctx.readFile(abs);
        let data = {};
        if (cur) { try { data = JSON.parse(cur.toString('utf8')); } catch { notes.push(`skipped ${abs}: not strict JSON (comments?); not counted as updated`); continue; } }
        const before = JSON.stringify(data);
        const port = PORTS.proxy;
        data.$schema = data.$schema ?? 'https://opencode.ai/config.json';
        data.provider = data.provider ?? {};
        const fold = data.provider.fold ?? {};
        fold.name = 'The Fold';
        fold.npm = fold.npm ?? '@ai-sdk/openai-compatible';
        fold.options = fold.options ?? {};
        fold.options.baseURL = `http://127.0.0.1:${port}/v1`;
        fold.models = fold.models ?? {};
        fold.models['fold:gemma2:2b'] = { name: 'The Fold · Gemma 2 2B (grounded, local)', tool_call: false };
        fold.models['fold:qwen2.5-coder:1.5b'] = { name: 'The Fold · Qwen2.5 Coder 1.5B (grounded, local)', tool_call: false };
        data.provider.fold = fold;
        if (cur && JSON.stringify(data) === before) continue; // already wired: do not even reformat
        actions.push({ op: 'write', path: abs, content: JSON.stringify(data, null, 2) + '\n', note: cur ? 'merges provider.fold' : 'creates the file' });
      }
      return { actions, notes };
    }),
  },
  'opencode-plugin': {
    plan: gate((ctx) => {
      const src = path.join(ctx.khoraDir, 'opencode', 'er7-session.mjs');
      const dest = path.join(ctx.home, '.config', 'opencode', 'plugin', 'er7-session.mjs');
      const cloning = ctx.has('--with-clone') && !ctx.exists(ctx.khoraDir);
      if (!cloning) { const p = pinBlocked(ctx, ctx.khoraDir); if (p) return blocked(p); }
      // the bytes are taken at plan time only from a checkout that already passes the pin; otherwise they are read at apply, after the check
      const have = ctx.exists(ctx.khoraDir) && !pinProblem(ctx.khoraDir) ? ctx.readFile(src) : null;
      const content = have ? have : () => { const b = ctx.readFile(src); if (!b) throw new StepFailed(`${src} is missing`); return b; };
      return { actions: [{ op: 'write', path: dest, content, pre: pinPre(ctx.khoraDir), note: have ? `copy of ${src}` : `source not present yet or not yet at the pinned commit (${src}); read at apply` }], notes: [PIN_NOTE] };
    }),
  },
  'claude-plugin': {
    plan: gate((ctx) => {
      const src = ctx.val('--plugin-source');
      if (!src || src === true) throw new Usage('--with-claude-plugin needs --plugin-source <owner/repo@commit>; there is no default');
      // a full commit id is required: a bare owner/repo or a short id would follow whatever the branch becomes
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*@[0-9a-f]{40}$/.test(src)) throw new Usage(`bad --plugin-source ${JSON.stringify(src)}: it must be owner/repo@<40-hex commit>`);
      if (process.env.ER7_URL && !loopback(process.env.ER7_URL)) return blocked('ER7_URL points off this machine: the plugin would send every hook event (prompts, tool inputs, file contents) there; unset ER7_URL or point it at 127.0.0.1');
      if (!ctx.which('claude')) return blocked('claude is not on PATH');
      return {
        actions: [
          { op: 'exec', tool: 'claude', argv: ['plugin', 'marketplace', 'add', src, '--sparse', '.claude-plugin', 'claude-code'], reverse: { tool: 'claude', argv: ['plugin', 'marketplace', 'remove', 'eoreader7'] } },
          { op: 'exec', tool: 'claude', argv: ['plugin', 'install', 'eo-reason@eoreader7'], reverse: { tool: 'claude', argv: ['plugin', 'uninstall', 'eo-reason@eoreader7'] } },
        ],
        notes: ['the plugin forwards the full content of every Claude Code hook event (tool inputs, prompts, file contents) to ER7_URL, default http://127.0.0.1:11436; if ER7_URL points off this machine that data leaves it'],
      };
    }),
  },
};

export { which, answers };
