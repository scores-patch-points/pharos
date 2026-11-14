import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint } from '../tools/ignorance.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'ignorance.mjs');

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-lint-'));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

const SIBLINGS = {
  'a.mjs': "import { x } from '../alpha/lib/x.mjs';\n",
  'b.cjs': "const b = require('beta');\n",
  'c.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('gamma', ['--go']);\nconst u = 'https://example.com/org/delta/raw/main/x';\n",
  'run.sh': '#!/bin/sh\nepsilon --all\n',
  'package.json': '{"dependencies":{"zeta":"^1.0.0"}}\n',
};

test('lint finds reaches into rostered siblings, by import, path, cli, url and dependency', () => {
  const dir = repo(SIBLINGS);
  const r = lint(dir, { roster: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'] });
  assert.equal(r.ignorant, false);
  const byName = Object.fromEntries(r.findings.map((f) => [f.name, f.kind]));
  assert.deepEqual(byName, { alpha: 'import', beta: 'import', gamma: 'cli', delta: 'url', epsilon: 'cli', zeta: 'dependency' });
  assert.ok(r.findings.every((f) => f.line >= 1 && f.file));
});

test('lint ignores a pharos import and names that are not on the roster', () => {
  const dir = repo({
    'a.mjs': "import { weave } from '../pharos/lib/pharos.mjs';\nimport p from 'pharos';\nconst q = require('./pharos.json');\n",
    'b.mjs': "import { x } from '../alpha-extra/x.mjs';\nimport { y } from './local.mjs';\n",
  });
  assert.equal(lint(dir, { roster: ['alpha', 'beta'] }).ignorant, true, 'alpha-extra is not alpha');
  assert.equal(lint(dir, { roster: ['pharos', 'beta'] }).ignorant, true, 'pharos is never a sibling, even if rostered');
});

test('lint CLI: log-only exits 0, --enforce exits 1, roster is required and can be a file', () => {
  const dir = repo({ 'a.mjs': "import x from '../alpha/x.mjs';\n" });
  const run = (...args) => spawnSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });
  let r = run('--roster', 'alpha');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'log-only');
  assert.equal(out.findings.length, 1);
  assert.match(r.stderr, /NOT ignorant/);
  assert.equal(run('--roster', 'alpha', '--enforce').status, 1);
  assert.equal(run('--roster', 'beta', '--enforce').status, 0);
  assert.equal(run().status, 2, 'no roster, no run');
  const rf = path.join(dir, '..', path.basename(dir) + '-roster.txt');
  fs.writeFileSync(rf, '# siblings\nalpha\n');
  r = run('--roster-file', rf, '--enforce');
  assert.equal(r.status, 1);
  fs.writeFileSync(rf, JSON.stringify(['alpha']));
  assert.equal(run('--roster-file', rf, '--enforce').status, 1);
  fs.unlinkSync(rf);
});

test('lint finds unquoted shell and yaml reaches and extensionless build files', () => {
  const dir = repo({
    'a.sh': 'node ../khora/bin/x.mjs\ncd ~/code/khora && make\nsource ../khora/env.sh\n  cd khora\n',
    'ci.yml': 'path: ../khora\nrun: khora build\n',
    'Dockerfile': 'COPY ../khora /k\n',
    'Makefile': 'all:\n\t./khora/run.sh\n',
    'ok.sh': 'echo hello world\nnode ./bin/pharos.mjs\n',
  });
  const r = lint(dir, { roster: ['khora'] });
  const by = (f) => r.findings.filter((x) => x.file === f).map((x) => x.line).sort();
  assert.deepEqual(by('a.sh'), [1, 2, 3, 4]);
  assert.deepEqual(by('ci.yml'), [1, 2]);
  assert.deepEqual(by('Dockerfile'), [1]);
  assert.deepEqual(by('Makefile'), [2]);
  assert.deepEqual(by('ok.sh'), []);
});

// Amendment A2, ruling (b): doors/ is exempt (a door by definition names the repo it installs into), and log/ is
// not part of the release. Before A2 this assertion had no exemption and failed on the reader-stack door.
test('pharos itself is ignorant of its siblings (doors/ exempt, stated in the call)', () => {
  const root = path.join(path.dirname(TOOL), '..');
  const r = lint(root, { roster: ['khora', 'eoreader7', 'sibling-a', 'hyphae', 'the-fold'], self: 'x', exempt: ['doors', 'log'] });
  assert.deepEqual(r.exempt, ['doors', 'log']);
  assert.deepEqual(r.findings.filter((f) => !f.file.startsWith('test')), []); // tests name siblings as fixtures
});

test('the exemption is exact: an exempt folder is skipped, a folder that only starts with its name is not', () => {
  const dir = repo({ 'doors/d/door.mjs': "const u = '../alpha/x';\n", 'doors-extra/a.mjs': "const u = '../alpha/x';\n", 'src/a.mjs': "const u = '../alpha/x';\n" });
  const files = (ex) => lint(dir, { roster: ['alpha'], exempt: ex }).findings.map((f) => f.file).sort();
  assert.deepEqual(files([]), ['doors-extra/a.mjs', 'doors/d/door.mjs', 'src/a.mjs']);
  assert.deepEqual(files(['doors']), ['doors-extra/a.mjs', 'src/a.mjs']);
});
