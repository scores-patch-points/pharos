# EOQL/1: a query-and-update language projected from the fold

Status: SPEC, written 2026-11-13 by the spec designer, stamped (`SPEC.md.sha256`, `SPEC.md.time`) before any builder, QA, SQLA, EQA or test code sees it. It obeys `PREREG.md` (stamped). It is a specification, not a result: nothing in it has been run, and no claim in it is measured. Words MUST, SHOULD and MAY are used in the RFC 2119 sense. "Test sketch" paragraphs say how a claim can fail; they are not tests.

What this file fixes, so a stranger can write correct expressions and a different stranger can implement it:

| part | content |
|---|---|
| 1 | Data model: the source, the fold state ("world"), held sets, retractions, ancestry, causal order, how a relation is derived from a world, the SQL catalog |
| 2 | The language: lexical rules, EBNF, the nine verbs on read and on write with examples, the 8 frame arguments, the extra primitives (honest count), the term language |
| 3 | Semantics as equations, closure, laws with test sketches, collapse, held/determined/incomplete, counterfactual, perceiver windows, ancestry |
| 4 | Writes: `WRITE`, retraction, views, labels, the dump format |
| 5 | Result envelope, cost, budget, typed errors |
| 6 | Formats and the flow matrix, loss manifests, foreign import with `basis` |
| 7 | Interfaces: library, CLI, HTTP, source names |
| 8 | SQL-to-EOQL translator |
| 9 | Hooks for the pre-registered mutants, open questions, non-goals |

Version strings: language `eoql/1`; result `eoql-result/1`; write receipt `eoql-receipt/1`; dump `eoql-dump/1`; loss manifest `eoql-manifest/1`; plan `eoql-plan/1`.

Honesty notes that apply everywhere:
* The nine-verb reading below is the project's DECLARED theory (PREREG: "the verb-to-operator reading is the declared theory, not a finding"). Where a verb is given a meaning the seed code does not have, section 2.4 marks it EXTENSION so the report can count them (PREREG T(c)).
* Cells are never typed. A write names a KIND; the kind's declaration entry supplies the cell. The only places a cell string can occur in EOQL text are inside an entry literal that is merged verbatim (section 4.6), where it is data being restored, not a choice made by the statement.
* No wall-clock claim is made anywhere. Costs are bytes, records, entries, rows and evaluator steps.

---

## 1. Data model

### 1.1 Entries, the log, and a source

An **entry** is exactly the pharos weft (pharos `SPEC.md`; frozen library `ledgers/pharos-lazy/baseline/pharos.mjs`, sha256 `e869302b...` per `BASELINE.sha256`):

