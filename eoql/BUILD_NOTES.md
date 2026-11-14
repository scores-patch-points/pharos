# BUILD_NOTES (builder B, round 2: continuation of the interrupted build)

Written 2026-11-13. Obeys PREREG.md, PREREG-A1.md, SPEC.md, SPEC-A1.md (all stamped, none edited). Nothing here is a result of the PREREG tests; those belong to T, QA, SQLA, EQA. Every number below is a count of something I ran or read; there are no wall-clock claims.

## 0. How I started

The earlier attempt left `src/` (4,782 lines: lexer, parser, printer, evaluator, world/fold, catalog, write path, views, lib/lazy/blocks/sqlite adapters, csv and SQL-dump readers) and `vendor/` (pinned copies, checked by `src/vendor.mjs` before import), with no `bin/`, no `test-builder/`, no `BUILD_NOTES.md`, and `src/sql/` empty. I kept what worked (I re-tested it, section 5) and built the rest. I did not read `qa/ground-truth.json`, `qa/truth.mjs`, `qa/questions.json`, `answers/`, `pharos/log`, any other ledger except the read-only pharos-lazy files named in the task, and I did not run T's tests in `test/` (they may touch sealed material). I did see the names of the files in `test/` and the first lines of `test/lib/common.mjs` while listing; I did not use them. One incident: a mistaken `cat > /tmp/x.mjs` created an empty `/tmp/x.mjs` outside the ledger; I deleted it.

## 1. Layout

```
bin/eoql.mjs                 CLI (10 commands: run explain export import serve dump view sql parse compile)
src/index.mjs                library surface (SPEC 7.1 + A1 3.3)
src/{lex,parse,print}.mjs    hand-written, bounded parser and canonical printer
src/{eval,term,rel,val,con,world,fold,catalog,schema,envelope,analyze}.mjs   evaluator as a fold over a source interface
src/write.mjs                WRITE statements, retraction, views, verbatim merge
src/serve.mjs                read-only HTTP server, 127.0.0.1
src/adapters/                lib, lazy, blocks, sqlite (+ projection writer), sqlrel   (the top-level adapters/ holds only a README)
src/formats/                 core (inventories, measured manifest), eot, dump, csvlib, sqlread, index (9 decoders, 9 encoders, convert, import, dump, replay)
src/sql/                     parse (SQL), translate (SQL to EOQL), compile (EOQL to SQL, 5 dialects), dialects (data), v1 (T-V1AST bridge)
vendor/                      pinned copies, unchanged (VENDOR.sha256 verified OK this round)
test-builder/                my own unit tests (node:test), fixtures, SQL corpus
```

Core code is Node built-ins only. `node:sqlite` appears only in `src/adapters/sqlite.mjs`, `src/adapters/sqlrel.mjs` and my tests. The frozen library is used at runtime only through the pinned vendor copy (for `weave` on `lib:`; placed `weave`/`Bulk` on `lazy:`); the fold itself is my own implementation, and my tests compare its causal order and retracted set with the frozen library's on the planted log (both agree).

## 2. Implemented (what the task listed)

* parser (hand-written, depth and step budgets, 100,000 random token strings: 5,407 parsed, 94,593 typed errors, 0 untyped, one-off run, not in the suite); canonical printer; `E.compose`.
* evaluator as a fold: held sets with survivor counts, causal order, as-of, counterfactual (`SEG drop`, non-mutating), perceiver windows (`writers`, `horizon` idref and writer, `asof`), ancestry with conflict labels (`CON follow`, `_branch`, `_fork`, `_episode`, `_siblings`, `concurrent`), incomplete-range evidence, `NUL expect/gaps`, genesis `INS(X)`, `explain` with `entries_read`, `bytes_read`, `records_read`, plan with `access.method` (region/scan/table), cost budget with typed `E_BUDGET`.
* write mode via weave on `lib:` and `lazy:`, verbatim merge on `blocks:`, `E_NOT_PRIMARY` on `sqlite:`; read-only default; plan-time `E_READONLY`; retraction; views as expression events (exact body keys, `E_VIEW_BODY`); labels.
* nine formats, all 81 ordered pairs of default profiles, with a loss manifest that is the diff of two measurements (decode of the input, decode of the re-read output); `E_LOSSY` before the target exists; `E_NOT_REPRESENTABLE` for extra fields; foreign CSV/JSON/SQL import with mandatory `basis`; dump (verbatim, semantic) and chunked replay.
* SQL to EOQL translator for the declared subset (31 corpus constructs of A1 2.2), with named gaps, positions, `accepted_spellings` (T-SPELL), `:param` placeholders, `E_PARSE` with offset.
* EOQL to SQL compiler for sqlite, postgres, mysql, sqlserver, oracle (v1 layout, one clause per line), typed `not_compilable` reasons in the two classes (the 16 ids of A1 4.2), `E.dialects()` as data, `E_TARGET_UNIMPLEMENTED` for mongodb and pandas.
* optional tier T-V1AST (`E.fromV1`, `parse --from v1ast`): v1 `toAST()` JSON assembled into one query and translated through the SQL translator (the mapping is the table of A1 2.2).
* `sqlrel:` fixture source; `E.sqlCatalog`; read-only HTTP server; CLI.

