// The door's file computation (install/legacy.mjs) must produce exactly what the legacy install() writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install } from '../lib/pharos.mjs';
import { installFiles } from '../install/legacy.mjs';

test('installFiles mirrors legacy install()', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-parity-'));
  try {
    const f = installFiles(d);
    install(d);
    // identical except `lib`: the door writes it relative to the target (no absolute home path), the legacy command absolute
    const legacy = JSON.parse(fs.readFileSync(path.join(d, 'pharos.json'), 'utf8'));
    const door = JSON.parse(f.pointer);
    assert.ok(!path.isAbsolute(door.lib), 'door pointer lib must not be absolute');
    assert.equal(path.resolve(fs.realpathSync(d), door.lib), legacy.lib);
    assert.deepEqual({ ...door, lib: null }, { ...legacy, lib: null });
    assert.equal(fs.readFileSync(path.join(d, 'holon.json'), 'utf8'), f.stub);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
