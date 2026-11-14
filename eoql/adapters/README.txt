The adapters live in ../src/adapters/ (SPEC 7.5 layout: src/adapters/*.mjs; node:sqlite is allowed there):
  lib.mjs      lib:<dir>, jsonl:<file>, mem:   (LibSource, MemSource)
  lazy.mjs     lazy:<root>                      (region reads through the vendored placed API)
  blocks.mjs   blocks:<dir>                     (own layout BLOCKS.jsonl, see BUILD_NOTES.md: NOT verified against pharos-blocks)
  sqlite.mjs   sqlite:<file> source, and the projection writer used by `convert ... sqlite:`
  sqlrel.mjs   sqlrel:<file>                    (SPEC-A1 3.3 fixture source: plain SQLite tables, read-only, no log)
This folder is intentionally empty of code.