## 3. Not implemented (stated, not hidden)

* SQL write-through (SPEC 8.4): not built. `INSERT` is gap `SQL_INSERT_SHAPE`, `DELETE` is `SQL_WRITE_NOT_BUILT` (builder-added), `UPDATE` is `SQL_UPDATE`. The report should say "SQL write-through not built".
* Execution of any non-SQLite dialect; MongoDB and Pandas (declared future targets).
* `DISTINCT ON` landing (gap `SQL_DISTINCT_ON`, as A1 allows).
* I did not run v1's modules, so V3 (text equivalence against v1's own compiler output) was not performed by me. My compiler follows v1's layout as I read it; differences to v1's text beyond the intended ones CD1..CD16 are unaudited.
* No claim for the blocks store layout of `pharos-blocks` (section 4, item 2) and none for `pharos-sql regen` or its `canon` hash (item 3).

## 4. Deviations from, and ambiguities in, SPEC.md and SPEC-A1.md (SPEC.md untouched)

1. **E_LOSSY "before writing" versus a measured manifest (SPEC 6.1).** The manifest needs the output to re-decode, so `convert` encodes into a sibling staging path, measures, and only renames to the target when there is no loss or `acceptLoss` was given. On refusal the staging output is removed and the target never exists. An export never overwrites: a non-empty existing target is `E_EXPORT` (SPEC silent).
2. **blocks layout.** SPEC 6.3 says "the store of pharos-blocks"; I may not read that ledger, so `blocks:` is an own layout (`BLOCKS.jsonl`, one JSON block per line, `hash = sha256(prev \n source \n medium \n payload)`, chain checked, evidence `blocks-chain-break`). It will NOT decode a real pharos-blocks store, and a real store will not decode here. This is the most likely cause of a failing independent flow test on `blocks`.
3. **sqlite projection.** DDL for `heads conflicts kinds meta k_*` and the four views is my own reading of SPEC 1.8 and 6.3; I did not run `pharos-sql`. I added two storage keys to `meta` (`source_files`, `projection`); the catalog (`table: "meta"`) excludes storage keys as SPEC 1.8 says, so `SELECT * FROM meta` on a real pharos-sql file will differ from `SEG(sources; table: "meta")`. SPEC says the SQLite file is the oracle; this is the discrepancy it predicts.
4. **File attribution** for formats that hold none (`json`, `eoql`): decode assigns `file = by`. Import (merge) lands entries in the importing handle's own writer lane (SPEC 4.1), so an import of a multi-file store measures a `file` loss and needs `acceptLoss`.
5. **Verbatim merge into `lib:` does not call `lib.open`**, so no new frame and no boot kinds are created: a replayed verbatim dump into an empty directory gives exactly the dump's id set (L16). Calling `lib.open` first, as a weave does, would add a frame.
6. **`SYN(...; by: [])`** means "aggregate the whole input, one row always, ignoring an inherited grouping". SPEC 2.4 says `REC by` puts a grouping annotation on the world that the next `SYN` without its own `by` consumes (A1 2.3 remark 2 flags this as uncounted state). A SQL query that aggregates over a subquery containing a window function would otherwise group by the window partition. The translator emits `by: []` only in that case. Declared extension of a clause value, no new primitive.
7. **`joined` flag.** `EVA`, `DEF sort/limit` and semi/anti `CON` now keep the "columns are alias-qualified" flag of a join result (SPEC silent). Without it a filter between two joins re-prefixed columns (`l.a.id`).
8. **`SEG(sources; ids: [A, B])` returns heads only** when B is an ancestor of A (it is a log cut, 2.4). Seeds for `CON follow` that must include dominated entries need `DEF(...; collapse: ["history"])`. Consistent with SPEC; easy to trip on.
9. **dump without `--out`** prints the replayable text raw (not a JSON document); SPEC 7.3 says "text, or {out,...}" while also saying every command prints one JSON document.
10. **Semantic dump** emits entries of kinds that the log declares even when the declaration is not expressible (cells are never typed, so a kind with no donor of the same cell cannot be re-declared by `like`); replay then needs a target that declares those kinds (L16 says so). Entries of kinds never declared in the log are skipped with a comment. As a *source*, `eoql:semantic` is replayed into a scratch pharos under `os.tmpdir()` and fails with `E_UNDECLARED_KIND` when the kinds are not declared there.
11. **Chunked replay.** A script is limited to 65,536 characters and 20,000 tokens (SPEC 2.1), so a dump cannot be one script. `E.replay` splits at top-level `;` (string and comment aware), runs chunks with shared labels (`opts.labels`, an internal run option), and shifts receipt statement indices. A verbatim statement that exceeds a parser limit is refused at dump time (`E_NOT_REPRESENTABLE`), never dropped.
12. **Translator output is wordy.** Every select list is `REC(set: {_c1..}; rename; pick)` (aliases cannot clash with source columns, and ORDER BY terms that are not selected become hidden `_oN` columns before the final pick). Correctness over the shape of SPEC 8.5's one-line example. Duplicate output names (`SELECT a.id, b.id`) get a `_2` suffix and a `notes` entry (rows are objects). Output column names follow SQLite: alias, else the column name, else the expression text as written.
13. **Builder-added gap ids** (A1 says A1 only adds the listed ones; these are needed so nothing is guessed): `SQL_COLUMN_UNKNOWN`, `SQL_AMBIGUOUS_COLUMN`, `SQL_UNKNOWN_FUNCTION`, `SQL_UNSUPPORTED_EXPR`, `SQL_WRITE_NOT_BUILT`. They are in `E.CODES`. `REGEXP`, bit operators, row values, unsupported CAST types, integer literals outside the safe range go to `SQL_UNSUPPORTED_EXPR`.
14. **Dialect keyword lists** are written from memory of vendor documentation (no network); every compile result carries a `W_KEYWORDS` note with their sha256 and origin. Quoting is conservative.
15. **Other compile notes**: `W_NULL_SEMANTICS` (postgres `LEAST/GREATEST` ignore NULL), `W_VERSION`, `W_UNORDERED_PAGE`, `W_AGG_ORDER` as in A1 4.4. `total(x)` is lowered as `COALESCE(CAST(SUM(x) AS real), 0.0)`; `nocase(x)` as `LOWER(x)` (sqlite only); `like` on postgres is `ILIKE`; `||` per dialect; division by zero is `a / NULLIF(b, 0)`; `mysql`/`oracle` refuse `/` unless an operand is a real literal.
16. **Spec points I could not settle**: which of `W_CUT_OPEN`/`incomplete` a causally open cut gets when the store is `lazy:` (kept per 1.6.3: `cut-open` evidence); `_pos` on a world derived from `table:` does not exist, so `ordering`/`latest` questions over catalog rows go through `latest_causal` (as A1 4.2 says).
17. `explain.plan[].access` is refreshed after the run (a `lazy:` address read shows `{"method":"region","addr":...}`), because a world is evaluated lazily and the access is only known after its first read.
18. `E.parseSql(sql, {catalog})` with a handle re-folds the source each call (`sqlCatalog`); pass a catalog object to avoid it. Without a catalog only the fixed relations of 1.8 exist (no `k_<kind>`).

