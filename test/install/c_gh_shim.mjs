// Test author C: a `gh` stand-in. Serves the khora files from a fixture dir (<dir>/<sha>/<path>) for
// `gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>` (raw bytes when the Accept header asks for raw, else the JSON
// contents form), logs every call to C_GH_LOG, and never touches the network. env C_GH_MODE:
//   good | flip:<path> (one byte of that file flipped) | missing:<path> (404) | empty:<path> | fail (every call exits 1)
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const log = process.env.C_GH_LOG;
const mode = process.env.C_GH_MODE || 'good';
const rec = (o) => { if (log) fs.appendFileSync(log, JSON.stringify({ argv, ...o }) + '\n'); };
const m = argv.map((a) => /^repos\/([^/]+\/[^/]+)\/contents\/(.+?)\?ref=([0-9a-f]{40})$/.exec(a)).find(Boolean);
if (argv[0] === '--version' || argv[0] === 'auth') { rec({ kind: 'probe' }); console.log('gh version 0.0.0 (shim)'); process.exit(0); }
if (argv[0] !== 'api' || !m || mode === 'fail') { rec({ kind: 'refused', mode }); process.stderr.write('gh shim: no\n'); process.exit(1); }
const [, repo, rawPath, sha] = m;
const p = decodeURIComponent(rawPath);
rec({ kind: 'api', repo, path: p, sha, mode });
if (mode === `missing:${p}`) { process.stderr.write('gh: Not Found (HTTP 404)\n'); process.exit(1); }
let buf;
try { buf = fs.readFileSync(path.join(process.env.C_GH_FIX, sha, p)); } catch { process.stderr.write('gh shim: no fixture\n'); process.exit(1); }
if (mode === `empty:${p}`) buf = Buffer.alloc(0);
if (mode === `flip:${p}`) { buf = Buffer.from(buf); buf[Math.floor(buf.length / 2)] ^= 1; }
const raw = argv.some((a) => /application\/vnd\.github\.raw/i.test(a));
if (raw) process.stdout.write(buf);
else process.stdout.write(JSON.stringify({ name: path.basename(p), path: p, sha, encoding: 'base64', content: buf.toString('base64') }));
process.exit(0);
