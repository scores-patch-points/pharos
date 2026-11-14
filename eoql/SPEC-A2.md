# EOQL/1 amendment A2: holding all 27 positions

Status: SPEC-A2, written 2026-11-14 by the spec designer, stamped (`SPEC-A2.md.sha256`, `SPEC-A2.md.time`). It obeys `PREREG.md`, `PREREG-A1.md`, `PREREG-A2.md` (Part A is its brief; Part B concerns tests) and adds to `SPEC.md` and `SPEC-A1.md` (stamped, not edited). It is a specification, not a result: nothing in it has been run. Not opened: `qa/ground-truth.json`, `qa/truth.mjs`, `answers/`, `src/`, `pharos/log`.

Source note: the brief names `ledgers/pharos-lazy/cells.json`; that path does not exist. The same file exists at `ledgers/pharos-lazy/baseline/cells.json` and `ledgers/pharos-lazy/src/cells.json` (identical, sha256 `a8eb76c95b47ee130a0d75ddfa76eec3fbf5841c3a626d36779d3c7bd6607c44`); that is the table read here. Its `chain` is `NUL SIG INS SEG CON SYN DEF EVA REC`, its `grains` are `Ground Figure Pattern`, its 27 `cells` have `id` of the form `OP·Grain` (the separator is U+00B7, a middle dot) and `rank` 0 to 26.

## 0. Rules of this file

* **A2 only ADDS.** Every definition of SPEC and SPEC-A1 stands. A statement that SPEC or SPEC-A1 accepted keeps its meaning. Two places where A2 permits a form SPEC refused or left open are named and are the only ones: 1.3 (a cell literal in one clause of `declare`) and 4.5 (`of` optional for a non-`retract` NUL write). Nothing is renamed or narrowed. New result keys (`cell_basis`, `form`, `explain.frame.grain`) are additions; removing them from any envelope gives the SPEC/A1 envelope (law L24).
* **Declared theory.** Every row of every table in section 4 is **DECLARED**. Nothing here is earned: the tests check sensitivity and representability, not that the reading is right.
* **Cells are never inferred.** EOQL never infers, defaults, normalizes or validates a cell beyond "is it one of the 27 ids". Labels are writer-typed and unchecked: nothing verifies that an entry's label matches what the entry does. Every result field that carries a cell says so (section 2.5).
* The 27 ids, the 9 operators and the 3 grains come from `cells.json` as DATA at run time. EOQL code MUST NOT contain a list of them (a closed vocabulary supplied by data; counted in section 6 as `V-CELL`).
* No wall-clock claims. Counts are of entries, rows, bytes, records.
* Words MUST, SHOULD, MAY are RFC 2119.

## 1. `declare` takes a cell literal: a pass-through

### 1.1 The clause

SPEC 4.2 allowed `WRITE DEF(declare: N; like: K2; schema: ...)` only, copying the cell from the declaration of `K2`. A2 adds an alternative:

```
WRITE DEF(declare: "request-raised"; cell: "INS·Figure"; schema: ["reporter", "text"])
```

| clause | type | meaning |
|---|---|---|
| `cell` | S (a constant string term or a bound `:param`) | the cell of the declared kind, written exactly as given |

Exactly one of `like` and `cell` MUST be present. Both present: `E_BAD_CLAUSE_VALUE` with `detail {"clause":"cell","conflict":"like"}`. Neither: the SPEC outcome (`E_BAD_CLAUSE_VALUE`).

### 1.2 What "pass-through" means (exhaustive)

1. The only check is **membership**: the string is byte-equal to the `id` of one of the 27 entries of `cells.json`. No case folding, no Unicode normalization, no substitution of `.` or `-` for U+00B7, no trimming. Anything else: `E_UNKNOWN_CELL`, `detail {"given": <the string>, "source":"cells.json", "count":27}`. The error carries no suggestion and no nearest match, and nothing is written.
2. No inference: EOQL does not look at the kind's NAME, at the verbs later used with it, at its `schema`, or at other declarations to choose, adjust or confirm the cell (mutant KM4). Renaming a kind while keeping its cell changes no result (K4).
3. No default: a missing cell is an error (1.1), never a fallback to some cell (mutant KM2).
4. The check is made at PLAN time over the whole script (SPEC 4.1), before any statement runs: a script with an unknown cell appends nothing.
5. The entry appended is the same entry SPEC's `like` form would append for that cell: `{kind: "kind", addr: "kind:N", body: {name: N, cell: <the literal>, schema?}}` at the library's own cell for `kind` entries (`DEF·Figure`). Same fields give the same id as a direct `weave` (test F2). The declared cell may have any operator and any grain, including `SIG` and every Pattern cell (mutant KM5): the declaration entry itself sits at `DEF·Figure`; only later writes of kind `N` are checked against the declared cell.
6. The library's own refusal stands: redeclaring `N` at a different cell is refused by `weave` (`KIND_REDECLARED`), surfaced as `E_VERB_KIND`. Redeclaring at the same cell with a different `schema` is allowed.

### 1.3 What changes in the write rules, exactly