## 5. What I ran (all passing at the end; no claim beyond this list)

`node --test test-builder/*.test.mjs`: **80 tests, 80 pass, 0 fail** (12 s of CPU on a loaded machine; no timing claim intended). Files:

* `parse.test.mjs` (10): print idempotence and parse(print(x)) equality on 19 expressions, seed forms, typed errors with positions, limits, string injection, 9,000 fuzz inputs, compose.
* `fold.test.mjs` (24): fold and verbs on a planted log (fork, chain, retraction, clock skew against `of`, dangling ref); causal order and retracted set equal the frozen library's; collapse reports what it discarded; as-of with late arrival; counterfactual equals a physically smaller log; the perceiver/filter contrast of 3.7; ancestry with shared and exclusive branches; incomplete evidence including negative results; closure by `openWorld`; L2 fold-faithfulness; reads leave file hashes unchanged; budget; determinism; 1,500 random expressions through the evaluator (0 untyped errors); `lib/lazy/blocks/sqlite/mem` agree on rows and held over a seeded log.
* `flow.test.mjs` (9): 4 inputs times 81 pairs, each A to B to jsonl with the identical id set; a crafted input with duplicates, an invalid line, non-canonical text, files different from `by` (measured losses per target checked by hand); extra-field refusal; no overwrite; sqlite catalog tables equal the EOQL catalog; id mismatch as evidence; foreign CSV/JSON/SQL import with basis; dump verbatim replay = identical id set and idempotent; semantic replay isomorphic; `; WRITE NUL(...)` inside a body stays a string through dump and replay.
* `write.test.mjs` (12): read-only everywhere, write equals direct weave under a fixed clock, verb versus declared cell, whole-script validation, append-only prefix, retraction and restore, blind write and fork resolution, `sqlite:` not primary, lazy write, views (body keys, no result, changed log changes the view, view of a view = inlined, as-of, retract, cycle), undeclared `view` kind.
* `sql.test.mjs` (11): a 96-query corpus over the projection: translated EOQL equals SQLite on all executable ones, and SQL to EOQL to SQLite SQL returns the same rows (compile-back); every gap id of 8.3 and A1 appears with a position; spellings listed; params; injection strings; 4,000 SQL fuzz inputs; all 16 not_compilable reasons with their class; no clause dropped; dialect text per dialect; `E.dialects()`; catalog.
* `cli.test.mjs` (8): every command, exit codes (0, 1, 2), stderr JSON errors, `--write` needs `--writer`, read runs leave hashes unchanged, HTTP server (host check, 403 on WRITE, 413, 422, no write route) and the `serve` CLI.
* `misc.test.mjs` (6): `sqlrel:` with 17 queries (translation and compiled SQL equal SQLite), `fromV1`, the 2% cost bar on a 60,000-entry placed store (with `splitLimit: 2048`; at the default 65,536 and 20 MB the same address read is 2.2% because every read reads a whole shard and the ground adds regions; the bar is a 10^6-entry property, I did not test that size), `ordering: key`, nasty strings through 8 formats and back, evaluator fuzz.