```
{ v:1, cell, kind, addr, body, of:[id...], basis:{...}, seen:[id...], by, at, id }
```
* `id = sha256(canonical(entry without id))`; `canonical` is the library's: keys sorted, no whitespace, finite numbers only, plain objects only. An entry is **valid** iff it passes the library's `invalid()` (version 1; string `cell kind addr by at id`; known cell; `of` and `seen` string arrays; `basis` an object; `body` present; id matches content). Extra fields are allowed by the library and hashed into the id; this spec calls them **extra fields**.
* `cell` is one of the 27 ids in `cells.json` (data). `op(cell)` is its operator (`NUL SIG INS SEG CON SYN DEF EVA REC`) and `grain(cell)` its grain. `rank(cell)` is its index in `cells.json`.
* The protocol's own kinds and their cells are fixed by the library: `frame NUL·Ground`, `kind DEF·Figure`, `holon DEF·Pattern`, `retract NUL·Figure`. (So declaring a kind is a DEF, a retraction is a NUL, a frame is a NUL. EOQL's write rules in 4.2 lean on this.)
* A kind is **declared** by a live `kind` entry `{name, cell, schema?}`. For a name with several live declarations: its `cell` is that of the first by `pos` (the library; redeclaring at a different cell is refused by `weave`); its column `schema` is that of the LATEST by `pos` (the pharos-sqlite rule). Both are stated because the two code bases differ on "which declaration"; the cell cannot differ in a valid log, the schema can.
* Storage metadata, never hashed and never part of an entry: `file`, the name of the per-writer file/lane the entry was read from (first file in sorted order if an id appears in several, like the library's dedup). `by` is provenance of authorship; `file` is provenance of storage; they are usually equal and the spec never assumes it.

A **source** is a set of valid entries with storage metadata and a **health report**: `corrupt` (lines that were not valid entries: file, line, reason), `torn` (unterminated last lines), and `files` (what was opened). A source is READ-ONLY unless it was opened in write mode (4.1). Sources are named by URI (7.4). Every source, whatever its storage (`lib:`, `lazy:`, `blocks:`, `sqlite:`, `mem:`), MUST yield the same worlds and the same results for the same expressions; storage may change cost and explain, never rows, `held`, `determined`, `incomplete` (law L21). The one allowed difference is the evidence list of `incomplete` where a store physically cannot show a kind of evidence (6.5).

### 1.2 The world (fold state)

A **world** `W` is a pair `(Φ, F)`: a fold state `Φ` over an entry set `E`, and a **frame** `F` (the 8 frame arguments of 2.5, each with a default). Values in EOQL are worlds. A world is LAZY: the evaluator may materialize only what the expression needs; the denotation below is what must be observably true.

The fold state over a finite entry set `E` (de-duplicated by id) is:

1. **dangling(E)**: the ids named in some `of` or `seen` of an entry of `E` that are not in `E`.
2. **Precedence.** Two relations on `E`:
   * `a ≺full b` iff there is a nonempty path `a = x0, x1, ..., xn = b` with each `x(i)` in `of(x(i+1)) ∪ seen(x(i+1))` and every `x` in `E` (transitive closure over `of ∪ seen`, any slot; the frozen library's rule).
   * `a ≺slot b` iff such a path exists using `of` edges only and every `x(i)` lies in the same slot (1.3) as `a` and `b`. Intermediate entries that are retracted or dropped by a collapse rule still count as path nodes (the library's "heads recomputed through them"). This is the pharos-lazy A1 rule.
3. **Causal order** `pos : E -> 0..|E|-1`, the library's: Kahn's algorithm over predecessors `(seen ∪ of) ∩ E`, ready set kept sorted by `(rank(cell), id)`, lowest first. `pos` is a property of the whole entry set and is recomputed on every restriction (a prefix of a causal order is itself a causal order of the prefix; pharos-sqlite checks this). `pos` is NOT the clock: `at` is informational and is never used to order anything except as the stated stand-in of 1.7.
4. **Retractions.** Scan `E` in descending `pos`; a `retract` entry `r` not already retracted is **effective**; every id in `of(r)` becomes **retracted**. (A retraction of a retraction restores its target: the library's rule.) `retracted_by(e)` = the effective retract entry of least `pos` naming `e`. A `retract` entry without `of` retracts nothing and is reported as a violation.
5. **Live(Φ)** = entries with `kind != retract` and not retracted.
6. **Kinds** `K(Φ)`: the declared kinds as in 1.1; `undeclared(Φ)` = kinds of entries with no declaration (and not frame/kind/holon/retract).
7. **Ground** `G(Φ, c)` for a cut `c`: the declarations of `K` as of `c`, plus the **read schemas**: the heads of each `schema:<kind>` slot as of `c` (kind `schema`, pharos-lazy A2): `body.read = {placement?, collapse?, window?, prior?}`. Only `collapse` and `window` influence EOQL semantics; `placement` and `prior` are storage hints and never change a result. Two concurrent read schemas of a kind are two held WINDOWS; the frame argument `schema` picks (2.5).
8. **Frontier**: ids in `E` named by no `of`/`seen` in `E`.

A **cut** `c` is one of (pharos-lazy 4 plus two additions): an ISO string (entries with `at <=` it); `{at}`; `{at,id}` (entries whose position key `(at,id)` is `<=`); `{ids:[...]}` (exactly those); a 64-hex entry id `#...` (position key `<=` that entry's); `{pos:n}` (the first `n` entries of the causal order of the world as it is when the cut is applied); `{past:[ids]}` (the ids and everything they reach by `≺full`: a causally closed prefix). Applying a cut restricts `E` and recomputes the fold state of the restriction.

### 1.3 Slots, heads, held sets, episodes

A **slot** is a pair `(addr, kind)` (not `(addr, cell)`; see 1.7 for where pharos-sqlite groups differently). `M(s)` = entries of `E` at slot `s`, excluding `retract` entries.

**Heads under a rule.** For a member set `L ⊆ M(s)` and an ancestry basis `anc ∈ {slot, full}` (frame argument), `heads(L, anc)` = `{ a ∈ L : there is no b ∈ L, b != a, with a ≺anc b }` where `≺slot`/`≺full` are the relations of 1.2 computed over ALL of `E` (so paths pass through entries that are not in `L`).

**Collapse rules** (frame argument `collapse`, a list applied left to right; pharos-lazy 5, plus `all` and `history`). Let `Ret` be the retracted set.

| rule | member set `L` | rows of the slot |
|---|---|---|
| `all` | `M(s)` plus the `retract` entries at the slot's addr | every entry, with `_retracted` flagged. For SQL-catalog compatibility; no heads computed |
| `history` | `M(s) \ Ret` | every live entry, oldest first (all pasts, no heads) |
| `none` (default) | `M(s)` | `heads(M(s))`, retracted heads kept and flagged: the whole superposition |
| `drop-retracted` | `M(s) \ Ret` | `heads(M(s) \ Ret)`: paths go through retracted entries, so retracting a head exposes its predecessor |
| `latest` | as the preceding rule in the list (or `M(s)`) | the single head with greatest `pos` (ties cannot occur: `pos` is injective) |
| `effective-latest` | | `drop-retracted` then `latest` |

Rules compose left to right, each narrowing the previous: `[asof, drop-retracted, latest]` is `effective-latest` plus a cut. `latest` on an empty head set yields no row.

**Survivor count.** `held(s)` = the number of heads of the slot under the rule list WITHOUT its final `latest`/`effective-latest` step (so `held` is the size of the superposition that was collapsed, or that is still there). `held = 1` is determined, `held >= 2` is held (several pasts survive), `held = 0` with `M(s) != {}` means every member is retracted (a **void** slot: a finding, reported, never presented as an empty determined answer), and a slot with `M(s) = {}` does not exist.

**Episodes** (pharos-lazy A1, restated). Replay the slot's live-or-not member entries in `pos` order maintaining the head set under `anc`. An **episode begins** at the entry whose arrival makes `|heads| >= 2` (for a 3-way fork, the second concurrent entry); `held` = heads right after it began; it **ends** at the entry whose `of` contains every head held at that moment; otherwise it is **open**. `participants` = every id that was a head during the episode; `differ` = bodies not all canonically equal. A fork with identical bodies is still held and still an episode. Episodes are reported in `explain` and available through `CON(... conflict)` (2.4).

### 1.4 From a world to a relation: `rows(W)`

A relational operator never touches the log; it asks the world for its **rows**. `rows(W)` is defined by the frame, in five steps; this is the single bridge between the fold and the relational core:

1. Group `E` into slots. Apply the world's `collapse` rule list (1.3) to each slot to get its rows' entries `R(s)` and its survivor count `held(s)`.
2. Each entry `e` in `R(s)` yields one **row** with these **system columns** (the leading underscore is reserved for them):

| column | value |
|---|---|
| `_id` | `e.id` |
| `_slot` | `addr + "\u0000" + kind` rendered as the JSON array `[addr, kind]` text |
| `_addr`, `_kind`, `_cell`, `_by`, `_at`, `_v` | the entry fields |
| `_file` | storage metadata |
| `_of`, `_seen`, `_basis` | the entry fields (JSON values) |
| `_pos` | the entry's causal position in the world |
| `_head` | 1 if the entry is a head under the world's `anc`, else 0 |
| `_retracted` | 1 if retracted, else 0; `_retracted_by` the retractor's id or null |
| `_held` | `held(s)` |
| `_determined` | 1 iff `_held = 1` and `_incomplete = 0` |
| `_incomplete` | 1 iff the slot's evidence of loss is nonempty (1.6) |
| `_src` | JSON array of the entry ids this row stands for (`[_id]` for a row of a raw world) |

3. **Body columns.** `body` is available as the JSON column `body`. If `body` is an object, each top-level key `k` that does not begin with `_` and does not clash with a system column is also a column `k` with the JSON value of `body[k]`. If the kind's latest live declaration has a `schema` (shapes accepted: array of names or `{name,type}`; map name->type or name->`{type}`; any of these under `columns|fields|properties|props|cols|attributes|keys`; or a string `"a, b INTEGER"`), the columns are exactly the declared ones in declared order (array form) or sorted order (object form) with types mapped to INTEGER/NUMERIC/REAL/TEXT affinities as in pharos-sqlite `schema.mjs`, a missing key giving NULL; a `schema` column named `id` is `id_`. With no schema the columns of a relation are the union over its rows, sorted; a missing key is NULL. A body that is not an object contributes only `body`.
4. Rows are ordered by `(_pos, _id)` unless a `DEF sort` says otherwise. Operators preserve input order unless stated (EVA, REC: input order; SYN groups: first-occurrence order; CON: left-major).
5. **Value domain** (V1, SQLite-compatible; chosen so containment of the SQL core is a definition and not a hope): NULL, integer, real, text, and JSON values. JSON `null` and a missing key are both NULL. A JSON boolean compares and sorts as 0/1 and prints as `true`/`false` when it came from JSON. JSON arrays/objects compare and sort as their canonical JSON text (TEXT). Ordering of mixed values: NULL < numbers < text; text by byte-wise UTF-8 comparison. Integer arithmetic on two integers is integer (`/` truncates toward zero, `%` has the sign of the dividend, division or remainder by zero is NULL, 64-bit overflow is the error `E_RANGE`); any real operand makes the result real. Comparisons and boolean logic are three-valued (SQL): comparing with NULL is NULL (unknown); `EVA` keeps only rows whose predicate is true.

A world whose entries are all real (as read from a source, possibly restricted) is **raw**. The outputs of row operators are **derived** worlds (1.5).

### 1.5 Derived worlds and closure

A row operator (EVA, REC, CON, SYN-aggregate, INS-rows) returns a **derived world**: a world whose entries are **virtual entries**, one per output row:

```
{ v:1, cell:null, kind:"~row", addr:<row key>, body:{...columns incl. system columns...},
  of:[], basis:{derived:"<expr_hash>"}, seen:[], by:null, at:<max at of sources or "">,
  id: sha256(canonical({derived, key, body, src:[...], n})), src:[source entry ids] }
```
Virtual entries are never appended anywhere. Row identity is `(expr_hash, src, n)` where `n` disambiguates identical rows from identical sources, so bags (duplicates) are preserved. The `_held`, `_determined`, `_incomplete`, `_slot` and `_src` columns are carried as DATA of the row: a derived row's `_held` is the MAX of `_held` over the rows it was computed from (worst case, never optimistic), and `_incomplete` the OR. `rows(derived world)` returns exactly the stored rows (identity), in stored order.

Typing rule **T1**: the projection frame arguments (`asof`, `schema`, `collapse`, `anc`, `ordering`) and `perceiver` act on the log, so they are only legal on a raw world; applied to a derived world they raise `E_FRAME_DERIVED` (`DEF(EVA(x, p); collapse: latest)` is an error; write `EVA(DEF(x; collapse: latest), p)`). Everything else (every verb, `sort`, `limit`, `budget`, `return`, merging, exporting) accepts either kind. Hence **closure**: every expression's value is a world, every world is a legal input to every verb (T1 aside), and the result of an expression equals the fold of the entries it read (law L2).

### 1.6 Held, determined, incomplete: exact definitions

* **held** of a row/slot: its survivor count (1.3). The envelope's `held` summary is `{slots, max, extra}`: the number of distinct `_slot` values among result rows with `_held >= 2`, the maximum `_held`, and the sum of `_held - 1` over those slots.
* **determined** of a row: `_held = 1` and not `_incomplete` (and, when `ordering: key` supplied a tie-break, no inversion was found, see 1.7). Of an envelope: every result row is determined; an empty result is determined iff it is not incomplete. A scalar derived from several rows (an aggregate) is determined iff all its source rows are.
* **incomplete over range**: the result is `incomplete` when there is EVIDENCE that entries which could change it were not available. Evidence, and only evidence, never presumption:
  1. `corrupt` or `torn` lines in any file the plan opened that the source cannot attribute to a different address (for `lib:` and `blocks:` and `sqlite:` every corrupt line counts globally; for `lazy:` a corrupt line counts when its address prefix matches a slot read, or is unattributable);
  2. a dangling `of` or `seen` id of a returned row's slot members (and, when `anc: full`, any dangling id inside the ancestry closure that was walked), where the store can resolve an id against the whole source (`lib:`, `mem:`, `blocks:`, `sqlite:`). A placed store cannot find an entry by id without its address, so on `lazy:` an id that leaves the slot is reported as gap `W_UNRESOLVED_REF` (with the count) and not as `incomplete`: it may be a cross-address reference to an entry that exists (4,758 of the replay's 8,949 `of` references are);
  3. a cut that is not causally closed (a returned row's slot has a member whose `of` names an entry outside the cut): evidence kind `cut-open`;
  4. adapter-specific integrity breaks (a blocks hash-chain break; a sqlite entry whose recomputed id differs).
  `incomplete` is `null` or `{over:[{reason, where, ids?}]}`. A NEGATIVE result (no rows, a count of 0, an absent address) carries whatever evidence exists for the WHOLE source, since any missing entry could have been at that address. The language never treats silence as "nothing happened": it also never invents a gap; a log truncated silently with no surviving reference is undetectable and the spec says so (open question 2).

### 1.7 Ordering, and where the sources legitimately differ

* `latest` is defined with `pos` of the world. Because `pos` needs the whole entry set, an expression that needs `_pos` (sorting, a `latest` tie-break between CONCURRENT heads) reads the whole log from a store that cannot give `pos` locally; `explain.plan` shows a step `order: global`. A store that cannot afford that MAY be asked for `ordering: key`, which replaces `pos` by the position key `(at, id)` compared as strings (pharos-lazy 4). That is a clock stand-in: results carry `order_basis:"key"` and gap `W_ORDER_KEY`, and `determined` is false for any row that used the tie-break and for any returned entry with a `≺full`-predecessor of larger key (an **inversion**, counted). Mutant M1 is "latest by clock when `ordering: causal` was requested".
* The causal part of `latest` is real: among the heads, an entry that another entry named in `of` is not a head, whatever its `at` says; clock skew cannot make a superseded value win. Only between mutually concurrent heads does `pos` act, and then the result is `held`, not determined, whatever the tie-break.
* `anc: slot` is the default: ancestry only through same-slot `of` paths. It is cheap on a placed store and makes results independent of storage. It reports MORE held than `anc: full` whenever a later write cited an earlier value only through another slot, or only in `seen`. On the Premiere replay the pharos-lazy ledger measured 1,336 addresses held under the `of`-only rule and 0 conflicts under the frozen rule (`of ∪ seen`), because replayed entries chain across addresses and carry `seen`. Both are correct answers to different questions: `seen` records what the writer could perceive, `of` what it read; an entry that did not cite a value did not answer it. The default is the stricter-on-held reading; ask `anc: full` for the frozen rule.
* pharos-sqlite groups `heads`, `conflicts`, `latest_causal` by `(addr, cell)` and orders by `≺full`; EOQL's native slot is `(addr, kind)`. They coincide whenever one kind holds a cell at an address. The SQL catalog (1.8) uses pharos-sqlite's grouping on purpose, so translated SQL equals SQLite.

### 1.8 The SQL catalog: relations derivable from a world

So that the relational core is CONTAINED and not merely imitated, the following relations are defined as functions of a world `(Φ, F)` (F's `anc`, `collapse`, `asof` are ignored by the catalog except `asof`, which restricts `E` first; the catalog fixes its own definitions). They reproduce the tables and views of `pharos-sqlite/docs/DESIGN.md` (2026-11-13), restated here as equations. If the restatement and the SQLite file built by `pharos-sql` disagree on a log, the SQLite file is the oracle for P1 and the discrepancy is a defect in this paragraph, to be reported.

| relation | definition |
|---|---|
| `entries(pos,id,writer,cell,kind,addr,body_json,of_json,seen_json,basis_json,by,at,v,retracted,retracted_by)` | one row per valid entry including `retract` entries; `writer` = `file`; JSON columns are canonical JSON text; `retracted` = 1 iff retracted; `retracted_by` as 1.2.4 |
| `all_entries` | `entries` |
| `live_entries` | `entries WHERE retracted = 0 AND kind <> 'retract'` |
| `heads(addr,cell,id)` | per `(addr,cell)` group of `live_entries`: the entries with no other group member `b` such that `a ≺full b`. Never collapsed. Frames count here (two frames are held, not a conflict): frames are rows of `heads` and never of `conflicts`, as in pharos-sqlite |
| `conflicts(addr,cell,ids_json)` | the library's rule: for each `(addr,cell)` group (no frames) whose live entries' bodies are not all canonically equal: one row per PAIR of heads with differing bodies, `ids_json = ["a","b"]`, `a < b` as strings |
| `latest_causal(addr,cell,id)` | per `(addr,cell)` group, the head of greatest `pos` |
| `kinds(name,cell,schema_json,id,pos,decls,table_name,columns_json)` | one row per declared name, from the latest live declaration by `pos`; `decls` = number of live declarations; `table_name` = `k_` + name (collisions per DESIGN.md); `columns_json` per 1.4.3 |
| `k_<kind>(id, ...schema columns or body_json)` | for each declared kind: its entries that are not retracted; columns per 1.4.3, else `(id, body_json)` |
| `undeclared_entries` | `entries WHERE kind NOT IN (SELECT name FROM kinds)` |
| `k_<kind>` for an undeclared kind that has entries | `(id, body_json)` over `retracted = 0` |
| `meta(key,value)` | ONLY the keys `source_count`, `source_frontier`, `dangling_count`, `corrupt_count`, `cut_pos`, `rule:order`, `rule:latest_causal`, `rule:live_entries`; other keys (`source_files`, `library_sha256`, `schema_hash`, `projection_*`) are storage facts and are not in the catalog |

In EOQL text the catalog is reached with `SEG(sources; table: "<name>")` (2.4). `table:` yields a DERIVED world whose rows have exactly the catalog's columns and none of the system columns (so SQL queries over it see SQL's schema, nothing more).

---

## 2. The language

### 2.1 Lexical rules

Input is UTF-8 text, at most 65,536 characters per script (`E_LIMIT` beyond), at most 20,000 tokens, nesting depth at most 64.

* **Whitespace** separates tokens. **Comments**: `--` to end of line, and `/* ... */` (not nested). Neither is recognised inside a string.
* **Verbs** (case-sensitive, upper case): `NUL SIG INS SEG CON SYN DEF EVA REC`. **Connectives** `AND OR NOT` and the statement marker `WRITE` (upper case only). Any other three-capital call such as `ABC(...)` is `E_UNKNOWN_VERB` (the seed returned the gap "could not bind operator").
* **Contextual words** (case-insensitive, reserved only in the positions where the grammar uses them): `is not null set contains in between like glob escape true false distinct asc desc nulls first last`, and `heads`, `live-heads`, which are literals only as the value of `of:` (so `live-heads` is one token there; a field called `heads` or `first` is legal elsewhere).
* **Identifiers** `[A-Za-z_][A-Za-z0-9_]*`; **quoted identifiers** in backticks (for kind names such as `` `request-raised` ``). Field paths: `a.b.c`, `a[0]`; the sigil form `$a.b` is always a field path (needed on the right of the legacy operators, see LL).
* **Strings**: `"..."` or `'...'` with `\" \' \\ \n \t \r \uXXXX`; a doubled quote inside a quote of the same kind is that quote (SQL habit).
* **Numbers**: `-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?`; integers have no fraction or exponent.
* **Idref** `#` followed by 8 to 64 lowercase hex digits: an entry id or a unique prefix resolved against the source at bind time (`E_AMBIGUOUS_REF`, `E_BIND_NAME`).
* **Param** `:name`: a placeholder bound by the host (P-PARAM, 2.6). **Label** `@name`: a script-scope binding of an entry id (P-LABEL).
* **Glyph prefix.** Any of `∅ ○ ● ｜ ⋈ ⤫ △ ⊢ ⊨ ◉ ⊛` directly before a verb is ignored (the on-screen strip prints `⊨ EVA(...)`). The canon glyphs are `∅ SIG○ INS● SEG｜ CON⋈ SYN△ DEF⊢ EVA⊨ REC◉`; `⤫` and `⊛` are the legacy CON and REC glyphs still read. A glyph that disagrees with its verb is gap `W_GLYPH`.
* **LL, the legacy-literal rule.** Right of the operators `is`, `is not`, `contains`, `not contains` a run of bare words (up to the next `;`, `)`, `AND`, `OR`, or end) is a TEXT LITERAL, not a field reference, exactly as the seed reads `EVA(publisher is Metro Daily)`. A quoted string or a number there is that literal. The words `null` and `set` keep their meaning (`is null`, `is set`). To compare with a field, write `$field`. Right of every other operator a bare identifier is a field reference.

### 2.2 Grammar (EBNF)

```
script     = [ statement { ";" statement } [ ";" ] ] ;               (* only ";" at depth 0 separates statements *)
statement  = "WRITE" verbcall | expr ;

expr       = orexpr ;
orexpr     = andexpr { "OR" andexpr } ;
andexpr    = notexpr { "AND" notexpr } ;
notexpr    = "NOT" notexpr | relexpr ;
relexpr    = addexpr [ relop addexpr
                     | "is" [ "not" ] ( "null" | "set" )
                     | "is" [ "not" ] litrhs                          (* LL *)
                     | [ "not" ] "contains" ( litrhs | addexpr )
                     | [ "not" ] "in" ( list | "(" expr ")" | param )
                     | [ "not" ] "between" addexpr "AND" addexpr
                     | [ "not" ] "like" addexpr [ "escape" addexpr ]
                     | [ "not" ] "glob" addexpr ] ;
relop      = "=" | "==" | "!=" | "<>" | "<" | "<=" | ">" | ">=" ;
litrhs     = string | number | barewords | "$" path ;
addexpr    = mulexpr { ( "+" | "-" | "||" ) mulexpr } ;
mulexpr    = unary { ( "*" | "/" | "%" ) unary } ;
unary      = "-" unary | primary ;
primary    = literal | param | label | idref | path | "$" path
           | funcall | verbcall | viewcall | "(" expr ")" | list | object | "*" ;   (* "*" only as the sole argument of count *)
literal    = string | number | "true" | "false" | "null" | "heads" | "live-heads" ;
path       = ( ident | qident ) { "." ( ident | qident ) | "[" integer "]" } ;
funcall    = ident "(" [ "distinct" ] [ expr { "," expr } ] ")" ;
viewcall   = ident "(" [ pair { ";" pair } ] ")" ;                    (* name(param: value ; ...) *)
verbcall   = [ glyph ] VERB "(" [ first ] { ";" clause } ")" ;
first      = expr | clause ;                                           (* the input world, a legacy condition, or the first clause *)
clause     = key ":" value ;
key        = ident ;
value      = ( expr | list | object ) [ "asc" | "desc" ] [ "nulls" ( "first" | "last" ) ] ;
list       = "[" [ value { "," value } ] "]" ;
object     = "{" [ pair { "," pair } ] "}" ;
pair       = ( ident | string | qident ) ":" value ;
```

`funcall` versus `viewcall` is decided by the first token after `(`: `ident ":"` makes it a viewcall. The name is resolved at bind time (function table, then bindings, then stored views). The postfix `asc desc nulls first|last` is syntactically allowed after any value and means something only in `sort`/`order`; elsewhere it is `E_BAD_CLAUSE_VALUE`.

**Statements.** A statement without `WRITE` is a READ: it can only compute a world and never appends anything. A `WRITE` statement appends entries; it is refused with `E_READONLY` at PLAN time (before any statement of the script runs) unless the handle was opened for writing AND the run was asked for write mode (4.1). The read/write distinction is carried by `WRITE` alone; the verb's own meaning on write is in 2.4.

**Context and the implicit input.** Every world expression is evaluated in a context `ctx`. At top level `ctx = sources` (the handle's root world). A verb call with no input expression (an empty first segment, a first segment that is a clause, or a legacy condition) takes `ctx` as its input. Inside a clause value that is a world expression (`to:`, `with:`, `in:`, `base:`, `step:`, `expect:`), `ctx` is the input world of the enclosing call. Seed example: in `SEG(EVA(publisher is Gallup))` the inner `EVA` has no input, so its input is `ctx = sources`; the `SEG` takes the `EVA` world as its input and has no clause, so it is the identity on it. The seed's meaning is preserved.

**Connectives on worlds.** `AND`, `OR`, `NOT` are polymorphic. On predicates (terms) they are 3-valued boolean connectives. On worlds they are set operations on the world's ROW KEYS (`_id` for a raw world, the stored row identity for a derived one) taken within `ctx`: `a AND b` intersection, `a OR b` union, `NOT a` is `ctx` minus `a`. A bare predicate used where a world is expected is lifted by `EVA(ctx; where: p)`. So the seed's `publisher is X AND year = 2020` is `EVA(ctx; where: publisher is X AND year = 2020)`, and `EVA(publisher is X) AND EVA(year = 2020)` is the intersection of two filtered worlds; both are the same rows. The call forms `AND(a, b, c)`, `OR(a, b)`, `NOT(a)` (comma separated, three-capital words that are connectives) are accepted as the seed accepts them and mean the same.

**Names.** A bare name in world position resolves, in order, to: a local binding (`DEF bind`/`fix`), a stored view of that name AS OF the frame's cut (4.5), the built-in `sources`. Anything else is `E_BIND_NAME`. Names in clause positions typed S (kind names, labels, writers) are strings, resolved to nothing.

### 2.3 Backward compatibility with the holodeck seed

`holodeck/index.html` `eoqlParse` accepted the grammar `OP(arg)` (three capitals), infix `AND`/`OR`/`NOT`, `AND(a,b)`, `OR(a,b)`, `NOT(x)`, `SEG(sources)`, `SEG(<expr>)`, and `EVA(field op value)` with op in `is | is not | contains | not contains | = | >= | <= | > | <`; `REC`, `SYN`, `DEF` kept free text. Every seed string that `eoqlParse` binds without a gap MUST parse in EOQL with this meaning:

| seed form | EOQL meaning |
|---|---|
| `SEG(sources)` | the root world `sources` (identity) |
| `SEG(e)` | `e` evaluated in `ctx` |
| `EVA(f op v)` | `EVA(ctx; where: f op v)` (LL for the bare-word value; the field name is looked up exactly, then lower-cased, as the seed lower-cased it) |
| `REC(by x)` | `REC(ctx; by: [x])` |
| `SYN(Count)`, `SYN(Count f)`, `SYN(Sum f)`, `SYN(Average f)` or `avg`, `Min f`, `Max f` (any case) | `SYN(ctx; agg: {n: count(*)})`, or the aggregate named, over the field `f`; the output column is named after the function (`count`, `sum`, `avg`, `min`, `max`) |
| `DEF(order by f asc\|desc)` | `DEF(ctx; sort: [f asc\|desc])` |
| `DEF(first N)` | `DEF(ctx; limit: N)` |
| `AND`/`OR`/`NOT` | as in 2.2 |

The legacy `REC`/`SYN`/`DEF` phrases are recognised only as the WHOLE first segment of that verb and only if it matches exactly; anything else in that position is parsed as an input expression.

Declared divergences from the seed (the seed bound nothing for these or behaved badly; each is a typed outcome here):
* **D1** `=`, `!=`, `<`, `<=`, `>`, `>=` are typed comparisons of V1 values (a number is not its text). The seed's `=` was a case-insensitive text equality. `is`, `is not`, `contains`, `not contains` keep the seed's case-insensitive text semantics (both sides rendered as text and lower-cased; a number compares by its decimal text). So `publisher is gallup` matches `Gallup`, and `publisher = gallup` does not.
* **D2** After `=` a bare word is a field reference, not text (so `publisher = Gallup` is `E_BIND_FIELD` with a hint to use `is` or quotes). `year = 2026` is unaffected.
* **D3** A condition naming a field no row has is not silently true (the seed returned `true` and a gap). A field missing from SOME rows is NULL there (the row is dropped by EVA, gap `W_NO_FIELD` with the count); a field missing from ALL rows of a non-empty relation is `E_BIND_FIELD`. The host MAY ask for the seed's lenient behaviour with the run option `legacyGaps: true` (CLI `--legacy-gaps`): then an unbindable condition keeps every row and is listed in `gaps`. That option is not part of the language and cannot be written in text.
* **D4** The seed's `CON`, `NUL`, `SIG`, `INS` returned "could not bind operator"; here they bind.

### 2.4 The nine verbs, on read and on write

Notation. `X` is an input world. Tags: [seed] the meaning comes from the seed code (`eoTrace`: SEG scope, EVA filter, CON follow, SYN aggregate, REC group-by or transform, DEF frame/sort/window, NUL unbound observation); [EXT] a meaning this spec adds, counted for PREREG T(c). The reading of each verb is its declared EO reading (NUL observe without transforming, SIG attend, INS instantiate, SEG segment, CON connect, SYN synthesize, DEF define, EVA evaluate, REC recontextualize).

**Clause types** used below: S string (a bare identifier is the string), N number, B boolean, E world expression, P predicate (a term), T term, L list, O object, C cut (1.2), F frame object, Q expression kept as syntax (not evaluated).

Every read verb returns a world. A clause not listed for a verb is `E_UNKNOWN_CLAUSE`; a value of the wrong type is `E_BAD_CLAUSE_VALUE`. Clauses of one call are applied in the order of the verb's table, not the order written, so text order never changes meaning; the canonical printer (4.5) emits them in table order.

#### EVA, evaluate [seed]
Read: keep the rows of `rows(X)` for which a predicate is TRUE.

| clause | type | meaning |
|---|---|---|
| `where` | P | the predicate, 3-valued; rows where it is false or unknown are dropped. The first segment may be a legacy condition instead |

`EVA(X; where: p)` = derived world of the rows `r` of `rows(X)` with `p(r) = true`; `_held`, `_slot`, `_src` pass through. EVA works on PROJECTED rows, after collapse: `EVA(DEF(sources; collapse: ["latest"]); where: status is open)` asks which slots have an open LATEST value. To ask for entries whose own body had `status` open before any collapse, use `SEG(...; where:)` (entry level) or `collapse: ["history"]`. A predicate may contain `in (E)`, `not in (E)` (a one-column world), and `exists`-style tests are written `CON(...; join: "semi")` (below).
Examples:
```
EVA(publisher is Metro Daily)                                  -- seed form, ctx input
EVA(SEG(sources; kinds: ["move"]); where: _held > 1 AND body.clip is set)
EVA(x; where: id in (REC(EVA(y; where: n > 3); pick: ["id"])))    -- in-subquery over a one-column world
```
Clauses are separated by `;`, list and object members by `,`.
Write: `WRITE EVA(addr; kind: K; of: [...]; body: ...)` records an evaluation, a judgement about particular entries (the entries it read are `of`): an entry of a kind declared at an EVA cell. Example: `WRITE EVA("clip:7"; kind: "verified"; of: [@l1]; body: {"ok": true})`.

#### SEG, segment [seed]
Read: cut the LOG. The result is the fold of the sub-log: the entries kept, nothing else; hidden entries are absent, so ancestry through them is gone and heads are recomputed. (Contrast EVA, which filters values and keeps the log's ancestry.)

| clause | type | meaning |
|---|---|---|
| `table` | S | the SQL catalog relation of that name (1.8); a derived world with the catalog's columns |
| `keep` | O | keep entries matching ALL selectors present: `addr` (string with `*` `?` glob, or list), `kinds` (list), `writers` (list, matched on `by`), `ids` (list of idrefs, or an E yielding `_id`), `where` (P over RAW ENTRY columns: `_id _addr _kind _cell _by _at _of _seen _basis` and body keys, evaluated before any fold) |
| `drop` | O | remove entries matching ANY selector present (same selectors), plus `cascade`: `"none"` (default) \| `"of"` \| `"full"`: also remove everything that reaches a removed entry by `of`, or by `of ∪ seen` (the descendants) |
| `addr` `kinds` `kind` `writers` `ids` `where` | | shortcuts: each is `keep: {that: value}`; several shortcuts conjoin with `keep` |

Examples:
```
SEG(sources)                                                    -- seed: all
SEG(sources; addr: "clip:7")                                    -- one address (a slot-closed selector: cheap on a placed store)
SEG(sources; keep: {kinds: ["move"], writers: ["editor-premiere"]})
SEG(sources; drop: {writers: ["editor-premiere-3"], cascade: "of"})   -- counterfactual: that lane never wrote
SEG(sources; table: "k_move")                                   -- SQL catalog relation
```
Selectors on `addr` and `kinds` are SLOT-CLOSED (they keep or drop whole slots); `writers`, `ids`, `where`, `drop` are not (they can change heads). Only slot-closed SEGs commute with row operators (L4).
Write [EXT]: `WRITE SEG(addr; kind: K; body: {...})` appends an entry of a SEG-cell kind: moving an entity across a partition boundary. Sugar `into: S` adds `{"into": S}` to the body. Example: `WRITE SEG("clip:7"; kind: "assigned"; into: "bin:b1")`.

#### REC, recontextualize [seed: group-by or transform]
Read: change what the rows mean without changing which rows there are: add or compute columns, rename, keep a subset of columns, key rows into groups, and compute window functions over those groups. (Schema independence: a rename is a REC, not a rewrite.)

| clause | type | meaning |
|---|---|---|
| `by` | L of T | key the rows into groups by these terms. Rows are retained (a window, not an aggregate). A following `SYN` aggregates the groups |
| `order` | L of T with `asc/desc/nulls` | order inside each group, for window functions and for `first_value`-style functions |
| `set` | O name -> T | compute columns, evaluated in row order; a name that exists is overwritten; terms may call window functions (2.7) |
| `rename` | O old -> new | rename columns |
| `pick` | L of S | keep only these columns (after `set`, `rename`), in this order |
| `rows` | L [lo, hi] | an explicit window frame for aggregate window functions: `rows: [-2, 0]` is `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`; `null` is unbounded. Default with `order`: from the group start through the last PEER of the current row (SQL RANGE default); without `order`: the whole group |

`pick` removes VISIBLE columns only: a row's metadata (its held count, determined and incomplete flags, `_src`, slot) is kept on the derived row whatever is picked, and is what `row_meta` reports; a system column such as `_held` is visible only until a `pick` leaves it out. `by` also GROUPS the world: the grouping annotation survives `EVA`, `REC` and `DEF sort/limit` and is consumed by the next `SYN` that has no `by` of its own (so the seed's `REC(by party)` then `SYN(Count)` is group-by-count); `CON` and merging drop it.
Examples:
```
REC(SEG(sources; kinds: ["utterance"]); pick: ["_addr", "text", "_basis"])
REC(x; by: ["clip"]; order: [_pos desc]; set: {rn: row_number(), tot: sum(n)})
REC(by x)                                                       -- seed: REC(ctx; by: [x])
```
Write [EXT]: `WRITE REC(addr; kind: K; of: [...]; body: ...)` records a reinterpretation: a new meaning for what was read (`of`). The canonical use is a new read schema: `WRITE REC("schema:move"; kind: "schema"; of: heads; body: {"read": {"collapse": "effective-latest"}})`: how the kind is read changes by appending, never by rewriting (pharos-lazy A2).

#### SYN, synthesize [seed: aggregate]
Read, three forms.
1. **Aggregate.** Collapse each group (the groups made by `REC by`, or by `by` here, or one group) into a whole: one derived row per group.
2. **Merge two worlds.** `SYN(X; with: Y)` is the world of the UNION of the two entry sets (a log merge: pharos `merge`, by id). Nothing is appended in a read.
3. **Row set operations** `mode: "union" | "union_all" | "intersect" | "except"` on two derived worlds, comparing rows by VALUE (system columns excluded).

| clause | type | meaning |
|---|---|---|
| `by` | L of T | group keys (if the input is not already grouped) |
| `agg` | O name -> aggregate call | the aggregates (2.7); with `by`, one row per group holding the keys and the aggregates |
| `distinct` | B or L of S | one row per distinct tuple of those columns (all columns if `true`); first occurrence kept, in input order |
| `with` | E | the second world |
| `mode` | S | `"merge"` (default for two raw worlds) \| `"union"` \| `"union_all"` \| `"intersect"` \| `"except"` |

An aggregate `SYN` with no `by` (and no inherited grouping) always returns exactly one row (`count` 0 and the other aggregates NULL on empty input); with `by` or grouping, an empty input gives no rows. Aggregates are SQL's over V1 values, plus the survivor-count rule: the output row's `_held` is the max of its sources' `_held`, so an aggregate over a superposition is HELD, not determined.
Examples:
```
SYN(SEG(sources; table: "k_move"); by: ["clip"]; agg: {n: count(*), last: max(at)})
SYN(Count)                                                      -- seed
SYN(a; with: b)                                                 -- merge logs a and b
SYN(a; with: b; mode: "except")                                 -- rows of a not in b
```
Write [EXT], two forms. (a) **Resolve a fork**: `WRITE SYN(addr; kind: K; of: heads; body: ...)` appends a merge entry whose `of` names the held heads: the episode ends at this entry (1.3). (b) **Merge entries verbatim**: `WRITE SYN(; entries: [<entry literal>...])` appends complete entries as they are (their `id`, `at`, `seen`, `by` are data, verified, not computed); the SYN of two logs is the union of their entries, so it is idempotent and commutative (4.6).

#### CON, connect [seed: follow a relationship]
Read, two forms.
1. **Join.** Relate each row of `X` to rows of `to`.
2. **Follow.** Starting from the rows of `X` (seeds), walk ancestry or links and return the reached entries.

| clause | type | meaning |
|---|---|---|
| `to` | E | the right input of a join |
| `on` | P | the join condition, over columns qualified by the aliases |
| `join` | S | `"inner"` (default) \| `"left"` \| `"right"` \| `"full"` \| `"cross"` \| `"semi"` \| `"anti"` \| `"anti_null"` (null-aware, SQL `NOT IN`) |
| `as`, `to_as` | S | aliases of the two sides (default `l`, `r`). Output columns of a join are `alias.column`; an unqualified name resolves when unambiguous. `semi` and `anti` return only left columns |
| `follow` | S | `"of"` \| `"seen"` \| `"full"` (= `of ∪ seen`) \| `"link"`: the edge relation to walk |
| `rel` | S | with `follow: "link"`, the link kind: edges are entries of that kind with `addr` = from and `body.to` = to (the form `WRITE CON` appends) |
| `dir` | S | `"up"` (ancestors, default) \| `"down"` (descendants) \| `"both"` \| `"concurrent"` (entries that are neither ancestors nor descendants nor the seed: "in flight with it") |
| `depth` | N or `"*"` | steps; `"*"` is the transitive closure (uses P-FIX) |
| `in` | E | the raw world to walk in (default `sources`) |
| `until` | P | stop walking beyond rows satisfying it |
| `include_seed` | B | include the seeds in the result |

Follow output: one row per reached entry (distinct), with the entry's system columns (collapse `all` view of it) plus `_depth` (least number of edges), `_branch` (JSON list: the seed ids from which it is reachable), `_fork` (1 if the entry participates in a conflict episode of its slot), `_episode` (the id of the entry at which that episode began, or null), `_siblings` (the other participants). `_branch` having more than one id marks shared ancestry; exactly one marks a part that belongs to one seed only. Conflict awareness is this: the walk follows BOTH sides of a fork, it never picks one, and it labels what is shared and what is exclusive.
Examples:
```
CON(SEG(sources; ids: [#9f2c11aa]); follow: "of"; dir: "up"; depth: "*")           -- everything it read, transitively
CON(SEG(sources; ids: [#9f2c11aa]); follow: "full"; dir: "concurrent")             -- what was in flight with it
CON(SEG(sources; table: "k_move"); to: SEG(sources; table: "k_clip");
    on: l.clip = r.id; join: "left")
```
Write [EXT]: `WRITE CON(from_addr; to: to_addr; kind: K; rel: S; body: {...})` appends a link entry of a CON-cell kind: `addr` = `from_addr`, body = `{"to": to_addr, "rel": S, ...body}`.

#### DEF, define [seed: set the read frame, sort, window]
Read: set the frame of a world, order and window its rows, bind names, and define by recursion.

| clause | type | meaning |
|---|---|---|
| `asof` | C | the cut (frame argument F1) |
| `schema` | S or F | the ground version (F2) |
| `collapse` | L of S | the collapse rule list (F3) |
| `anc` | S | `"slot"` \| `"full"` (F4) |
| `ordering` | S | `"causal"` \| `"key"` (F5) |
| `sort` | L of T with `asc/desc/nulls` | order the rows (NULLs first ascending, as SQLite) |
| `limit`, `offset` | N or T | window the rows after sorting |
| `bind` | O name -> E | local names for the body |
| `fix` | S | the name of a recursive relation (P-FIX) |
| `base`, `step` | E | the recursive relation `name`: start with `base`; repeat `step` applied to the rows added by the previous round (the working table, as SQL's recursive CTE does), until a round adds nothing. `mode: "union"` (default): a round adds only rows not yet present, so it terminates on finite data; `"union_all"`: every row of every round is added (bag; stopped only by the budget). `step` must mention `name` exactly once and not under an aggregate, `distinct`, or the null-supplying side of an outer join (`E_TYPE`) |
| `in` | E | the body evaluated with `bind`/`fix` names in scope |

The frame arguments are DECLARED here and nowhere else (2.5), each carried by the world, applied by the next relational operator. Sort/limit/offset are legal on any world. Examples:
```
DEF(sources; asof: "2026-11-12T18:00:00Z"; collapse: ["effective-latest"])
DEF(EVA(x; where: n > 3); sort: [_pos desc]; limit: 1)
DEF(order by at desc)                                           -- seed
DEF(first 3)                                                    -- seed
DEF(; bind: {recent: SEG(sources; kinds: ["move"])}; in: EVA(recent; where: n > 3))     -- a CTE
DEF(; fix: "anc"; base: CON(SEG(sources; ids: [#9f2c11aa]); follow: "of"; depth: 1);
    step: CON(anc; follow: "of"; depth: 1); in: anc)             -- recursive CTE
```
Write: `WRITE DEF(...)` defines something durable. Three forms: **a view** `WRITE DEF(view: "open_requests"; expr: EVA(...); params: ["since"])` (an entry of kind `view` at address `view:open_requests` whose body holds the EXPRESSION text and never its result, 4.5); **a kind** `WRITE DEF(declare: "request-raised"; like: "holon"; schema: ["reporter", "text"])` (a `kind` entry; its `cell` is COPIED from the declaration of the kind named in `like`, never typed; `like` must be declared; this is the one way EOQL grows the set of kinds); **a value** `WRITE DEF(addr; kind: K; body: ...)` for any kind declared at a DEF cell.

#### INS, instantiate [EXT on read]
Read: bring things into existence in the result, writing nothing. Three forms.
1. **Genesis**: `INS(X)`: for each slot of `X`, the entries that began it: the members with no `≺anc`-predecessor in the slot (the roots). More than one root is concurrent creation or a blind write. Answers "who created X": the roots' `_by`, `_at`.
2. **Literal relation**: `INS(; rows: [[...],[...]]; columns: ["a","b"])` a derived world of those rows (SQL `VALUES`).
3. **Hypothetical entries**: `INS(; entries: [<complete entry literals>])` a RAW world of exactly those entries (ids verified); used with `SYN ... with:` to ask "what if this entry existed" (3.7). Nothing is appended.

| clause | type | meaning |
|---|---|---|
| `rows`, `columns` | L | the literal relation (rows are lists, or objects keyed by column) |
| `entries` | L of O | complete entries (form 3) |
| `anc` | S | the ancestry basis for "root" (default the world's) |

Examples: `INS(SEG(sources; addr: "clip:7"))`; `INS(; rows: [[1,"a"],[2,"b"]]; columns: ["n","s"])`.
Write: `WRITE INS(addr; kind: K; body: ...; of: [...]; basis: {...}; as: S)` appends a new entry of a kind declared at an INS cell: the creation of a value or an entity. Example: `WRITE INS("clip:7"; kind: "request-raised"; body: {"reporter": "a"}; as: l1)`.

#### SIG, signal (attend) [EXT on read]
Read: stand somewhere. SIG changes the observer, not the data: who is looking, how much it may spend, and what it wants back.

| clause | type | meaning |
|---|---|---|
| `perceiver` | F | F6, the perceiver window |
| `budget` | F | F7 |
| `return` | S | F8 |

Examples:
```
SIG(SEG(sources; kinds: ["move"]); perceiver: {writers: ["editor-premiere"]}; budget: {records: 50000}; return: "pointers")
SIG(sources; perceiver: {horizon: #9f2c11aa})                    -- only what the writer of that entry could have known
```
Write [EXT]: `WRITE SIG(addr; kind: K; body: ...)` records an attention event of a SIG-cell kind (for example "reader R attended region A through entry E"). SIG does not itself change a log.

#### NUL, observe without transforming [seed: unbound observation; EXT clauses]
Read: `NUL(X)` is the identity on worlds (law L3): a statement that something was observed and not transformed. With clauses it reports negative space, the evidence that something is not there.

| clause | type | meaning |
|---|---|---|
| `expect` | L of S or E | addresses (or a world with an `_addr` column) that were expected: the result has one row `{_addr, _reason}` for each with no live entry in `X`, `_reason` being `never-written` \| `all-retracted` \| `out-of-window`; `_incomplete` set from 1.6 |
| `gaps` | B | one row per piece of evidence of loss in what is visible: dangling `of`/`seen` ids, corrupt and torn lines, open cuts |

Examples: `NUL(sources; expect: ["clip:7", "clip:9"])`, `NUL(sources; gaps: true)`.
Write: `WRITE NUL(target; kind: K; ...)` appends an entry of a NUL-cell kind. Its default kind is `retract` (declared at NUL·Figure by the protocol): `WRITE NUL(#9f2c11aa; why: "duplicate")` appends `{kind: retract, of: [that id], body: {"why": "duplicate"}}`, the only way anything is ever unwoven. `target` is an idref, a list of idrefs/labels, or an address string with `kind:` naming the slot (then the target ids are the current heads of the slot, read at statement time). No entry is ever edited or removed.

### 2.5 The frame arguments (8)

A frame argument is a declared parameter of how a world is read. It is set by `DEF` or `SIG`, carried by the world, applied when rows are derived (1.4), recorded in `explain.frame`, and never written to the log (a stored view stores EXPRESSION TEXT that contains them, which is syntax, 4.5). Defaults apply when unset. Repeated settings: `asof` and `perceiver` NARROW (intersection of the entry sets); `budget` takes the minimum of each field; every other argument is set by the OUTERMOST `DEF`/`SIG` that names it (it overrides inner ones).

| # | arg | verb | value | default | meaning |
|---|---|---|---|---|---|
| F1 | `asof` | DEF | a cut `C` (1.2) | the whole source | the log position: the world is the fold of the entries inside the cut. Schemas, views and kind declarations are read as of the same cut unless F2 says otherwise |
| F2 | `schema` | DEF | `"asof"` \| `"latest"` \| a cut \| `{"window": name}` | `"asof"` | which version of the ground (read schemas and kind declarations) governs the read. `"asof"` = at the cut of F1 (A5: the ground at position P, not the latest); `"latest"` = at the head of the whole log; `{"window": n}` picks the read-schema window named `n` among concurrent ones; its `collapse` supplies the default F3, its `writers`/`cut` narrow F6/F1 |
| F3 | `collapse` | DEF | list of `all history none drop-retracted latest effective-latest` | the ground's declared `collapse` for the kind, else `["none"]` | how superpositions become rows (1.3). Precedence: explicit F3 > the chosen window's > the kind's read schema > `none` |
| F4 | `anc` | DEF | `"slot"` \| `"full"` | `"slot"` | the ancestry basis for heads (1.3) |
| F5 | `ordering` | DEF | `"causal"` \| `"key"` | `"causal"` | the order used for `_pos`, sorting by position, and tie-breaks (1.7) |
| F6 | `perceiver` | SIG | `{writers?: [...], horizon?: idref \| {writer: S}, asof?: C}` | everything | the perceiver window (3.7): the sub-log a reader could know, re-folded |
| F7 | `budget` | SIG | `{entries?, bytes?, records?, rows?, steps?}` | `{records: 2000000, rows: 2000000, steps: 20000000, bytes: 536870912}` | the cost ceiling (5.2); exceeding it is `E_BUDGET`, never a truncated answer |
| F8 | `return` | SIG | `"pointers"` \| `"content"` | `"content"` | `"pointers"` returns rows reduced to `_id _slot _addr _kind _held _determined _incomplete _src`; the entries read and the plan are the same either way. The outermost setting governs the result |

Two things that look like frame arguments and are not: the counterfactual is `SEG drop` (it changes the log under consideration), and the row/entry granularity is the collapse rule list.

### 2.6 Extra primitives beyond the nine verbs and the frame arguments: the honest list

PREREG C5 and test T make this count a finding, so it is stated without disguise. A **primitive** here is anything the semantics needs that is not already (a) one of the nine verbs on read or write, or (b) one of the 8 frame arguments. Five semantic primitives and three closed vocabularies were needed:

| id | name | what it is | where | why a verb cannot supply it |
|---|---|---|---|---|
| P-FIX | fixpoint | least-fixpoint iteration: `DEF fix/base/step`, and `CON depth: "*"`, `dir: "both"`, `dir: "concurrent"` | transitive ancestry, recursive CTEs | the nine verbs compose a FIXED number of steps; closure over an unbounded chain needs iteration to a fixed point |
| P-TERM | term language | the scalar expression sub-language with three-valued logic and V1 value semantics (2.7) used in `where`, `on`, `set`, `agg`, `sort` | every predicate and computed column | verbs act on worlds; computing a value from a row's fields is a different sort of thing |
| P-PARAM | parameter | `:name` placeholders bound by the host as VALUES, never re-lexed | injection safety (test S), views with arguments | a value must enter a statement without becoming syntax |
| P-LABEL | label | `as: name` binds the id of the entry a `WRITE` appended, `@name` refers to it later in the same script | semantic dump/replay (4.6), `of:` chains within a script | ids are earned by `weave` and unknown until the write; a script must be able to refer to them |
| P-WRITE | write marker | the prefix `WRITE` selecting append semantics | the read/write split | the nine verbs have both meanings; which one is meant has to be said by something other than the verb |
| V-FN | scalar functions | the closed list in 2.7 | terms | a vocabulary, like the verbs' own names |
| V-AGG | aggregate functions | `count sum total avg min max group_concat` | `SYN agg` | vocabulary of SYN |
| V-WIN | window functions | `row_number rank dense_rank ntile lag lead first_value last_value nth_value` and the aggregates over a window | `REC set` | vocabulary of REC |

Count: 9 verbs, 8 frame arguments, **5 extra primitives and 3 closed vocabularies (8 extras)**. The number of PRIMITIVES the QA question set and the write set actually exercise is measured by test T from the explain output (which `P-*` ids appear in plans); this spec does not predict it. Things that were expressed WITHOUT a new primitive, to show where the line was drawn: joins, semi/anti joins and subqueries (CON), group-by (REC then SYN), HAVING (EVA after SYN), windows (REC), CTEs (DEF bind), set operations (SYN), DISTINCT (SYN), ORDER/LIMIT (DEF), VALUES (INS), counterfactual (SEG drop), perceiver and budget and return (SIG), as-of (DEF), views (DEF write), retraction (NUL write), log merge and fork resolution (SYN write), importing (SYN write plus `basis`).

### 2.7 The term language (P-TERM) and its vocabularies

Terms use the `expr` grammar (2.2). Precedence, high to low: unary `-`; `* / %`; `+ - ||`; comparison and `is/in/between/like/glob/contains`; `NOT`; `AND`; `OR`. Semantics are V1 (1.4.5) and SQL's three-valued logic. `||` is text concatenation (NULL if either side is NULL). `like` is SQL `LIKE` with ASCII case-insensitivity, `%` and `_`, optional `escape`; `glob` is case-sensitive with `*` `?` `[...]`. There is NO regex operator (a user-supplied regex is a denial-of-service vector). `contains` is case-insensitive substring on text renderings. `x is set` is `x is not null and x != ""`. `in` takes a list, a one-column world, or a param bound to a list. A parenthesised WORLD expression in term position is an UNCORRELATED scalar subquery: it is evaluated once, its value is the first column of its first row, NULL if it has no rows (SQLite's rule); it may not mention the row being evaluated (`E_BIND_NAME`). It is sugar for a cross `CON` with a one-row world and adds no primitive.

**V-FN, scalar functions (closed list, versioned `eoql-fn/1`):** `abs ceil floor round(x[,n]) sign length lower upper substr(x,start[,len]) instr replace trim ltrim rtrim(x[,chars]) least greatest coalesce nullif iif(p,a,b) case(p1,t1,p2,t2,...[,else]) cast(x,"integer"|"real"|"text") typeof nocase json_get(x,"$.a.b[0]") json_array_length json_valid nulleq(a,b) date time datetime strftime(fmt,x)`. `nulleq` is null-safe equality (SQLite's `IS`). `least`/`greatest` are SQLite's multi-argument `min`/`max` (NULL if any argument is NULL). The date functions accept only ISO-8601 `YYYY-MM-DD[THH:MM:SS[.fff]][Z]` text (what `at` holds) and the specifiers `%Y %m %d %H %M %S %f %j %w %s %%`; any other input or specifier yields NULL. There is no `now()` or `random()`: evaluation is deterministic (law L1).
**V-AGG:** `count(*) count(x) count(distinct x) sum(x) total(x) avg(x) min(x) max(x) group_concat(x[,sep])` (default separator `,`; input order). `sum` of integers is an integer (overflow `E_RANGE`), `total` is always real, `avg` always real, `min`/`max` skip NULLs, `count(x)` counts non-NULL, an aggregate over an empty group is NULL (`count` 0).
**V-WIN:** the window functions above and `sum count avg min max total` used with `by`/`order`/`rows` of a REC. `rank` and `dense_rank` use peers = equal `order` tuples; `ntile(n)` per SQLite; `lag/lead(x[,offset[,default]])`.

---

## 3. Semantics

### 3.1 Evaluation model

An expression denotes a world; evaluation is inside-out and observably equivalent to the equations of 3.2 (an implementation may be lazy, push work into a store, or reorder, if every observable output agrees; the observable outputs are the envelope's `rows`, `row_meta`, `held`, `determined`, `incomplete`, `columns`, plus `explain.entries_read`, which must be honest, 5.1). `D(R)` below means the derived world whose rows are `R`. `E_X` is the entry set of a raw world `X`, `F_X` its frame, `Φ(E)` the fold state of an entry set (1.2). A **plan** is the tree of the verb calls with the access method chosen for each source read; its node shape is `eoql-plan/1`: `{id, verb, clauses, access:{method:"region"|"lane"|"range"|"scan"|"fold"|"table", addr?, kind?, writer?, files?}, rows_out, notes:[...]}` where `notes` can include `order:global` (a whole-log read for `pos`), `anc:full` (cross-slot reads), `pushed:[asof|addr|kinds]`.

Pushdown rules (conformance, since they decide cost and, for 3.4 L2, honesty): `asof`, `addr` and `kinds` selectors (slot-closed) MAY be pushed into the source read. A `writers`, `ids`, `where` or `drop` selector MUST be applied AFTER the slot is read and BEFORE heads are computed (it changes heads); it MAY narrow which files are opened. An `EVA` predicate on `_addr`/`_kind` is slot-closed and MAY be pushed below the fold; a predicate on `_by`, `_id`, `_held`, body columns MUST NOT (it would change the answer).

### 3.2 Equations (fold state in, fold state out)

With `X, Y` worlds and `rows(.)` of 1.4:

```
[[sources]]                      = (Φ(E_S), F0)                                      S the handle's source
[[NUL(X)]]                       = [[X]]
[[NUL(X; expect: A)]]            = D({ (a, reason(a)) : a ∈ A, no live entry of X at addr a })
[[NUL(X; gaps: true)]]           = D(evidence rows of 1.6 over X)
[[SEG(X; keep K; drop D)]]       = (Φ(restrict(E_X, K, D)), F_X)                   X raw
[[SEG(X; ...)]]                  = D({ r ∈ rows(X) : K(r) ∧ ¬D(r) }), no cascade    X derived (row filter on _addr _kind _by _id and columns)
[[SEG(X; table: T)]]             = D(catalog(T, X))                                  (1.8), X raw
[[SIG(X; perceiver P)]]          = (Φ(vis_P(E_X)), F_X)                              X raw
[[DEF(X; frame args)]]           = (Φ(cut_c(E_X)), F_X ⊕ args)                       X raw; E_FRAME_DERIVED otherwise
[[DEF(X; sort s; limit n; offset m)]] = D(window(sort(rows(X), s), m, n))
[[DEF(; bind B; in e)]]          = [[e]] in the environment B (names -> worlds; no recursion, no capture of ctx)
[[DEF(; fix v; base b; step s; in e)]] = [[e]] with v bound to the limit of  acc0 = delta0 = b;  delta(n+1) = s(delta n) \ acc n (union) or s(delta n) (union_all);  acc(n+1) = acc n ∪ delta(n+1);  stop when delta is empty (E_BUDGET if it never is)
[[EVA(X; where p)]]              = D({ r ∈ rows(X) : p(r) = true })
[[REC(X; ...)]]                  = D(pick(rename(set(window(rows(X), by, order))))), same rows, same count
[[SYN(X; by g; agg a)]]          = D({ (g(r), a(G)) : G a block of rows(X) with equal g })    (first-occurrence order)
[[SYN(X; with Y)]]               = (Φ(E_X ∪ E_Y), F_X)                               both raw (union by id)
[[SYN(X; with Y; mode m)]]       = D(rows(X) m rows(Y)) by value                      m ∈ union, union_all, intersect, except
[[CON(X; to Y; on p; join j)]]   = D(join_j(rows(X) as l, rows(Y) as r, p))
[[CON(X; follow f; dir d; depth n)]] = D(walk(E_in, seeds = rows(X), f, d, n))        3.8
[[INS(X)]]                       = D({ root rows of each slot of X })                 genesis
[[INS(; rows R; columns C)]]     = D(R as rows over C)
```
`restrict(E, K, D)` = `{e ∈ E : K(e) ∧ ¬D(e)}` minus, if `cascade` is `"of"`/`"full"`, every entry that reaches a dropped entry by `of` / `of ∪ seen` (computed in `E`). `vis_P` is 3.7. `cut_c` applies a cut (1.2) and the fold is recomputed on the restriction.

A raw world's `rows(.)` depends on its frame; a derived world's rows are fixed. `window` applies `limit`/`offset` after `sort`; an absent `sort` keeps input order. `join` keeps left-major order. Row multiplicity follows SQL (bags) except where a mode says set.

### 3.3 Closure

(C3) Every expression is a world; every world is a legal input (T1 aside); `D(.)` rows round-trip through `rows` unchanged. The library offers `openWorld(w)` (7.1), a handle whose `sources` is that world, so closure is testable by composition: for expressions `q1`, `q2`, `run(openWorld(world(run(h, q1))), q2)` has the same `rows`, `held`, `determined` as `run(h, compose(q2, q1))` where `compose` substitutes the name `sources` in `q2` by `q1`. And (law L2) a result equals the fold of the entries it read.

### 3.4 Laws claimed, each with a test sketch

Each law says what is claimed and how it can fail. T should write each as a property test over random expressions and the planted logs (forks, retractions, late arrivals, ties, clock skew against `of`). A law that fails is reported as failing; none is claimed beyond its stated scope.

* **L1 determinism.** For fixed source entries, text, params and options, `run` returns a canonical-JSON-identical envelope (explain counters included; there are no timestamps). Sketch: run twice, in two processes, in two orders; compare bytes.
* **L2 fold-faithfulness.** Let `R` be `explain.entries_read` of `run(h, q)`. Then `run(openEntries(R), q)` has the same `rows`, `row_meta.held`, `determined`. (`incomplete` may differ only by evidence that depends on files not in `R`.) Sketch: 1,000 random expressions over the replay and synthetic logs; any difference means an unread entry influenced the answer, or `R` is dishonest (mutant M12).
* **L3 NUL.** `NUL(X) = X` on worlds. Sketch: structural equality of envelopes.
* **L4 SEG.** (a) idempotent; (b) `SEG(SEG(X, k1), k2) = SEG(X, k1 ∧ k2)` for keep selectors, and drop selectors without cascade compose by union; (c) entries(`SEG(X)`) ⊆ entries(`X`); (d) a slot-closed SEG (selectors `addr`, `kinds` only) COMMUTES with row operators: `EVA(SEG(X,c), p) = SEG(EVA(X,p), c)`, the same for `REC` and for `DEF sort` (but not for `DEF limit/offset`, which depend on the rows that remain); (e) a SEG on `writers`, `ids`, `where` or `drop` does NOT commute with `EVA` or with collapse in general: this is not a law, and T SHOULD include the planted case (fork between two writers) that makes `EVA(SEG(X, writers W), p) != SEG(EVA(X, p), writers W)`. Claiming (e) as a law is a mutant.
* **L5 EVA.** `EVA(EVA(X,p),p) = EVA(X,p)`; `EVA(X, p AND q) = EVA(EVA(X,p),q)`; `EVA(X, p OR q)` = rows satisfying either (set union of rows, input order kept); `EVA(X, true) = X`; for every row exactly one of `p`, `NOT p`, `p is unknown` holds (three-valued partition). Sketch: random predicates over rows with NULLs.
* **L6 REC.** Preserves row count, order, `_held`, `_slot`, `_src`, `_incomplete`; `REC` then `SYN(count)` equals `SYN(by)` grouping; `pick` after `set` equals `set` of only the picked.
* **L7 SYN.** (a) log merge is commutative, associative, idempotent, with the empty world as identity, and equals pharos `merge` as a SET of ids; (b) **SYN of SYN**: for the distributive aggregates `count, sum, total, min, max`, aggregating blocks of partial aggregates with `sum, sum, sum, min, max` equals aggregating the whole (`avg` is `sum/count` of the partials; `group_concat` is not decomposable and is excluded); (c) `held` of an aggregate row is the max of its sources'.
* **L8 DEF as-of.** (a) `asof(c1)` composed with `asof(c2)` is `asof(c1 ∩ c2)` (for nested cuts, the smaller); `asof(everything) = identity`. (b) **Monotonicity of what is visible**: for causally closed cuts `c1 ⊆ c2`, `E1 ⊆ E2`, the ancestors of each `e ∈ E1` are the same in both, and `dangling(E1) ⊆ dangling(E2)`. (c) Heads, held counts and liveness are NOT monotone (a later write resolves a fork; a later retraction hides a value); T SHOULD plant both so a "cache the earlier answer" shortcut fails. (d) **Late arrival**: the answer at a cut is a function of exactly the entries inside the cut: append arbitrary entries outside the cut and the answer at the cut does not change; an entry with `at` inside the cut that arrives late DOES change it (the cut is by position, not by arrival). (e) the ground follows the cut (F2 `asof`): at a cut before a schema change, the old schema applies (mutant Z1 of pharos-lazy A5, here M4's sibling).
* **L9 collapse.** For every slot: `ids(latest) ⊆ ids(none) ⊆ ids(history) ⊆ ids(all)`; `_held` under `latest` equals `_held` under `none`, and under `effective-latest` equals `_held` under `drop-retracted`; `latest(rows under none) = rows under latest`. Collapse never writes: source bytes are unchanged (hash before and after). Mutant M2 is a collapse that does not say so: whenever a collapsing rule discards values, `explain.frame.collapsed = {rule, slots_collapsed, values_discarded}` MUST be present and `values_discarded = Σ(_held - 1)`.
* **L10 retraction.** After `WRITE NUL(t)`: `t` is retracted; under `drop-retracted` its predecessor is exposed; a later `WRITE NUL(<the retraction>)` restores `t`; under `all` and `history` the retraction and `t` remain visible (nothing is deleted). Ignoring retractions (M3) fails the first clause.
* **L11 counterfactual purity.** Every read leaves every source's bytes unchanged (compare file hashes, sqlite file hash, block store hashes before and after). `SEG(X; drop: D)` equals the same query run on a physically separate copy of the source from which `D` (and, with cascade, its descendants) was removed (mutant M13: a counterfactual that mutates).
* **L12 perceiver.** (a) `SIG(X; perceiver: {writers: W})` equals `SEG(X; keep: {writers: W})`; (b) a perceiver naming all writers is the identity; (c) `perceiver: {horizon: #e}` has exactly the entries `{e} ∪ {x : x ≺full e}`; (d) it differs from `EVA(_by in W)` on planted forks (3.7). A perceiver that lets a hidden writer's `of` supersede a visible value (M5) fails (c)/(d).
* **L13 held, determined, incomplete.** For every returned slot: `_held` equals the number of heads under the frame as computed by an independent forward fold (frozen library for `anc: full`, own scan for `slot`); `_determined = 1 ⟺ _held = 1 ∧ ¬_incomplete`; the episodes equal pharos-lazy `conflicts` episodes. An answer never reports a single value for a held slot unless the collapse rule was asked for, and then `held` still says how many were discarded.
* **L14 ancestry.** `CON follow` closure is idempotent and monotone in `depth`; `dir:"both"` = `up ∪ down`; `dir:"concurrent"` = `E \ (up ∪ down ∪ {seed})`; `_branch` is a partition: entries with a single branch id are exclusive to that seed's ancestry, entries with several are shared.
* **L15 write/read.** A `WRITE` appends entries only: for every existing file, the bytes before the append are unchanged (prefix hash); a read at a later cut sees the new entry; a write at an earlier `asof` is not a thing (writes always happen at the head, `asof` frames do not apply to `WRITE`).
* **L16 replay.** `dump(verbatim)` replayed into an empty pharos yields the identical id set; `dump(semantic)` replayed into a pharos that declares the same kinds yields an isomorphic log (same kinds, addresses, bodies, `of` structure up to the `as`/`@` renaming), and different ids (their `at` and `seen` are computed again).
* **L17 flow.** For every id-lossless ordered pair in 6.2, A→B→A returns the identical id set and field values.
* **L18 SQL containment.** For every supported SQL query `q` over the catalog, `run(h, translate(q))` equals SQLite's result of `q` on the projection (set equality, or row order too if `q` has `ORDER BY` on a total key).
* **L19 safety.** `parse` is total (returns an AST or throws `EoqlError` with a position, never anything else, never loops); a read-mode run never appends; text inside a string value is never executed (the dump of a body that contains `; WRITE NUL(#...)` replays to a string).
* **L20 budget soundness.** Counters only grow; the run stops with `E_BUDGET` at the first check after a counter exceeds its limit; checks happen at every source record read and every row emitted, so overshoot is at most one record or one row; a `E_BUDGET` result carries no rows.
* **L21 adapter independence.** The same entry set in `lib:`, `lazy:`, `blocks:`, `sqlite:` and `mem:` gives identical `rows`, `row_meta`, `held`, `determined`, `incomplete.over[*].reason` set for every expression; only `explain` differs.
* **L22 parse/print.** `parse(print(ast)) = ast`; `print` is canonical (4.5) and its SHA-256 is the expression hash; every seed string that `eoqlParse` bound without a gap parses and agrees with the seed's `eoqlMatch` on random records, except D1 to D3.
* **L23 provenance honesty.** `explain.entries_read` equals the set of entries the adapter actually delivered (its own counter), and contains every id in every `_src` of the result (mutant M12).

### 3.5 Collapse, and the wave fold

This is the wave fold of the EO wiki (the integral model: Given-Log, Horizon, DEF carried as a superposition) read as an engineering contract. Its three commitments appear here as: (1) the log is primary and every value is a fold of it (1.2, C1); (2) the accumulator carries `n >= 2` simultaneously valid values without resolving them on write (heads, held counts, episodes, 1.3; no write form resolves anything, and a fork ends only when someone WRITES a `SYN` whose `of` names the heads); (3) collapse happens at projection, never at emit (F3). The wiki's "the Horizon is a query, not a data structure; it produces no log entry when evaluated" is the denotation of a world and the read/write split of 4.1; "time-travel is free" is F1; "windowed interpretation" is F2 and F6. One divergence is flagged (open question 6): the wiki says NUL emits nothing, the protocol makes `retract` a NUL cell.

Collapse is a parameter of the projection (F3), applied when rows are derived, never stored, never written. There is no write form that accepts a collapse rule. `held` is reported with every collapsed answer (the survivor count is the readout, pharos-lazy A6 R-count) and `explain.frame.collapsed` states what was discarded. The reading of a kind may be DECLARED by its read schema (`WRITE REC("schema:K"; kind: "schema"; of: heads; body: {"read": {"collapse": ...}})`), which is how "how we WANT to read it" is itself an addressable event; a frame argument overrides it (F3 precedence).

### 3.6 Determined, held, incomplete (operational summary)

For a result row: `held = 1` and `incomplete = false` gives `determined: true`. A value that came from a collapse of two or more heads is returned WITH `_held >= 2` and `determined: false`, whatever rule picked it. An empty result is `determined: true` only if the evidence list of 1.6 is empty. A void slot (every member retracted) under `drop-retracted` yields no row and an entry `{reason:"void", slot}` in `explain.findings`; it is not an empty determined answer for that address, and `NUL(X; expect: [addr])` reports it as `all-retracted`.

### 3.7 Counterfactual and perceiver windows

**Counterfactual.** `SEG(X; drop: D)` re-folds the log without `D`. Nothing is mutated (L11). "What would be held at `a` if writer `w` had never written?" is `SEG(sources; drop: {writers: ["w"]}; addr: "a")`. "What if this extra entry existed?" is a READ merge with a hypothetical world: `SYN(sources; with: INS(; entries: [<entry literal>]))`, where `INS(; entries: [...])` is a raw world made of those complete entries (each validated like any entry: id must match its content), nothing appended. It is the read form of the `entries:` clause that the write form of SYN uses in 4.6.

**Perceiver (F6).** `vis_P(E)` is the entries a reader with perceiver `P` could know:
* `writers: W`: `{e ∈ E : e.by ∈ W}`;
* `horizon: #e`: `{e} ∪ {x : x ≺full e}` (what the writer of `e` could have known when it wrote it: the causal past; concurrent entries are NOT in it, which is how "what was in flight with it" is its complement, `CON ... dir: "concurrent"`);
* `horizon: {writer: w}`: the union of the pasts of all entries by `w`, with those entries;
* `asof: C`: the cut;
* several keys: intersection.
The visible sub-log is RE-FOLDED: entries it cannot see are absent, ids they would have supplied in `of`/`seen` are dangling (counted in `explain.frame.perceiver.unseen_refs`, not `incomplete`: from inside the window the missing entries are simply unknown, which is the point). Planted contrast (RULINGS-STAGE1 W8e): at address `a`, `x` (writer 1), then `y` (writer 2, `of:[x]`), then `z` (writer 1, `of:[y]`). The full fold has one head, `z`. The filter `EVA(_by is w1)` on it returns `z` alone, `_held` 1 (ancestry as the log has it: `z` dominates `x` through `y`, so `x` is not a head). The perceiver `{writers:["w1"]}` returns the heads `{x, z}`, `_held` 2: a reader who sees only writer 1 cannot know that `z` answered `x`. Both are correct answers to different questions; the share of addresses on which they differ (the earlier measure was 52 of 247 on the replay) is test T(b).

### 3.8 Ancestry, transitive `CON`, conflict awareness

`CON(S; follow: f; dir: d; depth: n; in: R)`: let the edge relation be `of`, `seen`, `full` (= `of ∪ seen`) or the links of kind `rel`, all computed within `R` (a raw world, default `sources`). Up edges go from an entry to the ids it names; down edges are their inverse. Starting from the seed set `S` (the `_id`s of the rows of the input), repeat for `n` steps (or to a fixed point if `n = "*"`, P-FIX): add all entries reached; each reached entry records `_depth` (least step count), `_branch` (set of seeds from which it was reached), and the conflict labels of 2.4 computed from the episodes of its slot (1.3). `until` stops expansion beyond a satisfying entry, but the satisfying entry is returned. `dir:"concurrent"` is `R \ (up ∪ down ∪ seeds)` for the closure at `n = "*"`. Dangling targets are not entries; they are listed in `explain.findings` as `{reason:"dangling", ids}` and make the result `incomplete` (1.6.2).
"Ancestry with conflict awareness" means: a walk through a fork explores every head, never one; each reached entry says whether it was one of several concurrent values (`_fork`, `_siblings`) and which seed it belongs to (`_branch`); the part of the ancestry that is exclusive to one branch is exactly the part with a single `_branch` id. The envelope is `determined: false` iff some returned row's slot is held.

### 3.9 As-of and the ground

`DEF(X; asof: C)` restricts the entries as in 1.2 and, unless `schema` says otherwise, reads the ground (kind declarations, read schemas, view definitions) as of the same cut: a view defined after `C` does not exist at `C`; a schema changed after `C` does not govern it. `schema: "latest"` is the explicit way to read the past with today's ground, and is reported in `explain.frame`. Two concurrent read schemas of a kind are two windows: without a `{window: n}` the later by `ordering` is used, the envelope is `determined: false`, and gap `W_SCHEMA_HELD` is raised.

---

## 4. Writes

### 4.1 Modes

Read-only is the default everywhere. A `WRITE` statement runs only if ALL of these hold; otherwise the whole script is refused with `E_READONLY` BEFORE any statement runs (plan-time check; nothing is evaluated, nothing appended):
1. the handle was opened for writing: `open(uri, {mode: "write", writer: W})` (CLI `--write --writer W`); a read handle opens files read-only (`fs` flag `r`, sqlite `readOnly`) so a bug cannot append;
2. the run asked for write mode: `run(h, text, {write: true})` (CLI `--write`);
3. the source is a primary store that accepts weaves (`lib:` and `lazy:`). `blocks:` accepts only verbatim merges (4.6) through its own ingest; `sqlite:` is a projection and is never written (`E_NOT_PRIMARY`); the HTTP server has no write path at all.

A script is validated whole first (parse, bind, kinds declared, verb/kind agreement, no computed fields, labels defined before use, `of` ids resolvable, view bodies well formed) and only then executed in order. If an execution step fails (I/O), the statements before it stay appended (the log is append-only; there is no rollback), the receipt says `stopped_at`, and the failure is a typed error. The writer name is `[A-Za-z0-9._-]+` and a handle appends only to its own writer's file/directory.

### 4.2 The shape of a write statement

```
WRITE VERB( target ; kind: K ; body: J ; of: O ; basis: B ; as: L ; <verb sugar> )
```
| clause | meaning |
|---|---|
| `target` (first segment) | the address string (a term, constant after param binding) the entry is about; for `NUL` see below; for `SYN ... entries:` absent |
| `kind` | the kind of the entry (S). Must be declared (the protocol kinds `frame kind holon retract` always are). `E_UNDECLARED_KIND` otherwise |
| `body` | a constant JSON term (literals, lists, objects, params, labels as their id strings); default `null` |
| `of` | list of idrefs, labels or params, or the words `heads` (the heads of the slot `(target, kind)` under `collapse: none`, `anc: slot`, as `placed.weave` reads them) or `live-heads` (the heads under `drop-retracted`); default `[]`. Unknown ids: `E_BAD_OF` where the source can look an id up (`lib:`, `mem:`, `blocks:`, `sqlite:`); on `lazy:` an id not produced by this script or by `heads` is accepted with gap `W_OF_UNCHECKED` (the fold will report it dangling if wrong) |
| `basis` | an object (the priors and instrument versions the writer stood on); default `{}`. EOQL adds NOTHING to it on a plain write, so the entry equals what a direct `weave` with the same fields makes (test F2) |
| `as` | a label for the new entry's id (P-LABEL) |

**Cell by declaration.** `cell = declaration(kind).cell` (1.1). The verb written MUST equal `op(cell)`: `WRITE INS(...; kind: K)` where `K` is declared at an EVA cell is `E_VERB_KIND` (the message names the declared operator). So the verb in a write is not a free choice: it is checked against what the log says the kind is. The protocol's own kinds agree with this (retract is NUL, kind declaration is DEF, frame is NUL, holon is DEF). A cell literal anywhere in a statement is `E_CELL_TYPED`; the keys `v id by at seen` are `E_COMPUTED_FIELD` (they are computed by `weave`: `seen` is the writer's frontier, `at` the write time, `by` the writer).

Per-verb conventions (the rest is the common shape):

| verb | principal | extra clauses | default kind | entry |
|---|---|---|---|---|
| `NUL` | idref(s)/labels (list), or an address with `kind:` (then: the current heads of that slot) | `why` S, `addr` S | `retract` | `of` = the target ids (required, nonempty); `addr` = the TARGET'S address (a retraction at another address is invisible to a region read of the target, pharos-lazy 5): taken from the address form, from `addr:`, or looked up from the first target where the source can look an id up; on `lazy:` with bare ids and no `addr:` it is `E_BAD_OF`. Body `{"why": S}` or the given body |
| `SIG` | address | | none | as common |
| `INS` | address | | none | as common |
| `SEG` | address | `into` S | none | body gets `into` |
| `CON` | from-address | `to` S (required), `rel` S | none | body gets `to`, `rel` |
| `SYN` | address | `entries` (form b) | none | with `of: heads` the merge entry that ends a fork; `entries` merges complete entries (4.6) |
| `DEF` | address | `view`, `expr`, `params` / `declare`, `like`, `schema` | none (`view` and `kind` for the special forms) | see 4.5 and below |
| `EVA` | address | | none | usually `of` = what was judged |
| `REC` | address | | none | usually `of` = what is reinterpreted |

`WRITE DEF(declare: N; like: K2; schema: ...)`: appends `{kind: "kind", addr: "kind:N", body: {name: N, cell: <the cell of K2's declaration>, schema: ...}}`. `K2` must be declared; the cell is copied from the log, never typed; if `N` is already declared at another cell the library refuses (`KIND_REDECLARED`, surfaced as `E_VERB_KIND`). This is the only route by which EOQL grows the set of kinds, and it is how an empty pharos is bootstrapped from the protocol kinds: `WRITE DEF(declare: "view"; like: "holon")`.

**Weave semantics are inherited, not re-implemented.** On `lib:` a write is the frozen library's `weave` (frame and declared-kind checks, re-weaving identical content from the same writer is a no-op that returns the existing entry, reported as a `noop`); on `lazy:` it is `placed.weave` (not idempotent: the same input twice gives two entries when `at` differs). Duplicates by id collapse at read. A blind write (empty `of` at a slot that already has entries) is allowed, produces a fork (held), and is reported as gap `W_BLIND_WRITE` when the handle already knows the slot (it never reads just to warn).

### 4.3 The receipt

```
{ "v":"eoql-receipt/1", "mode":"write", "writer":W, "target":URI, "statements":n,
  "appended":[{"stmt":i,"id":ID,"kind":K,"cell":C,"addr":A,"by":W,"at":ISO,"of":[...],"shard":"..."?}],
  "noops":[{"stmt":i,"id":ID,"reason":"identical-weft"}],
  "merged":[{"stmt":i,"id":ID,"status":"added"|"present"}],      -- verbatim merges
  "labels":{"name":ID}, "warnings":[{"code":"W_...","stmt":i}],
  "stopped_at":null|i, "cost":{...} }
```

### 4.4 Retraction instead of deletion

No statement edits or deletes an entry or a byte. `WRITE NUL(...)` appends a `retract` entry; the fold marks the target retracted; the rules `drop-retracted`, `history` and `effective-latest` hide it, and `none` and `all` still show it, flagged. A retraction can itself be retracted (the target is restored). There is no `UPDATE`: a new value is a new entry whose `of` names what it answers; there is no `DELETE`: it is `NUL`. The SQL translator maps INSERT and DELETE this way and refuses UPDATE (8.5).

### 4.5 Views: the expression, never the answer

A **view** is an entry of kind `view` (declared by the log's owner; `E_UNDECLARED_KIND` with the hint `WRITE DEF(declare: "view"; like: "holon")` otherwise), at address `view:<name>`, with body EXACTLY:

```
{ "name": N, "expr": "<canonical text>", "expr_hash": "<sha256 of expr>", "params": ["p",...], "lang": "eoql/1" }
```
Any other key, or a body over 65,536 bytes, is `E_VIEW_BODY`; in particular no field can hold rows, counts or any result (mutant M6). `expr` is the CANONICAL PRINT of the parsed expression (verbs upper case; no glyphs; clauses in the table order of 2.4; one space after `;` and `:`, `, ` between members; strings double-quoted with JSON escapes; numbers as canonical JSON; minimal parentheses by precedence; members of `set`, `agg`, `bind`, `rename`, `pick` and `sort` keep their written order because it is column or evaluation order; JSON-data objects (`body`, `basis`, `keep`, `drop`, `perceiver`, `budget`) print with keys sorted). `expr_hash = sha256(utf8(expr))`; the same function hashes any expression (`explain.expr_hash`).

Use: a view named `n` is called `n(p: value; ...)` (or just `n` with no params) in world position. Resolution happens AT THE FRAME'S CUT (3.9): the definition in force at the cut. A view's text may refer to `sources`, to other views, and to its params (`:p`). Expansion is inlining (law: a view of a view equals the inlined expression), nesting is limited to 16 (`E_LIMIT`), a cycle is `E_CYCLE`. Redefinition is `WRITE DEF(view: n; expr: ...; of: heads)`; two definitions with no `of` are concurrent: the view is HELD, resolved with `latest` and flagged (`determined: false`, gap `W_VIEW_HELD`). A view is retracted by `WRITE NUL`. A changed log changes a view's result with no new weave; a stored view is therefore a statement about how to read, in the same sense as a read schema.
Example:
```
WRITE DEF(view: "open_requests"; expr: EVA(DEF(SEG(sources; kinds: ["request"]); collapse: ["effective-latest"]); where: status is open AND _at >= :since); params: ["since"]);
open_requests(since: "2026-11-01T00:00:00Z")
```

### 4.6 Verbatim merge and the dump format

**Verbatim merge** `WRITE SYN(; entries: [E1, E2, ...])` (a write form of SYN: merging inputs into a whole). Each `E` is a complete entry object. The statement verifies each (`invalid()` rules; `id` recomputes, else `E_ID_MISMATCH`), skips those already present (`status:"present"`), and appends the rest as canonical lines to the writer's own file, keeping their `by`, `at`, `seen`, `id` as DATA (they are the entries' facts, not choices of this statement; no cell is chosen). The result is union by id: idempotent, commutative, associative (pharos `merge`). `blocks:` accepts only this form. The fold, not the merge, reports kind/cell disagreement and dangling references.

**Dump** `dump(h, {mode, scope})` writes a replayable script; the first line is a comment `-- eoql-dump/1 mode=<m> entries=<n> ids_sha256=<hex>` where the digest is SHA-256 of the sorted entry ids joined by `\n`. `scope` is any world expression (default `sources`): what is dumped is the entry set of that raw world. Statements are in `pos` order (every `of` target precedes its entry), each ends with `;` and a newline. The output is deterministic (law L1).
* `verbatim` (lossless): one statement per entry: `WRITE SYN(; entries: [<canonical entry JSON>]);` Replayed into an empty pharos it gives the identical id set. The frame entry of the target (every pharos has one) is not replaced; a dumped `frame` entry arrives as one more frame (the library reports two frames as merged, not a conflict).
* `semantic` (lossy, portable): one statement per entry, `WRITE <op(cell)>(<addr>; kind: <kind>; body: <json>; of: [@e<i>,...]; basis: <json>; as: e<n>);` where `<n>` is the entry's 1-based index in the dump and `@e<i>` the label of an `of` target present in the dump. `retract` entries become `WRITE NUL([@e<i>,...]; kind: "retract"; body: <json>; as: e<n>)`. `kind` entries become `WRITE DEF(declare: N; like: K2; schema: ...)` where `K2` is a protocol kind or an earlier kind of this dump with the same cell; if none has that cell, the declaration is NOT expressible (cells are never typed): a comment line `-- not expressible: kind N` is written and the manifest lists it. `frame` entries are not replayed. `of` ids not in the dump are dropped with a comment `-- dropped of: <ids>`. `seen`, `at`, `by`, `id` are not carried: replay recomputes them, so ids differ. Its loss manifest (6.2) lists: ids, seen, at, by, frame, undeclared-cell kinds, dropped `of`, extra fields.
All strings are written as JSON strings (UTF-8, `\"`, `\\`, `\n`, `\uXXXX` for controls); the replay lexer respects them, so a body containing `; WRITE NUL(#...)` is one string and never a statement (mutant M14). Values enter a statement only through the tokenizer or as params; there is no text interpolation anywhere in the library, the CLI or the translator.

---

## 5. Result envelope, cost, errors

### 5.1 The envelope

`run` returns, for a script of one statement, that statement's object; for several statements `{"v":"eoql-result/1","statements":[...]}` in order. A read statement gives:

```
{ "v":"eoql-result/1",
  "columns":[{"name":..., "type":"integer"|"real"|"text"|"json"|"null"|"mixed"}],
  "rows":[ {col: value, ...}, ... ],            // objects, keys in column order; V1 values; JSON values as JSON
  "row_meta":[ {"held":n, "determined":bool, "incomplete":bool, "src":[ids], "slot":[addr,kind]|null}, ... ],   // aligned with rows
  "value": <v>,                                  // present iff 1 row and 1 column
  "held": {"slots":n, "max":n, "extra":n},       // 1.6
  "determined": bool,
  "incomplete": null | {"over":[{"reason":..., "where":..., "ids":[...]?}]},
  "gaps":[{"code":"W_...", "detail":..., "count":n?}],
  "explain": {
    "expr":"<canonical text>", "expr_hash":"<sha256>",
    "frame":{"asof":..., "schema":..., "collapse":[...], "anc":..., "ordering":..., "perceiver":..., "budget":..., "return":...,
             "collapsed":null | {"rule":[...], "slots_collapsed":n, "values_discarded":n},
             "perceiver_info":null | {"unseen_refs":n}},
    "plan":[ <eoql-plan/1 nodes, 3.1> ],
    "entries_read":{"count":n, "ids":[...] | null, "digest":"<sha256 of sorted ids joined by \\n>"},
    "bytes_read":n, "records_read":n,
    "verbs":{"EVA":n,...}, "primitives":["P-TERM",...], "extensions":["SIG","INS","NUL"...],
    "order_basis":"causal"|"key", "findings":[...], "source":{"uri":..., "kind":...} },
  "cost":{"entries":n, "bytes":n, "records":n, "rows":n, "steps":n, "budget":{...}, "exhausted":false} }
```
Rules:
* With `return: "pointers"`, `rows` keeps only `_id _slot _addr _kind _held _determined _incomplete _src` (bodies omitted); `row_meta` is unchanged.
* `explain.entries_read` is what the ADAPTER delivered, taken from the adapter's own counters, not derived from the result (mutant M12). `ids` is the full sorted list (complete lists are needed for L2); the option `explain: "brief"` replaces it by `null` above 100,000 ids, keeping `count` and `digest`. `bytes_read` and `records_read` are the adapter's counters (bytes returned by file reads; lines/rows/blocks parsed), schema and ground reads included.
* `explain.verbs` counts verb calls per verb, `explain.primitives` lists the `P-*`/`V-*` ids that occurred (2.6), `explain.extensions` lists the EXT uses (2.4): these feed test T (a) and (c). They are computed from the plan, not from the text.
* `explain.findings` carries void slots, dangling ids, inversions, unexpressible things; `gaps` carries typed warnings: `W_NO_FIELD W_GLYPH W_ORDER_KEY W_SCHEMA_HELD W_VIEW_HELD W_BLIND_WRITE W_OF_UNCHECKED W_CUT_OPEN W_ANC_SLOT W_LOSSY W_UNRESOLVED_REF`. `W_ANC_SLOT` is emitted whenever `anc: slot` (the default) produced `_held >= 2` for a slot that has an `of` or `seen` link leaving the slot, meaning `anc: full` could answer differently.
* The envelope contains no timestamps, hostnames or paths other than the source URI as given: L1.
* `incomplete`, `determined`, `held` are those of 1.6. A result never says `determined: true` with `incomplete` non-null.

### 5.2 Cost and budget

Counters, all integers: `entries` (distinct entry ids materialized), `bytes` and `records` (the adapter's), `rows` (rows emitted by every operator, intermediate ones included), `steps` (term-node evaluations, comparisons, graph edges traversed, fix iterations). The budget (F7) bounds any of them; the defaults are `{records: 2000000, rows: 2000000, steps: 20000000, bytes: 536870912}` and apply to every run, so no run is unbounded. The host (the `budget` run option, CLI `--budget`, `serve --budget`) may raise or lower any of them; an expression can only LOWER them: a `SIG budget` inside it combines with the host's by minimum per field. Checks run at every record read and every row emitted (L20). On excess the run stops with `E_BUDGET` whose detail is `{counter, limit, spent, node}`; there is no partial result and no truncated rows (a runaway query is an error, never a wrong answer). The HTTP server additionally refuses results over 200,000 rows (`E_BUDGET`, counter `result_rows`). Cost bound on stores (R, reusing pharos-lazy W3): an expression made only of slot-closed selectors (`addr`, `kinds`), `anc: slot`, and no `_pos` use reads at most the shard bytes of the addresses named plus the schema chain; this is a property of the plan (`access.method:"region"`), measured by `bytes_read` against the source size.

### 5.3 Typed errors

`EoqlError` has `code`, `message`, optional `pos` (character offset, for syntax), optional `detail` (JSON). The CLI prints `{"error":{code,message,pos?,detail?}}` on stderr, exit 1 (2 for usage).

| code | meaning |
|---|---|
| `E_PARSE` | syntax error; `pos`, `detail.expected` |
| `E_LIMIT` | length, token count, nesting, view nesting or result size limit |
| `E_UNKNOWN_VERB`, `E_UNKNOWN_CLAUSE`, `E_BAD_CLAUSE_VALUE` | the call or clause is not in 2.4 |
| `E_UNKNOWN_FUNC`, `E_ARITY`, `E_TYPE`, `E_RANGE` | term errors (unknown function, wrong argument count or type, integer overflow) |
| `E_BIND_NAME`, `E_BIND_FIELD`, `E_AMBIGUOUS_REF`, `E_CYCLE`, `E_LABEL`, `E_PARAM` | name resolution: unknown or ambiguous name, field absent from all rows, ambiguous id prefix, cyclic views, undefined label, missing or ill-typed param |
| `E_FRAME`, `E_FRAME_DERIVED` | a frame argument value is invalid, or a projection frame argument was applied to a derived world |
| `E_READONLY` | a `WRITE` in a read run, or a write to a read handle (plan time) |
| `E_UNDECLARED_KIND`, `E_VERB_KIND`, `E_COMPUTED_FIELD`, `E_CELL_TYPED`, `E_BAD_OF`, `E_VIEW_BODY`, `E_ID_MISMATCH` | write validation (4.2, 4.5, 4.6) |
| `E_NOT_PRIMARY` | a write aimed at a projection (`sqlite:`, derived tables) |
| `E_SOURCE`, `E_SOURCE_CAP` | the source cannot be opened or read, or lacks a capability the expression needs |
| `E_BUDGET` | 5.2 |
| `E_IMPORT`, `E_EXPORT`, `E_NOT_REPRESENTABLE`, `E_BASIS_REQUIRED`, `E_LOSSY` | conversion (6): a malformed input; an export that failed; an entry the target cannot hold (refused, never dropped); a foreign import with no usable `basis`; a lossy conversion run without `acceptLoss` |
| `E_SQL_UNSUPPORTED` | the translator met a construct of 8.4; `detail.gap` is its stable id |

---

## 6. Formats and the flow matrix

The nine formats: **pharos JSONL** (`jsonl`), **blocks** (`blocks`), **placed lazy** (`lazy`), **SQLite projection** (`sqlite`), **SQL dump** (`sqldump`), **CSV** (`csv`), **JSON** (`json`), **EOT text** (`eot`), **EOQL statement sequence** (`eoql`). Data flows between any two: every conversion is `decode` of the source into a stream of entries (and, for foreign data, foreign records) followed by `encode` into the target. There is no pairwise code: 9 decoders and 9 encoders cover the 72 ordered pairs, and the declarations below are computed, not asserted pair by pair.

### 6.1 The converter interface

```
Format {
  id: "jsonl"|"blocks"|"lazy"|"sqlite"|"sqldump"|"csv"|"json"|"eot"|"eoql",
  profiles: { <name>: { retention, lossy: bool } },                  // 6.2
  decode(location, {profile, ...}) -> { entries: Iterable<{entry, file?, line?}>,
                                        foreign: Iterable<Record>|null,   // records that are not entries (6.4)
                                        inventory: Inventory, notes: [...] },
  encode(entries: Iterable<{entry, file?}>, location, {profile, ...}) -> { inventory: Inventory, notes: [...] }
}
Inventory = { entries: n, ids_sha256, files: {name: count}, dup_lines: n, invalid_lines: n,
              noncanonical_lines: n, extra_field_entries: n, line_order_sha256, file_attribution_sha256 }
```
`ids_sha256` is the digest of the sorted ids joined by `\n` (the dump header's). `line_order_sha256` digests, per file in name order, the ids in line order; `file_attribution_sha256` digests the sorted `(id, file)` pairs.

**The loss manifest is MEASURED, not declared by the encoder.** `convert` (a) decodes the source and takes its inventory `I_in`; (b) encodes; (c) RE-DECODES the output with the target's own decoder and takes `I_out`; (d) reports, for each attribute of 6.2, the difference. An encoder that omits or lists wrongly is caught by construction (mutant M7); the manifest equals the true loss because it is the diff of two measurements. Shape:

```
{ "v":"eoql-manifest/1", "from":URI-or-format, "to":..., "profile_in":..., "profile_out":...,
  "entries_in":n, "entries_out":n, "ids_preserved":bool, "ids_sha256_in":..., "ids_sha256_out":...,
  "lossless_ids":bool, "lossless_bytes":bool,
  "losses":[ {"attribute":"dup_lines","count":n,"ids":[... up to 1000],"ids_digest":"...","detail":"..."} ],
  "refused":[ {"id":..., "reason":"extra-fields"|...} ],      // entries the target cannot hold (E_NOT_REPRESENTABLE)
  "rejected":[ {"record":i, "reason":...} ],                  // foreign import only
  "declared_possible":[ attributes this pair could lose ] }
```
`losses` lists an attribute only when its measured count is positive; `declared_possible` is the static list from 6.2. A conversion with a nonempty `losses` or `refused` and no `acceptLoss` option stops with `E_LOSSY` BEFORE writing the output (the manifest is attached to the error); `convert` never loses data silently. An entry the target cannot represent is REFUSED (the whole conversion stops, listing the ids), never dropped.

### 6.2 What each format retains: the declarations

The attributes (everything that can differ between two stores of the same entry set): **ids** (the set of entry ids), **fields** (all 11 entry fields equal, canonical), **extra** (extra fields), **file** (writer file attribution), **order** (line order within a file), **dups** (duplicate lines, the same id twice), **invalid** (lines that are not valid entries, verbatim), **text** (non-canonical but id-valid text of a line). `Y` retained, `N` not retained (counted in the manifest when present), `R` the format cannot hold it and REFUSES.

| format.profile (default first) | ids | fields | extra | file | order | dups | invalid | text | lossy profile? |
|---|---|---|---|---|---|---|---|---|---|
| `jsonl` (a dir of `<writer>.jsonl`, or one file) | Y | Y | Y | Y | Y | Y | Y | Y | no |
| `blocks` (pharos-blocks store, JSON-medium blocks, original bytes) | Y | Y | Y | Y (source name) | Y (chain order) | N (identical bytes stored once) | Y (opaque block / `undecoded`) | Y | no |
| `lazy` (placed root: `<writer>/<shard>.jsonl`, `_corrupt.jsonl`) | Y | Y | Y | Y (writer dir) | N (shard placement) | Y | Y (`_corrupt.jsonl`) | Y | no |
| `sqlite` (pharos-sql projection, 6.3) | Y | Y | R | Y (`writer`) | N (`pos` order) | N | N (counted in `meta` only) | N | no |
| `sqldump` profile `entries` (SQL text, 6.3) | Y | Y | R | Y | N | N | N | N | no |
| `csv` profile `entries` (6.3) | Y | Y | R | Y (`file` column) | N | N | N | N | no |
| `json` profile `entries` (6.3) | Y | Y | Y | N | N | N | N | N | no |
| `eot` profile `entries` (6.3) | Y | Y | R | Y (`@file`) | N | N | N | N | no |
| `eoql` mode `verbatim` (4.6) | Y | Y | Y | N | N | N | N | N | no |
| `csv` profile `rows` / `json` profiles `rows`, `result` / `eot` profile `view` / `sqldump` profile `derived` / `eoql` mode `semantic` | N | N | N | N | N | N | N | N | YES: these carry a QUERY RESULT or a re-weavable description, not entries. Their manifests list `ids`, `fields`, and each attribute lost |

The `blocks` row and the `sqlite` `invalid` cell rest on documents the designer read, not code (`pharos-blocks/README.md`, `ACCEPTANCE.md`, `DESIGN.md`); if a measured manifest disagrees with a cell, the cell is wrong and that is a defect to report, not a loss to hide.

**Pair rule.** For source format `A` and target `B` (default profiles): the manifest's possible losses are the attributes with `A = Y` and `B = N`; the pair REFUSES the entries with an extra field when `B` has `R`. A pair is **id-lossless** iff `B` has `Y` for `ids` and `fields` and, for inputs that contain extra-field entries, `B` has `Y` for `extra` (otherwise those inputs are refused, an error, never a drop). A pair is **byte-lossless** on an input iff the measured `losses` and `refused` are both empty. Consequently: every pair of default profiles is id-lossless on inputs without extra-field entries; A→B→A returns the identical set of ids (law L17); the byte-level losses differ by pair and are exactly those the manifest measures. Examples (declared): `jsonl→sqlite` may lose `order`, `dups`, `invalid`, `text`; `sqlite→jsonl` loses nothing it held; `jsonl→lazy` may lose `order`; `jsonl→blocks` may lose `dups`; `json→jsonl` loses `file`, and `jsonl→json` loses `file`, `order`, `dups`, `invalid`, `text`; `lazy→json` as `jsonl→json`; `csv→eot` loses nothing it held; `eoql(verbatim)` is id-lossless from and to every default profile. Every conversion that starts from a lossy profile (a query result) ends with ids N: such a conversion is a FOREIGN import (6.4) when it targets a store, never a restoration.

### 6.3 Layouts

* **jsonl.** One canonical JSON entry per line, newline terminated, UTF-8; a dir of `<writer>.jsonl` (writer matches `[A-Za-z0-9._-]+`). `encode` writes canonical lines; `decode` keeps the original line text for `text` accounting.
* **blocks.** `blocks:<dir>`: the store of `pharos-blocks` (FORMAT.md): each valid entry line is one JSON-medium data record whose payload is the original bytes; `file` = the ingest source name. `encode` is the store's ingest; `decode` is its unfold of JSON-medium records (non-JSON media are ignored and listed in `notes`, they are not entries).
* **lazy.** `lazy:<root>`: `PLACEMENT.json` plus `<writer>/<shard>.jsonl` (pharos-lazy API.md 1). `encode` is `ingest` (bytes verbatim to the shard the placement gives, invalid lines to `_corrupt.jsonl`); `decode` reads every shard (`flatten` semantics). Placement and split limit are storage facts, never results.
* **sqlite.** `sqlite:<file>`: the pharos-sql projection of DESIGN.md: tables `entries, heads, conflicts, kinds, meta, k_<kind>` and the views of 1.8, made with `node:sqlite`. `encode` MUST produce a file that (a) `pharos-sql regen` accepts, and (b) has the same `canon` hash as `pharos-sql build` over the same entries (the catalog equations of 1.8 are the shared definition). `decode` reads ONLY the eleven entry columns of `entries` (`body_json of_json seen_json basis_json` etc.), recomputes every id from them, and reports a mismatch as evidence (`incomplete.over`, reason `sqlite-id-mismatch`); derived tables are never trusted as truth. A source with an extra-field entry is refused (`E_NOT_REPRESENTABLE`, the id listed), as pharos-sql refuses it (`E_LOSSY`).
* **sqldump.** Profile `entries`: a UTF-8 text file. First line `-- eoql-sqldump/1 entries=<n> ids_sha256=<hex>`; then `CREATE TABLE IF NOT EXISTS entries(pos INTEGER, id TEXT PRIMARY KEY, writer TEXT, cell TEXT, kind TEXT, addr TEXT, body_json TEXT, of_json TEXT, seen_json TEXT, basis_json TEXT, by TEXT, at TEXT, v INTEGER, retracted INTEGER, retracted_by TEXT);` and one `INSERT INTO entries VALUES(...);` per entry in `pos` order, string literals single-quoted with `'` doubled, no other quoting form. Optional derived tables (`--derived`) are written as `INSERT INTO <table> ...` for `heads conflicts kinds meta` and `k_*` after a comment line `-- derived`, and are ignored on decode. `decode` is a restricted statement reader (`CREATE TABLE`, `INSERT INTO <table> [(cols)] VALUES (...)[, (...)]`, comments); it executes nothing, and any other statement type is `E_IMPORT`. The same reader serves foreign SQL dumps (6.4).
* **csv.** Profile `entries`: RFC 4180, UTF-8 without BOM, LF terminators (CRLF accepted on input); header `id,v,cell,kind,addr,by,at,of,seen,basis,body,file`; `of seen basis body` hold canonical JSON text; rows in `pos` order. Profile `rows`: the header is the result's `columns`, one row per result row, values as text (JSON values as canonical JSON text, NULL as the empty field): lossy.
* **json.** Profile `entries`: `{"format":"eoql-json/1","profile":"entries","entries":[<entry>...]}` with canonical entry objects in `pos` order. Profile `rows`: `{"format":"eoql-json/1","profile":"rows","columns":[...],"rows":[...]}`; profile `result`: the full envelope of 5.1. The last two are lossy. A bare JSON array of objects or an NDJSON file is a FOREIGN input (6.4) unless every element is a valid entry, in which case it is read as profile `entries`.
* **eot.** The human notation, with the cell address `OP·Grain` on every node (khora `eot-notation.js`). Profile `entries`, one block per entry, blocks separated by one blank line:
  ```
  #<id>  <cell>  <kind>  <addr as a JSON string>
    by <by>  at <at>  v 1  @<file>
    of <id> <id> ...                       (the word "of" alone when empty)
    seen <id> ...                           (same)
    basis <canonical JSON, one line>
    body <canonical JSON, one line>
  ```
  `decode` recomputes `id` from the fields and refuses a block whose header id differs (`E_ID_MISMATCH`). It is lossless for default fields; an extra field has no line and is refused (`R`). Profile `view` renders a result as an indented tree, one node per row with its `_held` and cell; it is lossy and has no decoder.
* **eoql.** The dump of 4.6: `verbatim` (lossless) and `semantic` (lossy).

### 6.4 Foreign data enters as entries with `basis`

Foreign data is any input whose records are not entries: a CSV with other columns, a JSON array of other objects, a SQL dump of other tables. Import (write mode, a declared `--kind`) makes ONE entry per record through the target's `weave`:
* `kind` is the kind named by the caller and must be declared (`E_UNDECLARED_KIND`); the cell comes from its declaration (never typed).
* `addr`: `--addr-col C` (that column's value as text), `--addr-template "prefix:{col}:{col2}"`, or by default `--addr-hash` (`"import:" + sha256(canonical(record))`).
* `body`: the record as an object (CSV columns are text unless `--types '{"col":"integer"|"real"|"boolean"|"json"|"text"}'`; SQL values keep their literal types; JSON values keep theirs).
* `of: []`.
* `basis` is MANDATORY and always carries, in addition to anything the caller adds (which can never remove or override these keys):
  ```
  { "importer":"eoql-import/1", "format":"csv"|"json"|"sqldump", "input_sha256":"<sha256 of the input bytes>",
    "input_name":"<basename>", "record":<1-based index>, "columns":[...], "table":"<for sqldump>" }
  ```
  The importer hashes the input before writing; if it cannot (an unreadable stream), `E_BASIS_REQUIRED` and nothing is written (mutant M8).
A record that cannot be typed or addressed goes to the manifest's `rejected` with its index and reason; nothing is dropped silently, and the import receipt equals `records_in = appended + noops + rejected`. Re-importing the same input into `lib:` is a no-op per record (identical weft from the same writer); into `lazy:` it duplicates unless `--skip-present` is given (a scan for `basis.input_sha256` + `record`). Entries that arrive in an entry format (`jsonl blocks lazy sqlite sqldump csv/json/eot profile entries, eoql verbatim`) are merged verbatim (4.6) and keep their own `basis`; the import receipt is returned, and with `--receipt-kind K` (a declared kind) one extra entry per import records `{format, input_sha256, entries, ids_sha256}` so the arrival itself is an event.

### 6.5 Evidence differences between stores

Evidence kinds specific to one store (`blocks`: a broken hash chain; `sqlite`: an id that does not recompute; `lazy`: `_corrupt.jsonl` lines) can only be reported by that store's adapter. Law L21 compares the SAME entry set across stores. It compares `incomplete` only on evidence kinds every compared store can evaluate; dangling-id evidence (1.6.2) is not evaluable by `lazy:`, which reports `W_UNRESOLVED_REF` instead, and evidence peculiar to one store (blocks chain, sqlite id mismatch, `_corrupt.jsonl`) differs when that store holds damage the others do not: by data, not by implementation.

---

## 7. Interfaces (fixed now; the test author calls exactly these)

Module `src/index.mjs` of the builder's tree (`ledgers/pharos-eoql/src/`); CLI `bin/eoql.mjs`. Core code uses Node built-ins only; `node:sqlite` only in `src/adapters/sqlite*` and in tests. The frozen library (`pharos-lazy/baseline/pharos.mjs`, sha256 `e869302b...`) is the ORACLE for the fold: the core MAY implement the fold itself or call a byte-identical pinned copy (checked by sha256 before use, as pharos-sql does), but must agree with it (L13). Nothing here ever opens `pharos/log` (the main tree) or any path the caller did not name.

### 7.1 Library

```js
import * as E from '<pharos-eoql>/src/index.mjs';

E.VERSION                                   // { language:"eoql/1", result:"eoql-result/1", ... }
E.EoqlError                                 // class; .code, .message, .pos?, .detail?
E.CODES                                     // frozen object: every code of 5.3 and every gap/warning code of 5.1

const h = E.open(uri, opts?)                // -> Handle.  opts: { mode:"read"|"write" (default "read"), writer?, budget?, frame? }
E.close(h)

E.parse(text, opts?)  -> Script             // { statements:[Node], text }; throws EoqlError(E_PARSE|E_LIMIT|E_UNKNOWN_VERB|...) with .pos; total (L19)
E.print(node|script)  -> string             // the canonical print of 4.5
E.hash(node|script)   -> hex                // sha256 of E.print(...)
E.compose(q2, q1)     -> string             // substitute the name `sources` in q2 by the expression q1 (3.3)

E.run(h, textOrScript, opts?) -> Envelope | { v, statements:[Envelope|Receipt] }
    // opts: { params:{name:value}, write:false, budget?, frame?:{asof,schema,collapse,anc,ordering,perceiver},
    //         return?:"pointers"|"content", explain?:"full"|"brief", legacyGaps?:false, world?:false }
    // world:true adds a NON-enumerable property `.world` (a World) so results can be re-opened (closure tests)
E.plan(h, textOrScript, opts?) -> { expr, expr_hash, frame, plan, verbs, primitives, extensions, estimate }
    // never writes and never evaluates operator bodies; may read the schema/ground (counted)

E.foldOf(h, frame?) -> World                // inspection API for the independent tests (not used by `run`'s callers otherwise):
    // World: entries() -> [entry], rows() -> [row], slots() -> [{addr,kind}], heads(addr,kind) -> [id],
    //        held(addr,kind) -> n, episodes(addr,kind) -> [episode], pos(id) -> n, retracted(id) -> bool,
    //        dangling() -> [id], health() -> {corrupt, torn}, frame
E.openWorld(world, opts?)   -> Handle       // read-only handle whose `sources` is that world (closure, 3.3)
E.openEntries(entries, opts?) -> Handle     // read-only `mem:` handle over an array of entries (L2)

E.convert({ from, to, acceptLoss?, scope?, derived? }) -> Manifest      // from/to: "fmt[:profile]:location" (6)
E.exportTo(h, to, opts?)        -> Manifest // the same, source = handle
E.importFrom(from, h, opts?)    -> { receipt, manifest }                // write handle; opts: { kind, addrCol, addrTemplate, addrHash, types, basis, skipPresent, receiptKind, acceptLoss }
E.dump(h, { mode:"verbatim"|"semantic", scope? }) -> string            // 4.6
E.replay(h, text, opts?)        -> Receipt  // == E.run(h, text, { write:true, ...opts }) and requires a write handle

E.views.list(h, { asof? })                -> [{ name, held, heads:[ids], expr_hash }]
E.views.get(h, name, { asof? })           -> { name, expr, expr_hash, params, id, held }
E.views.define(h, name, exprText, { params?, of? })  -> Receipt     // == WRITE DEF(view: ...)
E.views.retract(h, name)                  -> Receipt                // == WRITE NUL on the view's heads

E.translateSql(sql, { catalog?:Handle|Catalog }) -> { ok, eoql, params:[...], columns:[names], order_sensitive:bool, gaps:[{gap,construct,pos}] }
E.sqlCatalog(h) -> { relations:{ name:{ columns:[{name,affinity}], kind:"table"|"view" } } }       // 1.8, k_<kind> included
E.serve(h, { port?:0, host?:"127.0.0.1", budget? }) -> Promise<{ port, close():Promise }>
```
All functions are synchronous except `serve` and `close`-style I/O the implementer must make async; the test author MAY `await` every call. A function given a bad argument throws `EoqlError`; it never throws anything else for any input (L19).

### 7.2 Source names

`<scheme>:<locator>`; the locator is a filesystem path (absolute or relative to the working directory) and may contain `:`; only the first `:` splits scheme from locator.

| scheme | opens | write |
|---|---|---|
| `lib:<dir>` | a flat pharos: every `*.jsonl` in the dir is one writer's lane | yes (frozen `weave`) |
| `jsonl:<file>` | one JSONL file as a one-lane `lib` | no |
| `lazy:<root>` | a placed root (`PLACEMENT.json`, `<writer>/<shard>.jsonl`) | yes (`placed.weave`) |
| `blocks:<dir>` | a pharos-blocks store | verbatim merge only |
| `sqlite:<file>` | a pharos-sql projection, entries recovered from the `entries` columns and re-hashed (6.3) | never (`E_NOT_PRIMARY`) |
| `mem:` | an in-memory entry array (library only: `E.openEntries`, `E.openWorld`) | no |

For conversions the schemes `csv: json: eot: sqldump: eoql:` also name files (and `fmt:profile:path` picks a profile, for example `csv:rows:/tmp/out.csv`). A directory or file that does not exist is `E_SOURCE`, except as the TARGET of an export or import-into-new, which creates it. A source named by the caller is read only through the adapter; nothing outside it is touched.

### 7.3 CLI

`node bin/eoql.mjs <command> ...`. Every command prints ONE JSON document on stdout (`--pretty` indents) and exits 0; errors print `{"error":{"code","message","pos"?,"detail"?}}` on stderr and exit 1 (usage errors: exit 2). Nothing else is printed. A query is given inline, with `-f FILE`, or `-` for stdin. `--param name=value` (value parsed as JSON if it parses, else text) may repeat; `--params-json '{...}'`.

```
run     <source> <query|-f FILE|->  [--param n=v]... [--frame JSON] [--budget JSON] [--return pointers|content]
                                    [--explain full|brief] [--write --writer W] [--legacy-gaps] [--pretty]
explain <source> <query|-f FILE|->  [same options; never writes]          -> E.plan(...)
export  <source> --to <fmt[:profile]:path> [--scope EXPR] [--accept-loss] [--derived]       -> manifest
import  <fmt[:profile]:path> --into <source> --write --writer W [--kind K]
                             [--addr-col C | --addr-template T | --addr-hash] [--types JSON] [--basis JSON]
                             [--skip-present] [--receipt-kind K] [--accept-loss]            -> { receipt, manifest }
serve   <source> [--port N] [--budget JSON]        prints {"listening":"127.0.0.1:<port>"} then serves until killed
dump    <source> [--mode verbatim|semantic] [--scope EXPR] [--out FILE]                      -> text, or {"out":FILE,"entries":n,"ids_sha256":...}
view    define  <source> <name> <query|-f FILE> [--params a,b] [--of-heads] --write --writer W
view    list    <source> [--asof CUT]
view    show    <source> <name> [--asof CUT]
view    run     <source> <name> [--param n=v]...
view    retract <source> <name> --write --writer W
sql     <source> <sql|-f FILE|->  [--run] [--write --writer W]                               -> the translation (8), and with --run its envelope
```
Eight commands (the seven the plan asks for plus `sql`, the translator of section 8, which needs a command). `--write` without `--writer`, or a `WRITE` statement without `--write`, is `E_READONLY` and appends nothing. `dump`, `export`, `explain`, `serve` and every `view` command except `define`/`retract` are read-only.

### 7.4 HTTP: `serve` (read-only, 127.0.0.1)

Binds `127.0.0.1` only (`--port 0` picks a free port and reports it). The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (against DNS rebinding); other values get 403. Request bodies over 1 MiB are 413. There is NO route that appends, no `WRITE`, no `import`: a body whose parse contains `WRITE` is `E_READONLY` (403) and the source handle is opened read-only anyway.

| route | body / response |
|---|---|
| `GET /health` | `{"ok":true}` |
| `POST /run` | `{query, params?, frame?, budget?, return?}` -> the envelope of 5.1 |
| `POST /explain` | `{query, params?, frame?}` -> the plan |
| `GET /views` | `E.views.list` |
| `GET /formats` | the table of 6.2 |

Errors: `{"error":{code,message,...}}` with status 400 (`E_PARSE`, `E_BIND_*`, `E_UNKNOWN_*`, `E_BAD_*`, `E_FRAME*`, `E_TYPE`, `E_PARAM`), 403 (`E_READONLY`), 413 (`E_LIMIT`), 422 (`E_BUDGET`), 500 otherwise. Budget defaults of 5.2 apply to every request, and a result over 200,000 rows is `E_BUDGET`.

### 7.5 What an implementation may and may not do (conformance, informative)

Suggested layout: `src/index.mjs`, `lex.mjs`, `parse.mjs`, `print.mjs`, `bind.mjs`, `world.mjs` (fold, heads, episodes), `eval/*.mjs` (one per verb), `term.mjs`, `adapters/{lib,lazy,blocks,sqlite,mem}.mjs`, `formats/*.mjs`, `sql/translate.mjs`, `serve.mjs`; `bin/eoql.mjs` only parses arguments. An implementation MUST NOT: keep any answer, index or summary in a store (C1: delete everything derived and it is rebuilt identically); resolve a held value on write; add a field to `basis` on a plain write; interpolate values into statement text; or read a file the plan did not name.

---

## 8. The SQL-to-EOQL translator

Purpose: P1 (SQL-core containment). `translateSql` turns a SQL statement over the catalog of 1.8 into an EOQL expression whose result must equal SQLite's on the projection. Dialect: SQLite 3 as bundled with the Node that runs the tests. Interface: `E.translateSql(sql, {catalog})` and `eoql sql` (7). The catalog supplies the column lists (needed for `SELECT *` and for typing, below). The translator is a compiler to text: it never executes SQL and never concatenates values into the output (literals are re-printed through the canonical printer, `?` placeholders become `:p1, :p2...` in order, named ones keep their name).

### 8.1 Supported subset and mapping

| SQL | EOQL |
|---|---|
| `FROM t [AS a]` | `SEG(sources; table: "t")`; with alias, columns are qualified `a.col` only if a join follows |
| `FROM (subselect) a` | the translation of the subselect |
| `a JOIN b ON p`, `INNER`, `LEFT [OUTER]`, `RIGHT`, `FULL`, `CROSS`, comma | `CON(A; to: B; on: p; join: "inner"|"left"|"right"|"full"|"cross"; to_as: "b")` (the left side's columns are already qualified after the first join; the first left gets `as: "a"`) |
| `JOIN ... USING (c)` | `on: l.c = r.c` plus the merged single column in the select list |
| `WHERE p` | `EVA(F; where: p')` |
| `x IN (list)` | `x in [list]` |
| `x [NOT] IN (SELECT ...)` | `x in (E)`; `NOT IN` is `join: "anti_null"` when null-aware matters, else `not in (E)` with SQL's null semantics (3-valued, as `NOT IN` is) |
| `[NOT] EXISTS (SELECT ... WHERE inner.c = outer.c AND rest)` (equality-correlated) | `CON(F; to: E_inner; on: outer.c = inner.c AND rest; join: "semi"|"anti")` |
| uncorrelated `EXISTS (SELECT ...)` | `(SYN(E; agg: {n: count(*)})) > 0` |
| uncorrelated scalar subquery `(SELECT ...)` | the same parenthesised world in term position (first row, first column, NULL if empty; 2.7) |
| `GROUP BY g` with aggregates | `SYN(F'; by: [g...]; agg: {_a1: f1, ...})`; aggregates found in the select list, `HAVING` and `ORDER BY` are collected and named |
| aggregates without `GROUP BY` | `SYN(F'; agg: {...})`: always exactly one row, `count` 0 / others NULL on empty input |
| `HAVING h` | `EVA(S; where: h')` with the aggregates replaced by their names |
| window `f(...) OVER (PARTITION BY p ORDER BY o [ROWS BETWEEN a AND b])` | `REC(F'; by: [p]; order: [o]; rows: [lo, hi]; set: {_w1: f(...)})`, one REC per distinct window spec; `RANGE`/default frames as the default of 2.4 REC; a named `WINDOW w AS (...)` is inlined |
| `SELECT items` | `REC(.; set: {name: term}; pick: [names])`; `*` and `t.*` are expanded from the catalog |
| `DISTINCT` | `SYN(R; distinct: true)` |
| `UNION [ALL]`, `INTERSECT`, `EXCEPT` | `SYN(A; with: B; mode: "union"|"union_all"|"intersect"|"except")`, column names from the first |
| `ORDER BY o` (terms, aliases, ordinals, `COLLATE NOCASE` as `nocase(x)`, `NULLS FIRST/LAST`) | `DEF(R; sort: [o...])`; when `o` mentions non-selected columns and there is no DISTINCT/compound, the `DEF sort` is placed before the final `pick` (REC keeps row order) |
| `LIMIT n [OFFSET m]` | `DEF(R; limit: n; offset: m)` (constant or param) |
| `WITH n [(cols)] AS (Q) body` | `DEF(; bind: {n: Q'}; in: body')`; a column list becomes `REC rename` |
| `WITH RECURSIVE n(cols) AS (base UNION [ALL] step) body` | `DEF(; fix: "n"; base: base'; step: step'; mode: "union"|"union_all"; in: body')` when `step` mentions `n` exactly once, not under an aggregate, DISTINCT, or on the null-supplying side of an outer join (P-FIX; the iteration is the working-table one of SQL: each round applies `step` to the rows added by the previous round, stops when a round adds nothing; for `union` a round adds only rows not yet present) |
| `VALUES (..), (..)` | `INS(; rows: [[..],[..]])` |

Row order: the translator reports `order_sensitive: true` iff the statement has an outer `ORDER BY`; the harness compares as a set otherwise. EOQL's `sort` is stable (equal keys keep input order); SQLite's tie order is unspecified, so order-sensitive comparison is meaningful only when the `ORDER BY` key is total over the result.

### 8.2 Expressions

Literals, `NULL`, `TRUE`/`FALSE` (as 1/0), arithmetic, `||`, comparison, `AND OR NOT`, `IS NULL`, `IS NOT NULL`, `BETWEEN`, `LIKE [ESCAPE]`, `GLOB`, `IN`, `CASE` (searched; simple `CASE x WHEN v` as `case(x = v, ...)`), `CAST(x AS INTEGER|REAL|TEXT|NUMERIC)`; `IS` and `IS NOT` between non-NULL-literal operands as `nulleq(a,b)` / `not nulleq(a,b)`; functions of V-FN with SQLite's names mapped (`ifnull` to `coalesce`, scalar `min(a,b,..)` / `max(a,b,..)` to `least` / `greatest`, `substring` to `substr`, `json_extract(x,'$.p')` and `x ->> '$.p'` to `json_get(x,"$.p")`); aggregates of V-AGG including `DISTINCT` and `group_concat(x[,sep])`; `agg(..) FILTER (WHERE p)` as `agg(case(p, x))` (`count(*) FILTER` as `count(case(p, 1))`); parameters `?`, `?NNN`, `:n`, `@n`, `$n` as params. Identifiers are re-quoted with backticks when they need it.
**Affinity rule R-AFF.** SQLite applies column affinity to comparison operands; EOQL's V1 does not coerce. The translator therefore rewrites a comparison of a catalog column whose affinity is INTEGER/REAL/NUMERIC with a TEXT literal that is a well-formed number into the numeric literal, and a comparison of a TEXT-affinity column with a numeric literal into the text rendering of the literal (as SQLite would convert). Column-to-column comparisons across different affinities are `gap SQL_AFFINITY`.

### 8.3 What is declared unsupported (stable gap ids; `E_SQL_UNSUPPORTED` lists all met, each with its position)

| gap id | construct |
|---|---|
| `SQL_CORRELATED_SCALAR` | a correlated scalar subquery (in SELECT, WHERE or ORDER BY) |
| `SQL_CORRELATED_OTHER` | a correlated `IN` or `EXISTS` whose correlation is not a conjunction of equalities with outer columns |
| `SQL_NATURAL_JOIN` | `NATURAL JOIN` |
| `SQL_TABLE_FUNCTION` | table-valued functions: `json_each`, `json_tree`, `generate_series`, `pragma_*` |
| `SQL_WINDOW_FRAME` | `GROUPS`, `EXCLUDE`, `RANGE` with an offset, `FILTER` on a window function |
| `SQL_BARE_COLUMN` | a column in an aggregate query that is neither aggregated nor determined by the `GROUP BY` (SQLite picks an arbitrary row) |
| `SQL_RECURSIVE_SHAPE` | a recursive CTE that is not of the linear form of 8.1 |
| `SQL_ROWID` | `rowid`, `oid`, `_rowid_` |
| `SQL_BLOB` | blob literals, `CAST AS BLOB`, `hex`, `randomblob`, `zeroblob` |
| `SQL_COLLATION` | collations other than `BINARY`, `NOCASE` |
| `SQL_NONDETERMINISTIC` | `random`, `now`/`'now'`, `changes`, `last_insert_rowid`, `current_*` |
| `SQL_DATE_FORMAT` | date and time functions outside 2.7's subset |
| `SQL_JSON_OPERATOR` | the `->` operator (JSON-valued); `->>` is supported |
| `SQL_IS_TRUE` | `IS TRUE`, `IS FALSE`, `IS DISTINCT FROM` forms other than null-safe equality |
| `SQL_AFFINITY` | cross-affinity column comparison (8.2) |
| `SQL_DDL` | `CREATE`, `DROP`, `ALTER`, `ATTACH`, `PRAGMA`, `VACUUM`, `BEGIN`/`COMMIT`/`ROLLBACK`, triggers |
| `SQL_MULTI_STATEMENT` | more than one statement |
| `SQL_UPDATE`, `SQL_INSERT_SHAPE`, `SQL_RETURNING`, `SQL_UPSERT` | write constructs outside 8.4 |

Every supported construct is a named case; every unsupported one is one of these ids. A silent partial translation (dropping `HAVING`, `DISTINCT`, `LIMIT`, a window, a join condition) is a bug of the kind mutant M11 plants; the translator either translates a clause or raises its gap.

### 8.4 SQL writes (optional tier; write mode only)

Not required for P1. If built, `INSERT INTO entries(kind, addr, body_json, of_json, basis_json) VALUES (...)` becomes `WRITE <op(decl(kind).cell)>(addr; kind: k; body: <parsed body_json>; of: <parsed of_json>; basis: <parsed basis_json>)`; `DELETE FROM entries WHERE id = ...` or `id IN (...)` becomes `WRITE NUL([ids])`. `UPDATE` is `SQL_UPDATE` (EOQL has no edit; the user appends a new entry that cites the old one). `INSERT INTO k_<kind>` has no address column and is `SQL_INSERT_SHAPE`. Nothing writes into a SQLite file: the SQL view stays a rebuildable projection (PREREG F2). If this tier is not built, the report says "SQL write-through not built".

### 8.5 Example

```
SELECT addr, count(*) AS n FROM live_entries WHERE kind = 'move' GROUP BY addr HAVING count(*) > 1 ORDER BY n DESC LIMIT 5
=>
DEF(EVA(SYN(EVA(SEG(sources; table: "live_entries"); where: kind = "move"); by: [addr]; agg: {n: count(*)}); where: n > 1); sort: [n desc]; limit: 5)
```

---

## 9. Hooks for the pre-registered tests, open questions, non-goals

### 9.1 Where each pre-registered mutant is made observable by this spec

| mutant | what it does | the clause that makes it detectable |
|---|---|---|
| M1 latest by entry clock | picks by `at` | 1.7: an entry named in another's `of` is never a head; plant `at` against `of`; L9 |
| M2 collapse without saying | `latest` with no record | `explain.frame.collapsed` and `_held` always present; L9 |
| M3 ignores retractions | retracted entries stay live | 1.2.4, L10 |
| M4 ignores as-of | cut not applied | F1, L8(d)(e) |
| M5 perceiver leaks hidden ancestry | hidden `of` supersedes | 3.7 worked contrast, L12 |
| M6 view stores the answer | result in the entry | 4.5 exact body, `E_VIEW_BODY` |
| M7 export drops a field unlisted | encoder omits | 6.1: the manifest is a diff of two measurements |
| M8 import without `basis` | no provenance | 6.4 mandatory keys, `E_BASIS_REQUIRED` |
| M9 write on by default | read run appends | 4.1 three conditions, plan-time `E_READONLY` |
| M10 budget not enforced | runaway runs | 5.2, L20 |
| M11 translator drops HAVING | clause lost | 8.3 last paragraph, L18 |
| M12 provenance lists unread entries | `entries_read` from the result | 5.1, L23 |
| M13 counterfactual mutates | drop edits the log | L11 (hashes before and after) |
| M14 parser executes a statement in a string | text re-lexed | 4.6 strings, L19 |

### 9.2 Open questions (decisions the user or the test results must settle; none is hidden in a default)

1. **Bootstrapping kinds without typing a cell.** EOQL can declare a kind only `like:` an already-declared one (4.2), so the first non-protocol kind must be modelled on a protocol kind (`view` like `holon`, a DEF at Pattern grain, is only a choice). Is that acceptable, or should `declare` take a cell literal (which would make EOQL type cells, against PREREG)?
2. **Completeness.** `incomplete` is evidence-based (1.6). A file truncated with no surviving reference is undetectable. pharos-lazy A6 asks that gaps say "incomplete over range unless the ground declares the range complete"; v1 has no completeness declaration (it would need a declared kind, for example `coverage {writer, through}`), so that clause is only half met.
3. **Default ancestry.** `anc: slot` reports 1,336 held addresses on the Premiere replay where the frozen rule (`anc: full`) reports 0 conflicts. The default decides what "held" means to a first-time reader. This spec chose `slot` (cheap, storage independent, `of` means "read"), and flags it with `W_ANC_SLOT`.
4. **Slot grain.** Native slot is `(addr, kind)`; pharos-sqlite groups by `(addr, cell)`. They differ when two kinds share a cell at one address.
5. **`pos` is global.** `latest` between concurrent heads, and any sort by position, needs the whole log's causal order. `ordering: key` is a clock stand-in and says so.
6. **NUL.** The EO wiki says NUL "emits nothing"; the pharos protocol declares `retract` at `NUL·Figure` and `frame` at `NUL·Ground`. This spec follows the protocol (NUL write = retraction). If the wiki reading is wanted, retraction would need another verb.
7. **Extensions to the seed's reading** (counted for T(c)): INS read as genesis, SIG read as perceiver/budget/return, NUL read with `expect`/`gaps`, CON `dir: "concurrent"`, SEG `drop`/`cascade`. Each is a use the seed never had.
8. **Extra primitives.** Counting `WRITE` as a primitive (P-WRITE) is a decision; reading it as part of every verb gives 4 primitives and 3 vocabularies. The headline is 5 + 3 so the finding cannot be accused of hiding one.
9. **"schema" means two things** in pharos: a kind declaration's `schema` (columns, pharos-sql) and a `schema:<kind>` read-schema entry (placement, collapse, window; pharos-lazy A2). The frame argument `schema` names the second (the ground); the first rides along in the ground.
10. **Stores read from documents.** The `blocks` and `sqlite` cells of 6.2 and the DDL of 6.3 were written from READMEs, FORMAT.md and DESIGN.md, not from running code.
11. **Defaults are untuned**: budget numbers, the 16-deep view nesting, the 1 MiB body limit.
12. **Glyphs.** CON `⋈` and REC `◉` are canon in eodb; the holodeck seed prints `⤫` and `⊛`; the `writing-code-in-eo` skill says `↬` for REC and no repo was found that does. The reader accepts `◉ ⊛` and `⋈ ⤫`; `↬` is not accepted.
13. **Value semantics.** Adopting SQLite's V1 wholesale makes P1 a definition, at the price that EOQL inherits SQLite's oddities (integer division, cross-type order, boolean as 0/1).

### 9.3 Non-goals

No typing of cells; no UPDATE, no DELETE, no rollback; no stored answer, index, summary or cache in any store; no regex, user-defined function, `now()`, `random()`; no authentication or multi-user policy on `serve`; no federation beyond union by id; no triggers; no claim about speed (counts only); no claim that the nine verbs suffice for any domain other than the data named in PREREG.

---

## Appendix A. Worked examples on the project's real problems

Informative; they show the language reading real questions, not a test of it. Field names are illustrative.

**A1 Premiere replay (10,244 entries).**
```
-- who created the thing at address "clip:7": the roots of its slots, with the writer
INS(SEG(sources; addr: "clip:7"))

-- which lane wrote last, and what
REC(DEF(sources; collapse: ["history"]; sort: [_pos desc]; limit: 1); pick: ["_by", "_kind", "_addr", "_at", "_id"])

-- was anything in flight when entry #9f2c11aa was written (neither before nor after it)
CON(SEG(sources; ids: [#9f2c11aa]); follow: "full"; dir: "concurrent"; in: sources)

-- everything it read, transitively, and which parts belong to which of two conflicting heads
CON(SEG(sources; ids: [#9f2c11aa]); follow: "of"; dir: "up"; depth: "*")
```
**A2 Ellison trial log (764 entries).**
```
-- what did he say and on what basis, with the tier the extractor claimed
REC(SEG(sources; kinds: ["attributed"]); set: {tier: json_get(_basis, "$.claimed_tier")}; pick: ["_addr", "text", "tier", "_held"])
```
**A3 Held values and pasts (act-tag, intelligence test).**
```
-- what is held at address A and how many pasts survive: one row per head, _held is the survivor count
SEG(sources; addr: "A")

-- the same, as it was read at a past position, with the ground of that position
DEF(SEG(sources; addr: "A"); asof: "2026-11-12T18:00:00Z")

-- the same, for a reader who sees only one writer; then the collapse that discards values but still reports how many
SIG(SEG(sources; addr: "A"); perceiver: {writers: ["w1"]})
DEF(SEG(sources; addr: "A"); collapse: ["effective-latest"])

-- counterfactual: what would be held if writer w2 had never written (the log is not touched)
SEG(sources; addr: "A"; drop: {writers: ["w2"]})
```
**A4 Writes** (assuming the kinds `request-raised` and `verified` have been declared at INS and EVA cells by their owner).
```
WRITE DEF(declare: "view"; like: "holon");                       -- bootstrap, the cell is copied
WRITE INS("clip:7"; kind: "request-raised"; body: {"reporter": "a"}; as: l1);
WRITE EVA("clip:7"; kind: "verified"; of: [@l1]; body: {"ok": true}; as: l2);
WRITE NUL(@l2; why: "checked against the wrong take");           -- retraction, nothing deleted
```
**A5 SQL core, through the translator.** See 8.5.

---

## Appendix B. Checklist for the reader of this spec

Counts: **9 verbs; 8 frame arguments** (`asof schema collapse anc ordering` on DEF; `perceiver budget return` on SIG); **5 extra primitives** (`P-FIX P-TERM P-PARAM P-LABEL P-WRITE`) **and 3 closed vocabularies** (`V-FN V-AGG V-WIN`); **8 CLI commands** (`run explain export import serve dump view sql`); **9 formats**; **23 laws**; **14 mutant hooks**.