* SPEC 4.2: "A cell literal anywhere in a statement is `E_CELL_TYPED`" gains ONE exception: the `cell:` clause of `WRITE DEF(declare: ...)`. Every other `cell` clause key in a WRITE (on any verb, on `DEF` with `view:`, or on a `declare` nested elsewhere) stays `E_CELL_TYPED`. Detection is by clause key; a string inside `body` that happens to equal a cell id is data and is not detected.
* SPEC 4.2: the `declare` form accepts `cell:` as an alternative to `like:`.
* SPEC 4.2: a write of kind `K` still takes its cell from `K`'s declaration, never from the statement, and the verb written MUST equal `op(cell of K)` (`E_VERB_KIND`). So after A2 a cell is typed exactly once per kind, at its declaration, by its writer, and never again.
* SPEC 9.2 open question 1 is resolved in favour of a literal, at declaration only (user requirement relayed 2026-11-14). The cost is stated: a writer can now declare a label that misdescribes the kind; EOQL does not and cannot detect that.
* SPEC 4.6 semantic dump: the default output is unchanged. A2 adds an OPT-IN option `cells: "literal"` (library `dump(h, {mode:"semantic", cells:"literal"})`, CLI `dump --cells literal`): every `kind` entry is written as `WRITE DEF(declare: N; cell: "<its cell>"; schema: ...)`, so no kind is "not expressible" and the manifest no longer lists `undeclared-cell kinds` as lost. A replay into a system whose `cells.json` lacks a dumped cell is `E_UNKNOWN_CELL` at plan time, whole script refused.
* SPEC 4.3 receipt: gains the top-level key `cell_basis: "declared-by-writer"` (2.5).
* Open question resolved separately by A2 (4.5): for a NUL write whose kind is not `retract`, `of` may be empty.

## 2. Cell, operator and grain as filter and group dimensions

### 2.1 Virtual columns `_op` and `_grain`

`_op = op(_cell)` and `_grain = grain(_cell)`, looked up in `cells.json`; NULL when `_cell` is NULL or is not one of the 27 ids (never an error, never a default). They are VIRTUAL: legal in any term (`where`, `on`, `by`, `agg`, `set`, `sort`, `order`, `pick`, a SEG `where` over raw entry columns), but NOT part of the default projection of `rows(W)`, not in the `return: "pointers"` set, and not in catalog relations. So no existing result gains a column. `_cell` is unchanged (SPEC 1.4).

Bind-time literal checks: a comparison (`= == != <> is is not in not in`, list members and bound params included) of `_op` with a string must name an operator of `cells.json`, else `E_UNKNOWN_OP`; of `_grain`, a grain, else `E_UNKNOWN_GRAIN`. For the existing column `_cell` the result of a comparison with a non-cell string is unchanged (empty or false, as in SPEC) and the run adds gap `W_UNKNOWN_CELL_LITERAL` (with the literal), so an unknown label is never silent but no SPEC statement changes meaning.

### 2.2 SEG selectors

`SEG` `keep` and `drop` (and the shortcut clauses, like `addr`, `kinds`) gain three selectors:

| selector | type | matches an entry when |
|---|---|---|
| `cells` | L of S | `entry.cell` is in the list |
| `ops` | L of S | `op(entry.cell)` is in the list |
| `grains` | L of S | `grain(entry.cell)` is in the list |

They match the entry's OWN stored `cell` (the writer's label), not its kind's declared cell. An unknown member: `E_UNKNOWN_CELL`, `E_UNKNOWN_OP`, `E_UNKNOWN_GRAIN`; never an empty result. They are NOT slot-closed (SPEC 2.4): an entry merged verbatim may carry a cell that disagrees with its kind's declaration. They MUST be applied after the slot is read and before heads are computed, like `writers`; an adapter may use its own index for cost only. `SEG(X; cells: [c])` equals `SEG(X; where: _cell in [c])` (SPEC); the selector adds validation. SEG is a re-fold of a sub-log: hiding a layer hides its retractions too, and a protocol `retract` entry is always labelled `NUL·Figure` whatever the layer of its target, so `SEG(X; grains: ["Ground"])` re-folds with retractions of Ground entries absent. This is SEG's meaning, not a defect, and is stated so a reader does not expect otherwise.

### 2.3 Filter, group, join, sort

| use | form | note |
|---|---|---|
| filter the LOG by cell, operator or grain | `SEG(X; cells: [...])`, `ops: [...]`, `grains: [...]` | refolds (hidden entries are absent) |
| filter ROWS after the fold | `EVA(X; where: _op is "EVA")`, `_grain in ["Ground","Pattern"]`, `_cell is "CON·Link"`... | keeps the log's ancestry |
| at a layer, with the layer's reading rule | `V(X; grain: g; ...)` (section 3) | |
| group | `REC(X; by: [_op])`, `SYN(X; by: [_op, _grain]; agg: {n: count(*)})`, `by: [_cell]` | groups with no member produce no row |
| window partition, sort, join key | `REC(...; order: [_grain asc])`, `DEF(...; sort: [_op])`, `CON(...; on: l._op = r._op)` | ordinary terms |
| the full grid, zero-filled | `SYN(X; cube: true)` | section 5 |

