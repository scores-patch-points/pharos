// source-open.mjs: source names `<scheme>:<locator>` (SPEC 7.2).
import fs from 'node:fs';
import path from 'node:path';
import { EoqlError } from './errors.mjs';
import { LibSource } from './adapters/lib.mjs';
import { LazySource } from './adapters/lazy.mjs';
import { BlocksSource } from './adapters/blocks.mjs';
import { SqliteSource } from './adapters/sqlite.mjs';
import { SqlrelSource } from './adapters/sqlrel.mjs';

export function splitUri(uri) {
  if (typeof uri !== 'string') throw new EoqlError('E_SOURCE', 'a source name must be a string');
  const i = uri.indexOf(':');
  if (i <= 0) throw new EoqlError('E_SOURCE', `source name needs a scheme: ${uri}`, { detail: { schemes: ['lib', 'jsonl', 'lazy', 'blocks', 'sqlite', 'sqlrel'] } });
  return { scheme: uri.slice(0, i), locator: uri.slice(i + 1) };
}
export function openSource(uri, opts = {}) {
  const { scheme, locator } = splitUri(uri);
  const create = opts.mode === 'write';
  switch (scheme) {
    case 'lib':
      if (create && !fs.existsSync(locator)) fs.mkdirSync(locator, { recursive: true });
      return new LibSource(uri, locator, false);
    case 'jsonl': return new LibSource(uri, locator, true);
    case 'lazy':
      if (create && !fs.existsSync(path.join(locator, 'PLACEMENT.json'))) { /* created by the first placed.weave via openRoot */ fs.mkdirSync(locator, { recursive: true }); fs.writeFileSync(path.join(locator, 'PLACEMENT.json'), JSON.stringify({ v: 1, splitLimit: 65536 }, null, 2) + '\n', { flag: 'wx' }); }
      return new LazySource(uri, locator);
    case 'blocks': return new BlocksSource(uri, locator);
    case 'sqlite': return new SqliteSource(uri, locator);
    case 'sqlrel': return new SqlrelSource(uri, locator);
    case 'mem': throw new EoqlError('E_SOURCE', 'mem: sources are library-only (use openEntries)');
    default: throw new EoqlError('E_SOURCE', `unknown source scheme ${scheme}`, { detail: { schemes: ['lib', 'jsonl', 'lazy', 'blocks', 'sqlite', 'sqlrel'] } });
  }
}