A second round of 48 translator queries (outside the suite) gave 46 identical to SQLite, 1 a harness artefact (`LIMIT` with no `ORDER BY`), 1 the declared gap (`SQL_CORRELATED_OTHER` for a non-equality correlation).

## 6. Verified only by the 80 tests, not audited clause by clause

The parser, evaluator, world/fold, write path and lib/lazy/blocks/sqlite adapters came from the earlier attempt. I tested the behaviours listed above; I did NOT separately test: read-schema collapse defaults and `DEF schema` windows (`W_SCHEMA_HELD`), held views (`W_VIEW_HELD`), `explain: "brief"`, `legacyGaps`, `W_CUT_OPEN`, `INS(; entries:)` hypotheticals, `until:` and `include_seed` on `CON`, `CON follow: "link"`, `SIG return` interplay with views, and any 10^5 to 10^6-entry behaviour. They may be wrong.

## 7. What building taught about SPEC (for the report, not for me to rule)

* The relational core needed no new primitive in the SPEC sense, but two *states* are not on SPEC's list: the grouping annotation of `REC by` and the "joined" naming flag of `CON`. Both leaked into SQL translation (items 6 and 7).
* A kind outside the four protocol kinds can only be declared `like` an existing kind of the same cell, so an empty pharos cannot gain an INS-cell kind through EOQL at all (SPEC open question 1). The semantic dump hits the same wall.
* `anc: slot` versus the frozen rule (open question 3) is invisible in my tests because the planted log has no cross-slot `of`; `W_ANC_SLOT` fired where expected.