### 2.4 Clause order and printing

`grain` is the FIRST clause in every verb's clause table; `cube` and `count` are the last two in SYN's table. The canonical print (SPEC 4.5) uses this order, so stored views that contain A2 constructs print deterministically.

### 2.5 The marker `cell_basis: declared-by-writer`

Value (exact string): `declared-by-writer`. Meaning: the cell was supplied by whoever wrote the entry or declared its kind, nothing checks it, and the result rests on that label.

A column is **cell-carrying** (CCC) iff one of: (a) its name is `_cell`, `_op` or `_grain`; (b) it is a catalog column named `cell` (`entries`, `heads`, `conflicts`, `latest_causal`, `kinds`); (c) it is a column named `cell` in a raw-world relation that includes a live row of kind `kind`; (d) it is a cube column (section 5); (e) its defining term (`set`, `agg`, `by` key, `rename`) mentions a CCC or a JSON path ending in `.cell`. Over-marking is allowed; under-marking is a defect (mutant KM7).

Where the marker appears:

| result | marker |
|---|---|
| envelope (SPEC 5.1) | `columns[i].cell_basis` on every CCC; and top-level `cell_basis`, present iff at least one column is CCC OR the statement used a cell, operator or grain dimension anywhere (a selector, `grain:`, `_op`, `_grain`, `cube`), even if no cell column is returned (a count over `ops: ["EVA"]` rests on labels). Absent otherwise |
| receipt (SPEC 4.3) | top-level `cell_basis`, covering `appended[*].cell`; present whenever `appended` or `merged` is nonempty |
| manifest (SPEC 6.1) | top-level `cell_basis` when the inventory holds cell counts (section 7) |
| `explain.findings` items that carry a `cell` | `cell_basis` on the item |

## 3. Positions on reads: the `grain:` clause

### 3.1 Position, and the clause

A **position** is a pair (verb, grain). Its cell id is `op·grain` by lookup in `cells.json`; it is never typed (a `grain:` value is one of the three grain names; the cell follows from the verb). Every verb accepts one new optional clause:

| clause | type | meaning |
|---|---|---|
| `grain` | S | `"Ground"`, `"Figure"` or `"Pattern"`: evaluate this call at the position (verb, grain). Unknown value: `E_UNKNOWN_GRAIN`. Absent: the call is evaluated as in SPEC and SPEC-A1, with no layer logic at all |

A call whose `grain:` has nothing to act on is `E_GRAIN_NOT_APPLICABLE` (the rule column of 3.3 says when). `grain` is not a frame argument: it is carried by nothing, applies to its own call only, and is recorded in `explain.frame.grain` (a list of `{verb, grain, rule, collapse_source, layer_rows, unseen_refs, unlabelled_rows}`, one per call).

### 3.2 Layers (definitions)

