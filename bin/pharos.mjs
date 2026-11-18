#!/usr/bin/env node
// Tiny CLI over lib/pharos.mjs. Prints JSON.
import fs from 'node:fs';
import os from 'node:os';
import * as P from '../lib/pharos.mjs';
import { chatter, readChatter } from '../lib/chatter.mjs';
import path from 'node:path';
import { isDoorCommand, main as doorMain } from '../install/cli.mjs';
import { checkTarget } from '../install/guard.mjs';

const USAGE = `pharos <command> [--name N] [--dir D] [--writer W]
  init                         open (creating the frame if new)
  weave --cell C --kind K --addr A --body JSON [--of id,id] [--basis JSON]
  fold [--cell C] [--kind K] [--addr A]
  status
  merge <otherDir>             union another pharos dir into this one
  install <repoDir>            write pharos.json + holon.json stub
  undo <repoDir>               remove exactly what install wrote
  chatter [--tail N] [--level L] [--where W] [--what X] [--since ISO]   read the debugging trail (not data)
  chatter-write --where W --what X [--level L] [--detail JSON]            write one chatter line (best effort)`;

// --help prints the longer text below on stdout; no-args and unknown commands keep the original short usage (byte-identical to before)
const HELP = `pharos <command> [options]

Door commands (install doors; dry run is the default, nothing changes without --apply):
  doors                                list the doors
  detect <door|all> [--target DIR]     what is present, what is missing; changes nothing
  install <door|all> --target DIR      plan: the exact changes, nothing is written (same as --plan)
  install <door|all> --target DIR --apply   apply the plan
  verify <door|all> [--target DIR]     exit 0 only if every check passes
  status <door|all> [--target DIR]     not-installed | installed | drifted | partial | journal-invalid
  undo-door <door|all> [--target DIR]  undo: restore byte for byte from the journal
  install <door|all> --explain         what the door is allowed to touch
  flags: --plan --apply --json --text --explain --state DIR --keep-journal; heavier steps need their own --with-* flag
  exit: 0 ok, 1 step or verify failed, 2 usage, 3 refused (protected place, symlink escape, forged journal)

Library commands (the shared log):
  init [--dir D] [--writer W] [--name N]   open (creating the frame if new)
  weave --cell C --kind K --addr A --body JSON [--of id,id] [--basis JSON]
  fold [--cell C] [--kind K] [--addr A]
  status                               (no door argument) the log's status
  merge <otherDir>                     union another pharos dir into this one
  install <repoDir>                    legacy: write pharos.json + holon.json stub
  undo <repoDir>                       legacy: remove exactly what install wrote

Chatter (the debugging trail: NOT data, never folded):
  chatter [--tail N] [--level debug|info|warn|error] [--where W] [--what X] [--since ISO]
  chatter-write --where W --what X [--level L] [--detail JSON]

  pharos --help                        this text`;

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  for (const k of ['dir', 'name', 'writer', 'cell', 'kind', 'addr', 'body', 'of', 'basis']) {
    if (flags[k] === true) throw new P.PharosError('USAGE', `--${k} needs a value`);
  }
  return { pos, flags };
}

const json = (s, what) => {
  try { return JSON.parse(s); } catch (err) { throw new P.PharosError('BAD_JSON', `--${what} is not valid JSON`); }
};

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h') || process.argv[2] === 'help') { console.log(HELP); process.exit(0); }

// door commands (install <door|all>, doors, detect, verify, status <door|all>, undo-door) live in install/;
// every other invocation falls through to the legacy commands below, unchanged.
if (await isDoorCommand(process.argv.slice(2))) {
  const code = await doorMain(process.argv.slice(2));
  await new Promise((r) => process.stdout.write('', r)); // let piped output drain before exiting
  process.exit(code);
}

// The legacy install/undo write and delete in the directory they are given, so they pass the same guard as a
// door target first: protected places, the real home, a '..' segment and symlinks are refused (exit 3).
function guardLegacy(dir) {
  try { checkTarget(dir, path.resolve(process.env.HOME || os.homedir()), { noLink: true }); }
  catch (err) { console.error(JSON.stringify({ error: { code: err.code || 'REFUSED', message: err.message } })); process.exit(err.exit || 3); }
}

try {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, arg] = pos;
  const h = () => P.open(flags.name || 'default', { dir: flags.dir, writer: flags.writer || process.env.PHAROS_WRITER || `cli-${os.hostname().split('.')[0]}` });
  let out;
  switch (cmd) {
    case 'init': out = P.status(h()); break;
    case 'weave':
      out = P.weave(h(), {
        cell: flags.cell, kind: flags.kind, addr: flags.addr,
        body: flags.body === undefined ? undefined : json(flags.body, 'body'),
        ...(flags.of ? { of: String(flags.of).split(',').filter(Boolean) } : {}),
        ...(flags.basis ? { basis: json(flags.basis, 'basis') } : {}),
      });
      break;
    case 'fold': out = P.fold(h(), { cell: flags.cell, kind: flags.kind, addr: flags.addr }); break;
    case 'status': out = P.status(h()); break;
    case 'merge':
      if (!arg) throw new P.PharosError('USAGE', 'merge needs the other pharos dir');
      if (!fs.existsSync(arg)) throw new P.PharosError('NO_SOURCE', `${arg} does not exist`);
      out = P.merge(h(), P.open(flags.name || 'default', { dir: arg, writer: 'merge-source', frame: false }));
      break;
    case 'chatter': out = readChatter({ tail: flags.tail, level: flags.level, where: flags.where, what: flags.what, since: flags.since, name: flags.name, dir: flags.dir }); break;
    case 'chatter-write':
      if (!flags.where || !flags.what) throw new P.PharosError('USAGE', 'chatter-write needs --where and --what');
      out = chatter({ level: flags.level, where: flags.where, what: flags.what, detail: flags.detail === undefined ? undefined : json(flags.detail, 'detail') }, { name: flags.name, dir: flags.dir, writer: flags.writer });
      break;
    case 'install': if (!arg) throw new P.PharosError('USAGE', 'install needs a repo dir'); guardLegacy(arg); out = P.install(arg); break;
    case 'undo': if (!arg) throw new P.PharosError('USAGE', 'undo needs a repo dir'); guardLegacy(arg); out = P.undo(arg); break;
    default: console.error(USAGE); process.exit(cmd ? 2 : 0);
  }
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error(JSON.stringify({ error: { code: err.code || 'INTERNAL', message: err.message } }));
  process.exit(1);
}
