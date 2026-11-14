// Recording, fail-closed stand-in for external tools. Invoked as: node a_shim.mjs <tool> <argv...>
// from a one-line sh wrapper named like the tool. Never executes the real tool.
import fs from 'node:fs';
import path from 'node:path';
import { classify, isVersionForm } from './a_shimlib.mjs';

const [tool, ...argv] = process.argv.slice(2);
const logPath = process.env.A_SHIM_LOG;
const stateDir = process.env.A_SHIM_STATE;
const cls = classify(tool, argv);
let code = 0;
let out = '';
let err = '';
let note = '';

const dbPath = stateDir ? path.join(stateDir, 'launchctl.json') : null;
const readDb = () => { try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return {}; } };

if (cls === 'read') {
  if (isVersionForm(argv)) out = `${tool} 0.0.0-shim\n`;
  else if (tool === 'lsof') code = 1;
  else if (tool === 'git' && ['rev-parse', 'status', 'log', 'describe'].includes(argv[0])) { code = 128; err = 'fatal: not a git repository\n'; }
  else if (tool === 'launchctl' && argv[0] === 'getenv') { const v = readDb()[argv[1]]; out = v === undefined ? '' : v + '\n'; note = 'emulated'; }
  else if (tool === 'ollama' && argv[0] === 'list') out = 'NAME\tID\tSIZE\tMODIFIED\n';
} else if (tool === 'launchctl' && dbPath && (argv[0] === 'setenv' || argv[0] === 'unsetenv') && argv[1]) {
  const db = readDb();
  if (argv[0] === 'setenv') db[argv[1]] = argv[2] ?? ''; else delete db[argv[1]];
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  note = 'emulated';
} else {
  code = 97;
  err = `SHIM BLOCKED: ${tool} ${argv.join(' ')} (recorded, not executed)\n`;
}

if (logPath) {
  try {
    fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), tool, argv, cwd: process.cwd(), cls, code, note, ppid: process.ppid }) + '\n');
  } catch { /* the log is outside the jail; if it cannot be written the call still fails closed below */ code = code || 98; }
}
process.stdout.write(out);
process.stderr.write(err);
process.exit(code);