* **Layer** `L_g(E)`: the entries of `E` with `grain(entry.cell) = g`, by the entry's stored cell (the writer's label). Layer membership is by LABEL, never by role. The protocol's own entries show why this matters: `frame` is `NUL·Ground`, but `kind` is `DEF·Figure`, `holon` is `DEF·Pattern` and `retract` is `NUL·Figure`. So "Ground = declarations" is a role that the labels do not follow: a Ground-layer read of a log that uses only protocol kinds sees only the frame. (Finding F-A2-1; reported, not repaired.)
* **Row layer**: a row's layer is `grain(_cell)`. **Slot layer**: the grain of the cell of the slot's earliest-by-`pos` non-retract member. A slot whose members have different grains is reported in `explain.findings` as `slot-mixed-grain` (and gap `W_GRAIN_SLOT_MIXED` with the count); its layer is the earliest member's, and its rows are sliced by their own cells.
* **Grain default collapse (G-DEFAULTS)**, a DECLARED table: Ground `["effective-latest"]`, Figure `["none"]`, Pattern `["drop-retracted"]`. Rationale (declared): a declaration in force is the latest live one (SPEC 1.1 already reads a kind's schema as latest by `pos`); instances are evidence and stay a superposition; a withdrawn write-back is not an output. SPEC 2.5 F3 precedence becomes: explicit F3 > chosen window's > the kind's read schema > **grain default** > `none`. The grain default exists only in a call that has `grain:`; no other call changes. It obeys law L9 (a collapse that discards values reports them): `explain.frame.collapsed` is present and `explain.frame.grain[*].collapse_source` is `"grain-default"` (or `"explicit"`). When the grain default collapses at least one Ground slot with `_held >= 2`, gap `W_GROUND_HELD` (with count): several declarations were in force and one was returned.

### 3.3 What `grain:` does, per verb (the rules)

| rule id | verbs and forms | definition |
|---|---|---|
| **RL** row layer | `EVA`, `REC`, `SYN` aggregate, `distinct` and set-operation forms (both operands), `CON` join (both sides) | the input rows are `rows(X)` derived with the grain default collapse (raw `X` only; on a derived `X` there is nothing to derive and only the slice applies), then restricted to rows with `grain(_cell) = g`. The fold, retractions and `pos` are those of the whole `X`; the slice comes after. Rows with NULL `_cell` are excluded and counted in `unlabelled_rows`. A derived `X` with no `_cell` column: `E_BIND_FIELD` |
| **WK** walk layer | `CON` follow | seeds, and every node and link entry walked or reached, must be in `L_g`. An edge leaving the layer is not followed and is counted in `explain.frame.grain[*].unseen_refs`; it is NOT `incomplete` (the layer was asked for). Walking from a write-back to what it read is the call without `grain` |
| **GN** genesis layer | `INS(X)` genesis; `INS(; entries: [...])` | genesis: the roots of the slots whose layer is `g`, roots computed in the whole `X`. `entries` form: the world of those supplied entries with `grain = g`. `INS(; rows:...)` with `grain`: `E_GRAIN_NOT_APPLICABLE` |
| **EV** evidence family | `NUL` with `gaps` or `expect` | the grain selects which family of negative-space evidence is reported (4.1, rows 1 to 3). `NUL(X; grain: g)` with neither clause: `E_GRAIN_NOT_APPLICABLE` |
| **SC** scope | `SEG` (`keep`, `drop`, `cascade`), `SIG` (`perceiver`), `DEF` (`asof`) | the restriction acts on `L_g` only; every entry of the other layers is kept. With `E` the entries of the raw input: `SEG`: `(E \ L_g) ∪ L_g(SEG-result over E)`, cascade removing only entries of `L_g`; `SIG`: `(E \ L_g) ∪ (vis_P(E) ∩ L_g)` with `vis_P` computed over all of `E` (a horizon walks ancestry through any layer); `DEF asof`: `(E \ L_g) ∪ (cut_c(E) ∩ L_g)`, the cut computed over all of `E` (a `{pos: n}` cut counts over the whole causal order). The result is re-folded. `SIG` with only `budget` or `return`, `DEF` with only `collapse anc ordering schema sort limit offset bind fix`, and `SEG` with `table:` and `grain`: `E_GRAIN_NOT_APPLICABLE` (those are not entry restrictions of a layer; they are layer-blind) |
| **IM** import layer | `SYN(X; with: Y; grain: g)` merge form | `Φ(E_X ∪ L_g(E_Y))`: adopt only layer `g` of `Y` |

### 3.4 Reducibility (law L-A2-3, the honest claim)

Every `grain:` form except the NUL evidence families equals an expression that existed before A2, up to `explain`, `gaps` and `cell_basis`, whenever no higher-precedence collapse source applies and slots have a single grain. Let `Λ_g` be `_cell like "%·g"`.

* RL: `V(EVA(DEF(X; collapse: [R_g]); where: Λ_g); ...)`, `R_g` the G-DEFAULTS rule.
* WK: `CON(...; in: SEG(in; where: Λ_g))` (pre-A2 would mark the dropped edges `incomplete`; A2 counts them as `unseen_refs`: this is the only non-equality).
* GN: `INS(SEG(X; where: Λ_g))`.
* SC: `SYN(SEG(X; drop: {where: Λ_g}); with: SEG(R; where: Λ_g))` with `R` the unscoped restriction over `X`.
* IM: `SYN(X; with: SEG(Y; where: Λ_g))`.

So A2's positions add validated names and one compact notation; they add no read reach, except the evidence families of NUL·Ground and NUL·Pattern (new) and the zero-fill of the cube. A test that finds the equality failing means `grain:` is a primitive, not sugar, and the count of section 6 rises (section 6).

## 4. The 27 positions

### 4.1 Read

Every row is **DECLARED**. "Differs from siblings by" names what separates the three grains of the same verb. "Observable when" says what the log must contain for the three positions to give different answers; a test needs that content, nothing else does.

| # | position | READ: `V(X; grain: g; ...)` | differs from siblings by | observable when |
|---|---|---|---|---|
| 1 | NUL·Ground | **EV-G.** `NUL(X; grain: "Ground"; gaps: true)`: one row `{_reason, _where, _ids, _incomplete}` per piece of ground evidence: `undeclared-kind` (kind of a live entry with no live declaration), `unused-kind` (declared, no live entry of it), `cell-kind-disagreement` (a live entry whose cell differs from the cell of the first live declaration of its kind), `redeclared-cell` (live declarations of one name at different cells). With `expect: [kind names]`: a row per name with no live declaration (`never-declared`, `all-retracted`) | evidence family about kinds | always (different evidence) |
| 2 | NUL·Figure | **EV-F.** SPEC 1.6 evidence over live Figure-layer entries: dangling `of`/`seen` ids, with global corrupt/torn lines and open cuts; `expect: [addresses]`: addresses with no live Figure-layer entry (`never-written`, `all-retracted`, `out-of-window`) | family about instances | always |
| 3 | NUL·Pattern | **EV-P.** `pattern-never-written` (a kind in some live `holon`'s `pattern` or `out` list has no live entry; `_where` is the holon name), `pattern-no-basis` (a live Pattern-layer entry with empty `of`), `pattern-basis-withdrawn` (a live Pattern-layer entry with a retracted `of` target), `pattern-basis-dangling`; `expect: [addresses]`: no live Pattern-layer entry | family about write-backs | always |
| 4 | SIG·Ground | **SC** on `perceiver`: the reader knows only part of the ground; all instances and patterns stay, read through the declarations the reader knows | which layer the window cuts | the layers differ in content |
| 5 | SIG·Figure | **SC**: instances hidden by the window, ground and patterns whole | same rule, Figure layer | same |
| 6 | SIG·Pattern | **SC**: write-backs hidden, ground and instances whole | same rule, Pattern layer | same |
| 7 | INS·Ground | **GN**: roots of Ground slots: who first declared a ground item (`_by`, `_at`) | same rule, Ground layer | same |
| 8 | INS·Figure | **GN**: roots of Figure slots: who created the instance (SPEC genesis) | same rule, Figure layer | same |
| 9 | INS·Pattern | **GN**: roots of Pattern slots: who first wrote an output back at the address | same rule, Pattern layer | same |
| 10 | SEG·Ground | **SC**: cut declarations only; counterfactual "this declaration never existed", instances stay (their kind becomes undeclared; row 1 reports it) | cuts Ground | same |
| 11 | SEG·Figure | **SC**: cut instances only; ground kept, so schemas and read-schema columns survive (unlike `SEG(...; kinds: [...])`, which also removes declarations) | cuts Figure | same |
| 12 | SEG·Pattern | **SC**: cut write-backs only | cuts Pattern | same |
| 13 | CON·Ground | join: **RL** over Ground rows (default `effective-latest`); follow: **WK** within Ground: lineage of declarations (what each superseded) | default collapse (join); layer (follow) | a Ground slot held or retracted (join); layers differ (follow) |
| 14 | CON·Figure | join: **RL** (default `none`: the SPEC reading); follow: **WK** within Figure: the SPEC walk, without leaving instances | same | same |
| 15 | CON·Pattern | join: **RL** over Pattern rows (default `drop-retracted`); follow: **WK** within Pattern: output-to-output lineage, not output-to-input | same | same |
| 16 | SYN·Ground | aggregate: **RL**, a kind counted once though two declarations are concurrent, row `_held` 2, gap `W_GROUND_HELD`; merge: **IM**, adopt only `Y`'s Ground layer | default collapse (aggregate); imported layer (merge) | held or retracted Ground slot (aggregate); layers differ (merge) |
| 17 | SYN·Figure | aggregate: **RL**, `none`, an aggregate over a superposition is held (SPEC); merge: **IM**, `Y`'s instances only | same | same |
| 18 | SYN·Pattern | aggregate: **RL**, withdrawn outputs excluded (`drop-retracted`); merge: **IM**, `Y`'s write-backs only | same | same |
| 19 | DEF·Ground | **SC** on `asof`: declarations after the cut are ABSENT from the world (unlike `schema: C`, which keeps them and only reads through the older ground; the `kinds` catalog and row 1 differ) | cut applied to Ground | declarations after the cut |
| 20 | DEF·Figure | **SC**: instances as of the cut, every later declaration and write-back present | cut applied to Figure | entries after the cut in several layers |
| 21 | DEF·Pattern | **SC**: write-backs (and the views and loops that are Pattern-labelled) as of the cut; later outputs absent | cut applied to Pattern | same |
| 22 | EVA·Ground | **RL**: judge declarations (default `effective-latest`) | default collapse | held or retracted Ground slot |
| 23 | EVA·Figure | **RL** with `none`: SPEC's reading plus the slice | | |
| 24 | EVA·Pattern | **RL** with `drop-retracted`: judge unwithdrawn outputs | | |
| 25 | REC·Ground | **RL**: reinterpret declarations (the read-schema reading of SPEC 2.4 REC lives here if the writer declares `schema` at `REC·Ground`; SPEC's example does not name a grain) | default collapse | same |
| 26 | REC·Figure | **RL** with `none` | | |
| 27 | REC·Pattern | **RL** with `drop-retracted` | | |

### 4.2 Write

`WRITE V(...; kind: K)` appends an entry of a kind `K` declared at `V·g`; its cell is the declaration's (SPEC 4.2). The rest of the write rules are the verb's (SPEC 4.2 table); A2 gives each position no further write rule. Position-specific facts:

| position | write |
|---|---|
| NUL·Ground | protocol kind `frame`: a frame or epoch, `assumed` list for cross-frame claims; a second frame merges, never conflicts. Other kinds: writer-declared, `of` optional (4.5). Fold effect: none |
| NUL·Figure | protocol kind `retract` (the default of `WRITE NUL`): `of` nonempty, hides its targets of ANY layer; the retraction itself is a Figure-layer entry. The only position whose write changes what the fold shows |
| NUL·Pattern | no protocol kind. A writer-declared kind records the withdrawal of an output (`of` = the outputs). Fold-neutral: it hides nothing, because only the kind `retract` hides. To unweave an output write `retract` |
| DEF·Figure | protocol kind `kind`: a declaration entry labelled at Figure although it governs reading (F-A2-1) |
| DEF·Pattern | protocol kind `holon` `{name, ground, figure, pattern, out}`; views are declared `like: "holon"` in SPEC's own example. The `pattern` and `out` lists drive row 3 |
| the other 23 positions | no protocol kind: the write requires a writer-declared kind at that cell (`E_UNDECLARED_KIND` until declared, 1.1) and is the same mechanism at every one of them |

Verb conventions (all grains): `SIG` an attention event; `INS` a creation; `SEG` body `into`; `CON` body `to`, `rel`; `SYN` a fork resolution with `of: heads` (the held episode it ends is in the layer of the kind's cell); `DEF` a value of a kind declared at a DEF cell; `EVA` a judgement (`of` = judged entries); `REC` a reinterpretation (`of` = what is reinterpreted). `of` targets are not checked against layers. A blind write (empty `of` at an existing slot) is allowed at every grain, gives a held slot there and the SPEC warning `W_BLIND_WRITE`; no grain refuses one. Verbatim `WRITE SYN(; entries: [...])` is not a write at a position: the entries keep their own cells as data.

### 4.3 Where the label already changes a result in SPEC

The fold is label-blind except for two things: the kind `retract` (hides) and `rank`: concurrent entries are ordered by `(rank(cell), id)` (SPEC 1.2.3), so `_pos`, any sort by `_pos`, and `latest` between mutually concurrent heads depend on the cell. Swapping the label of one entry (a different entry, new id; there are no in-place edits) can therefore move it in `pos`, as well as move it between layers.

### 4.4 Findings declared in advance (for test K3)

* **Same rule, different layer only (12 positions):** SIG·Ground, SIG·Figure, SIG·Pattern; INS·Ground, INS·Figure, INS·Pattern; SEG·Ground, SEG·Figure, SEG·Pattern; DEF·Ground, DEF·Figure, DEF·Pattern. Within each verb the three positions run one rule with `g` as a parameter. They differ in answers only because the layers hold different entries.
* **Different default rule, observable only on held or retracted slots (12 positions):** EVA, REC, SYN-aggregate and CON-join at the three grains. On a log whose slots in the layer are single-headed and unretracted, the three positions of one verb give the same rows modulo the slice. The WK and IM forms of CON and SYN are of the layer-only kind.
* **Different by evidence family (3 positions):** NUL·Ground, NUL·Figure, NUL·Pattern.
* **Write side:** the 23 positions other than NUL·Ground, NUL·Figure, DEF·Figure, DEF·Pattern behave identically on write (append an entry of a kind declared there). Among those four only `retract` changes the fold.
* Nothing is decorative on read: with the layer rule, relabelling an entry always changes some position's answer. That is a consequence of the declared reading, not evidence that it is right.
* **Position as a name (L-A2-3):** 24 of the 27 read forms are reducible to pre-A2 expressions (3.4).
* **Real coverage:** the real logs use 11 of 27 cells (Ellison 6, Premiere replay 10; no Pattern-grain and no SIG entry). Evidence for the other 16 positions is synthetic and must be labelled so.

### 4.5 NUL writes with no target

SPEC 4.2 says a NUL write's `of` is "required, nonempty". A2 reads that as applying to `retract` only: for a NUL write whose `kind:` is declared and is not `retract`, `of` MAY be empty (the address is then the first segment, as for the other verbs, and `addr:` is not required). This makes NUL·Ground and NUL·Pattern entries writable for kinds with no target, which K1 needs. `retract` is unchanged.

## 5. The cube view

`SYN(X; cube: true)`, optionally with `cube: "grid"` (same), `cube: "long"`, and `count: "entries" | "live" | "heads"`.

* **What is counted** (raw `X`, by the entry's own `cell`): `entries` (default): every entry of `X`, retract entries and retracted entries included, de-duplicated by id; `live`: live entries (SPEC 1.2.5); `heads`: live entries that are heads of their slot under the world's `anc`. A derived `X`: rows counted by `_cell`; `count` other than the default is `E_BAD_CLAUSE_VALUE`; rows with NULL `_cell` are not in the grid, are reported as `form.unlabelled`, and raise `W_CUBE_NO_CELL` with the count.
* **Grid layout** (default): a derived world of exactly 9 rows, in the `chain` order of `cells.json`, with columns `op`, then one integer column per grain in `grains` order (so `Ground`, `Figure`, `Pattern`), then `total`. Every cell appears, with 0 where nothing is labelled; no two grains are ever merged into one column (mutant KM3). `total` is the row sum. **Long layout:** 27 rows `{cell, op, grain, n}` in `rank` order, zero-filled.
* `cube` excludes `by`, `agg`, `distinct`, `with`, `mode` (`E_BAD_CLAUSE_VALUE`). It combines with `grain:` (a slice: only that grain's column can be nonzero) and with any world: `SYN(SEG(sources; ops: ["EVA"]); cube: true)` is the grid of the EVA entries.
* The envelope gains `form: {"name":"cube","v":"eoql-cube/1","count":<mode>,"layout":"grid"|"long","nonzero":n,"of":27,"unlabelled":n}`; `nonzero` is the number of cells with a count above 0 (the "11 of 27" figure for a real log). All five columns carry `cell_basis`.
* Rows' `row_meta`: `src: []` (provenance of a cube is `explain.entries_read`, which lists every entry counted; per-cell ids come from `SEG(...; cells: [c])`); `held: 1` and `determined: true` unless `incomplete` evidence exists; for `count: "heads"`, `held` is the maximum `_held` of the slots counted in that row.
* Equality with the existing machinery (law L25): for every nonzero cell `c`, `grid[op(c)][grain(c)]` equals the `n` of `SYN(X; by: [_cell]; agg: {n: count(*)})` at `c`. What the cube adds is the zero-fill and the fixed 9 by 3 shape. In SQL over the projection the same counts are `SELECT cell, count(*) FROM entries GROUP BY cell`; the cube is NOT a beyond-SQL feature and must not be reported as one.
* Cost: a cube over a placed store reads the whole log (not slot-closed); `plan` says `access.method: "scan"`.

## 6. Extra primitives

| item | count | note |
|---|---|---|
| new verbs | 0 | |
| new frame arguments | 0 | `grain` is a call clause, carried by nothing, defined by reducible rules (3.4) |
| **extra primitives beyond the nine verbs and the frame arguments** | **0** | headline |
| extra closed vocabularies | **1** | `V-CELL`: the 27 cell ids, 9 operators, 3 grains, `rank` and the G-DEFAULTS table, supplied by `cells.json`; used by `declare cell:`, selectors, `_op`, `_grain`, `grain:`, `cube`. Same kind as `V-FN V-AGG V-WIN` |
| SPEC extras after A2 | 5 primitives + 4 vocabularies = 9 (SPEC: 8) | |
| new clauses (not primitives) | `grain` (all nine verbs), `cube` and `count` (SYN), `cell` (DEF declare), selectors `cells ops grains` (SEG) | |
| new virtual columns | `_op`, `_grain` | lookups into `V-CELL` |
| new EXT readings (PREREG T(c)) | 3: NUL·Ground evidence, NUL·Pattern evidence, `SYN cube` | the Figure evidence restricts SPEC's |
| new typed outcomes | errors `E_UNKNOWN_CELL E_UNKNOWN_OP E_UNKNOWN_GRAIN E_GRAIN_NOT_APPLICABLE`; gaps `W_UNKNOWN_CELL_LITERAL W_GROUND_HELD W_CUBE_NO_CELL W_GRAIN_SLOT_MIXED`; finding `slot-mixed-grain` | |

Conservative count: if test K3 or the L-A2-3 check shows a `grain:` form not equal to its pre-A2 expression (3.4), `grain` is a primitive (a per-call collapse default and a layer restriction) and the count is 1 primitive and 1 vocabulary. `explain.primitives` lists `V-CELL` whenever one of the A2 constructs is used.

## 7. Converters carry cell and grain

`grain` is never stored: it is `grain(cell)`, so a format that keeps `cell` keeps operator and grain, and a format that drops `cell` drops both. A2 adds three loss attributes to SPEC 6.2: **cell** (the `cell` field of an entry, hence operator and grain), **grain** (a grain marginal differs: a grain lost, merged or reassigned), **cell_basis** (the result marker, 2.5).

| format.profile | cell (op and grain) | grain | cell_basis | how the cell is carried |
|---|---|---|---|---|
| `jsonl`, `blocks`, `lazy` | Y | Y | n/a | the `cell` field inside the entry bytes |
| `sqlite` | Y | Y | n/a | `entries.cell`, `kinds.cell`, the `(addr, cell)` keys of `heads`, `conflicts`, `latest_causal`; decode reads the cell, recomputes the id, and a swapped label gives `sqlite-id-mismatch` |
| `sqldump` entries | Y | Y | n/a | the `cell` column of each INSERT |
| `csv` entries | Y | Y | n/a | the `cell` column |
| `json` entries | Y | Y | n/a | the `cell` key |
| `eot` entries | Y | Y | n/a | the second token of the block header; an edited cell fails the id check (`E_ID_MISMATCH`) |
| `eoql` verbatim | Y | Y | n/a | inside the entry literal |
| `eoql` semantic | Y for entries of kinds whose declaration is expressible; with `cells: "literal"` Y for all | as `cell` | n/a | recomputed from the kind's declaration at replay; otherwise listed as lost |
| `csv` rows | Y if the result has a cell column | Y only if `_cell` is present (a result that kept `_op` and dropped `_grain` has lost grain: listed) | **N** (RFC 4180 has no place for it: listed) | the column as text |
| `json` rows | as csv rows | as csv rows | Y (key `cell_basis` added to the profile object when applicable) | the column |
| `json` result | Y | Y | Y (the full envelope) | the envelope |
| `eot` view | Y (the `OP·Grain` address on each node) | Y | Y (a header line `cell_basis declared-by-writer`) | the node |
| `sqldump` derived | as csv rows | as csv rows | Y (comment line `-- cell_basis: declared-by-writer`) | the column |

Measurement (SPEC 6.1: measured, not declared). `Inventory` gains `cells_sha256` (sha256 of the sorted lines `id<TAB>cell`, empty for no cell), `cube` (counts of the 27 cells, zero-filled, plus `unlabelled`) and `has_cell_basis`. `convert` compares input and re-decoded output:
* `cell` loss: for every id in both, `cell_out != cell_in` or the cell is absent: `count`, `ids` (up to 1000), `ids_digest`; for outputs that lost ids (query-result profiles) the comparison is on the `cube` counts instead.
* `grain` loss: the per-grain marginals (sum over operators) of `cube_in` and `cube_out` differ: `detail` lists `{grain, n_in, n_out}` for each grain that differs. A converter MUST NOT write a cell different from the one it read: re-labelling is refused as `E_NOT_REPRESENTABLE` or reported as `cell` loss with the changed ids, never silent (mutant KM6).
* `cell_basis` loss: the input is a result carrying the marker and the output cannot carry it.
`declared_possible` gains the attributes this pair could lose from the table. Pair rule: a pair can lose `cell` iff the source has Y and the target does not (profile by profile). A conversion with a nonempty `cell`, `grain` or `cell_basis` loss and no `acceptLoss` stops with `E_LOSSY` before writing, as SPEC 6.1 says for every loss.

Foreign import (SPEC 6.4): the entry's cell is the declared cell of the kind named by the caller; a foreign column or key called `cell`, `op` or `grain` is body data and is never read as the entry's cell. `basis` is unchanged (A2 adds no key).

Compile-back (SPEC-A1 4.2): A2 adds no reason. `grain:`, the selectors, `_op`, `_grain` and `cube` over a raw world are `raw_world`, with `held_sets` when the grain default collapses; the NUL families are `incomplete_range`; `declare cell:` is `write`.

## 8. Interfaces added (the test author calls exactly these)

* Library: `E.cells()` returns `{ v:"eoql-cells/1", sha256, chain, grains, cells }`, the parsed `cells.json` and its file hash. `E.dump(h, {mode:"semantic", cells:"literal"})`. `E.VERSION.cube = "eoql-cube/1"`, `E.VERSION.cells = "eoql-cells/1"`.
* CLI: `dump --cells literal`. No new command. (SPEC 7.3's eight plus A1's two stay ten.)
* Language: clause `cell` on `WRITE DEF(declare: ...)`; clause `grain` on all nine verbs; `SYN` clauses `cube`, `count`; `SEG` selectors `cells`, `ops`, `grains`; virtual columns `_op`, `_grain`.
* Result keys: top-level `cell_basis`, `columns[i].cell_basis`, `form`, `explain.frame.grain`; receipt `cell_basis`; manifest `cell_basis`, inventory `cells_sha256`, `cube`, `has_cell_basis`.
* Codes: see section 6. `E.CODES` gains them.

## 9. Laws and hooks

* **L24 additivity.** Removing the A2 keys from any envelope of a statement that uses no A2 construct gives the SPEC/A1 envelope.
* **L25 cube conservation.** The grid sums to the number counted; `total` equals the row sum; each cell equals an independent count of the log by exact cell (K5); it equals `SYN by [_cell]` on every nonzero cell.
* **L26 reducibility.** Each `grain:` form equals its 3.4 expression (modulo the stated exception).
* **L27 label independence.** Renaming a kind without changing its declared cell changes no result (K4).
* **L28 flow.** For every id-lossless pair of entry profiles, `cells_sha256` in equals out.
* **L29 marker completeness.** Every result with a CCC, or that used a cell dimension, carries `cell_basis`.

Mutants: KM1 drop grain and keep operator only: L26, the cube's three grain columns, `grains` selector. KM2 normalize an unknown cell silently: 1.2, `E_UNKNOWN_*`, plan-time check. KM3 cube merges grains: section 5 shape, L25. KM4 infer the cell from the kind name: 1.2.2, L27. KM5 reject SIG or Pattern cells: 1.2.5, K1 over all 27. KM6 a converter drops the grain: section 7 measurement. KM7 a result omits `cell_basis`: 2.5, L29.

## 10. Open questions

1. **Layer by label or by role.** The protocol labels `kind` at Figure and `holon` at Pattern while the declared reading calls declarations Ground (F-A2-1). A role-based layer would need a second declared dimension; not added.
2. **G-DEFAULTS** (Ground latest, Pattern drop-retracted) are declared and untuned; they make the grains differ only on held or retracted slots.
3. **Retraction layer.** A retraction of a Ground entry is a Figure-layer entry, so a layer slice by `SEG` drops it.
4. **Verbatim entries.** An entry whose cell disagrees with its kind's declaration is accepted by merge and reported by row 1 only.
5. **Cube cost** is a full read on a placed store.
