# EOQL/1 amendment A1: the v1 crosswalk, SQL in, SQL out

Status: SPEC-A1, written 2026-11-13 by the spec designer, stamped (`SPEC-A1.md.sha256`, `SPEC-A1.md.time`). It obeys `PREREG.md` and `PREREG-A1.md` (both stamped). It is a specification, not a result: nothing in it has been run, and nothing in it is measured.

Read to write it: `SPEC.md` (stamped, not edited), `PREREG.md`, `PREREG-A1.md`, and the pinned v1 source in `prior/eo-activibase/` (`eo_query_language.js`, `eo_query_parser.js`, `eo_query_compiler.js`, `eo_query_crosswalk.js`, `test_eoql.js`). The v1 files were READ as data and never executed, so every statement below about what v1 does is "by reading the source", not "observed". Not opened: `qa/ground-truth.json`, `qa/truth.mjs`, `answers/`, `src/`, `pharos/log`.

## 0. Rules of this file

* **A1 only ADDS.** Every definition in `SPEC.md` stands as written. Where A1 uses a SPEC name it says which section it relies on. Where A1 adds a name, section 7.1 lists it so the additions can be audited: new CLI commands, library functions, a source scheme, error codes, gap ids, not-compilable reason ids, and version strings. Nothing in SPEC is reinterpreted, narrowed or renamed.
* Words MUST, SHOULD, MAY are RFC 2119.
* **The crosswalk (section 2) is DECLARED theory, not earned.** It says where a v1 job lands in the canonical verbs `NUL SIG INS SEG CON SYN DEF EVA REC` plus SPEC's frame arguments. No test result supports a landing yet; V1 to V3 of PREREG-A1 can only show that a landing computes the same rows, never that it is "the right" landing. Where a landing is a choice, it is marked CHOICE and is reversible by the user.
* No wall-clock claim anywhere. Counts are of bytes, records, rows, constructs and primitives.
* No cell is typed. Nothing in A1 touches cells; a write still names a kind and the kind's declaration supplies the cell (SPEC 4.2).

### 0.1 Headline counts (the checker's list)

| quantity | value | where |
|---|---|---|
| v1 operators (all appear in the crosswalk) | 9 (`NUL DES INS SEG CON ALT SYN SUP REC`) | 2.1 |
| v1 operators whose name AND job both survive in v2 | 2 fully (`SYN` aggregate, `CON` join), 1 partly (`INS` literal rows) | 2.1 |
| SQL/holon constructs placed | 31 rows | 2.2 |
| extra primitives (beyond 9 verbs and 8 frame arguments) the crosswalk EXERCISES | **7 of SPEC's 8 extras**: `P-TERM P-FIX P-PARAM P-WRITE V-FN V-AGG V-WIN` (`P-LABEL` is not exercised) | 2.3 |
| extra primitives A1 ADDS to SPEC's list | **0** | 2.3 |
| v1 jobs with NO landing | 5 | 2.4 |
| extra primitive that closing one of those would need | 1 (named `P-CORR` here, NOT added) | 2.4 |
| new CLI commands | 2 (`parse`, `compile`); SPEC's 8 become 10 | 3, 7.1 |
| compile targets implemented | 5 (`sqlite postgres mysql sqlserver oracle`); only `sqlite` is executable here | 4 |
| declared future targets, not implemented | 2 (`mongodb`, `pandas`) | 5 |

## 1. Vocabulary and one warning

* `v1:X` is a v1 operator, `X` a v2 verb. `v1 REC` means **recurse** (iterate to a fixed point; v1's own definition: "Recursive queries, fixed-point iteration"). `REC` in SPEC means **recontextualize** (change what rows mean without changing which rows there are, SPEC 2.4). The two share a name and nothing else. v1's recursion lands in `DEF fix/base/step` (P-FIX) and `CON follow ... depth: "*"`; v2's `REC` is where v1's projection, aliasing and window jobs land.
* The same collision runs through the table: v1 `SEG` is "segment rows" (a row filter, limit, group, distinct); SPEC `SEG` cuts the LOG (SPEC 2.4). v1 `INS` is FROM (a source); SPEC `INS` on read is genesis or literal rows. A reader who maps verbs by name is wrong outright for 3 of the 9 v1 operators (`NUL`, `SEG`, `REC`) and wrong in part for a fourth (`INS`) (2.1).
* v1 is "EOQL v1, December 2025, public repo eo-activibase (an earlier public repository by the same author), HEAD 88e1359..., files pinned in `prior/PINS.sha256`". Section references like "v1 compiler" mean the pinned files.

## 2. The v1 to v2 CROSSWALK [DECLARED, not earned]

### 2.1 By v1 operator

Each row: v1's own one-line definition (from `EO_OPERATORS` in `eo_query_language.js`), the SQL jobs v1 gives it, where each job lands in v2, and the extras the landing needs. "Same name" is called out because it misleads.

| v1 operator | v1 definition and SQL jobs | landing in v2 | extras used |
|---|---|---|---|
| `NUL` | "Handle absence and null values": `IS NULL`, `IS NOT NULL`, `COALESCE`, `NULLIF`, `IFNULL`; param `propagate` | Null tests and defaults are TERMS: `x is null`, `x is not null`, `coalesce(..)`, `nullif(..)`, three-valued propagation is V1 semantics (SPEC 1.4.5). Absence made visible by a join is `CON ... join: "left"\|"anti"\|"anti_null"`. SPEC's `NUL` (observe without transforming, `expect`, `gaps`, retract on write) has NO v1 job: it is new. **Same name, different job.** | `P-TERM`, `V-FN` |
| `DES` | "Designate identity, name, or classify": select list, `AS`, `CAST`, `CASE WHEN`; param `classify` takes a host (JS) function | Select list and alias: `REC(.; set: {name: term}; pick: [names]; rename: {old: new})` (SPEC 8.1, 2.4). `CAST` and `CASE`: V-FN `cast`, `case`. A host `classify` function has no landing (2.4, J1). No v2 verb is named for designation. | `P-TERM`, `V-FN` |
| `INS` | "Instantiate source or create new entities": `FROM`, `INSERT INTO`, `VALUES`, `CREATE` | `FROM t` is `SEG(sources; table: "t")` (SEG, not INS; SPEC 8.1). `VALUES` is `INS(; rows: ...; columns: ...)` (same name, same job). `INSERT INTO` is `WRITE <op of the kind's cell>(...)` through SPEC 8.4 (optional tier). `CREATE` is `WRITE DEF(declare: N; like: K)` for kinds, never a cell (SPEC 4.2); SQL DDL stays gap `SQL_DDL`. | `P-WRITE` (writes only) |
| `SEG` | "Segment, filter, or partition data": `WHERE`, `GROUP BY`, `HAVING`, `LIMIT`, `OFFSET`, `DISTINCT` | `WHERE` is `EVA(where:)`; `HAVING` is `EVA` after `SYN`; `GROUP BY` is `SYN(by:)` (or `REC by` then `SYN`); `LIMIT`, `OFFSET` are `DEF limit/offset`; `DISTINCT` is `SYN(distinct:)`. SPEC `SEG` (cut the log) receives only `FROM table`. **Same name, different job.** | `P-TERM` (predicates) |
| `CON` | "Connect and relate data sets": joins and set operations (`UNION`, `INTERSECT`, `EXCEPT`) | Joins: `CON(to:, on:, join:)`, kinds `inner left right full cross semi anti anti_null`. **Same name, same job.** Set operations move to `SYN(with:, mode:)` (SPEC 2.4); v1 itself disagrees with itself here: its `Holons.UNION` emits `CON` while its own `RELATIONAL_ALGEBRA_MAPPINGS.UNION` says `SYN`. v2 follows the second. | none beyond `P-TERM` for `on` |
| `ALT` | "Alternate branches, sequence, or order": `ORDER BY`, `CASE`, `COALESCE`, `NULLS FIRST/LAST` | `ORDER BY` is `DEF(sort: [...])` including `asc desc nulls first last`. `CASE` and `COALESCE` are V-FN (`case`, `coalesce`). No v2 verb is named for alternation. | `V-FN` |
| `SYN` | "Synthesize and aggregate values": `SUM AVG COUNT MIN MAX STRING_AGG ARRAY_AGG GROUP_CONCAT`; param `combine` takes a host function | Aggregates are `SYN(by:, agg: {...})` over V-AGG. **Same name, same job.** `STRING_AGG`, `GROUP_CONCAT`, `LISTAGG` land on `group_concat`. `ARRAY_AGG` and a host `combine` have no landing (2.4, J1, J2). | `V-AGG` |
| `SUP` | "Superpose multiple contexts or layers": window functions (`OVER`, `PARTITION BY`, `LAG`...), `WITH` (CTE), subqueries | Windows: `REC(by:, order:, rows:, set: {w: f(..)})` over V-WIN. CTE: `DEF(; bind: {n: Q}; in: body)`. Subqueries: `CON ... join: "semi"\|"anti"\|"anti_null"`, `x in (E)`, an uncorrelated scalar subquery as a parenthesised world in term position, and a `FROM (subselect)` is simply a nested expression (closure, SPEC 3.3). v1's "superpose" has nothing to do with held values; SPEC's held-set superposition (1.3) is a different idea under a similar word. | `V-WIN`, `P-TERM` |
| `REC` | "Recurse or iterate until condition": `WITH RECURSIVE`, `CONNECT BY`, `START WITH`; params `anchor`, `recursive`, `maxDepth`, `until` | `DEF(; fix: "n"; base: anchor; step: recursive; mode: "union"\|"union_all"; in: body)` (SPEC 2.4, 8.1). `maxDepth` and `until` are carried as a depth column and a predicate inside `step` (terms, no new primitive). On a log, `CON follow ... depth: "*"`. **v1 `REC` means recurse; SPEC `REC` means recontextualize.** | `P-FIX`, `P-TERM` |

Tally for the "name AND job survive" claim in 0.1: `SYN` aggregate and `CON` join survive fully; `INS` survives for literal rows only; `NUL`, `SEG`, `REC` keep the name and change the job; `DES`, `ALT`, `SUP` have no v2 namesake. So of v1's 9 operators, 2 are carried over by name and job, 1 partly, 3 are name collisions, 3 dissolve into other verbs and the term language. The v2 verbs with no v1 job at all: `SIG` (perceiver, budget, return) and `EVA`'s log-aware meaning (v1's filter was `SEG where`); `DEF`'s frame arguments (as-of, schema, collapse, ancestry basis, ordering) are all new.

### 2.2 By SQL or v1 construct (31 rows)

Columns: `v1` is what v1 does (by reading); `v2 landing` cites SPEC; `extra` the SPEC extras the landing exercises (P-TERM is implied wherever a predicate or term appears and is written only where it is the only one); `A1 translator` says what `parse --from sql` MUST do: `translates` (SPEC 8.1 already requires it, or A1 requires it here), a gap id (SPEC 8.3 or A1-new, marked NEW), or `-` (no SQL surface).

| # | construct | v1 | v2 landing | extra | A1 translator |
|---|---|---|---|---|---|
| 1 | select list, `*`, `t.*` | `DES{columns}`; `*` ok; `t.*` throws (the parser expects an identifier after `.`) | `REC(.; set: {..}; pick: [..])`; `*` and `t.*` expanded from the catalog (SPEC 8.1) | P-TERM | translates; catalog required for `t.*` and for `*` over a join |
| 2 | alias (`AS`), rename | `DES{alias}` or `{alias: expr}` column | `REC set/pick` (the alias is the output column name) or `REC rename` | none | translates |
| 3 | computed columns (arithmetic, function, `CAST`) | `expr` nodes; `CAST` becomes `fn CAST` with the type as a string literal | `REC set` with V-FN `cast(x, "integer"\|"real"\|"text")` | V-FN | translates (SPEC 8.2) |
| 4 | `FROM t [AS a]` | `INS{source}` | `SEG(sources; table: "t")`, alias as `as:` | none | translates |
| 5 | `FROM (subselect) a` | parser does not accept it (`_parseTableRef` takes an identifier) | the subselect's translation, nested (closure) | none | translates |
| 6 | `WHERE` | `SEG{where}`, several are ANDed by the compiler | `EVA(where:)` | P-TERM | translates |
| 7 | `GROUP BY` (columns, expressions, ordinals) | `SEG{groupBy}`, identifiers only | `SYN(by: [terms]; agg: {..})`; ordinals substituted | V-AGG | translates; `GROUPING SETS`, `ROLLUP`, `CUBE`: gap `SQL_GROUPING_SETS` (NEW) |
| 8 | `HAVING` | `SEG{having}` | `EVA` after `SYN`, aggregates replaced by their names (SPEC 8.1) | V-AGG | translates |
| 9 | `LIMIT n [OFFSET m]`, `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, `LIMIT m, n` | first two forms parsed into two `SEG` nodes; `LIMIT m, n` is not parsed and the tail is dropped silently (2.5, V1-a) | `DEF(limit:, offset:)` | none | translates `LIMIT n [OFFSET m]`; the MySQL and FETCH spellings under tier T-SPELL, recorded in `accepted_spellings` (3.1) |
| 10 | `DISTINCT` | `SEG{distinct: true}` | `SYN(R; distinct: true)` | none | translates |
| 11 | `DISTINCT ON (cols)` (PostgreSQL) | `SEG{distinct: [cols]}`; the compiler emits `DISTINCT ON (..)` for EVERY dialect | landing exists with no new primitive: `EVA(REC(F; by: [cols]; order: [keys]; set: {_d: row_number()}); where: _d = 1)` | V-WIN | gap `SQL_DISTINCT_ON` (NEW): the landing is declared, the translator does not build it in A1 |
| 12 | `INNER`/`JOIN`, `LEFT`, `RIGHT`, `FULL`, `CROSS` `[OUTER] JOIN ... ON` | `CON{target, on, type}` | `CON(to:, on:, join:, as:, to_as:)` | none | translates |
| 13 | `JOIN ... USING (c)` | `CON{using}` | `on: l.c = r.c` plus one merged column in the select list (SPEC 8.1) | none | translates |
| 14 | `NATURAL JOIN` | parsed as type `natural`; the compiler's join-type table has no entry for it, so it falls back to `INNER JOIN` with no condition (by reading) | none declared | - | gap `SQL_NATURAL_JOIN` (SPEC 8.3) |
| 15 | `[NOT] EXISTS (equality-correlated)`, `[NOT] IN (subselect)` | `in_subquery`/`not_in_subquery` expression nodes (compile to `IN (..)`); `EXISTS` not parsed | `CON ... join: "semi"\|"anti"\|"anti_null"`, or `x in (E)` (SPEC 8.1) | none | translates; other correlation: gap `SQL_CORRELATED_OTHER` (SPEC 8.3) |
| 16 | scalar subquery | `subquery` node; the compiler's expression formatter has no branch for it (by reading, it would print an object, not SQL) | uncorrelated: parenthesised world in term position (SPEC 2.7). Correlated: no landing (2.4, J3) | P-TERM | uncorrelated translates; correlated: `SQL_CORRELATED_SCALAR` (SPEC 8.3) |
| 17 | `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT`, Oracle `MINUS` | `CON{type}` (`MINUS` only in the crosswalk table) | `SYN(A; with: B; mode: ..)`, `MINUS` is `except` | none | translates; `MINUS` under T-SPELL |
| 18 | `ORDER BY` (asc, desc, expression, alias, ordinal, `NULLS`) | `ALT{orderBy:[{field,direction,nullsFirst}]}`; an expression key (aggregate, function) is carried as an object and the compiler prints `field` as a string, so by reading it prints an object | `DEF(sort: [..])` | P-TERM | translates |
| 19 | `CASE WHEN` (searched and simple) | parser builds `{type:'case'}`; the crosswalk file has `formatCaseExpression` but the compiler's `_formatExpr` has no `case` branch (by reading) | V-FN `case(p1, t1, ..., else)` | V-FN | translates (SPEC 8.2) |
| 20 | `COALESCE`, `NULLIF`, `IFNULL`, `ISNULL`, `NVL` | `NUL{coalesce\|default\|nullIf}`; as plain function names they pass through | V-FN `coalesce`, `nullif` | V-FN | translates; `IFNULL` (SPEC 8.2); `ISNULL` (two-argument) and `NVL` under T-SPELL as `coalesce` |
| 21 | `COUNT SUM AVG MIN MAX`, `COUNT(DISTINCT x)` | `SYN{aggregations}` or `agg` node; `distinct` is parsed and then ignored by the compiler's `agg` branch (by reading) | `SYN(agg: {n: count(distinct x)})` | V-AGG | translates |
| 22 | `STRING_AGG`, `GROUP_CONCAT`, `LISTAGG` | crosswalk entries; the compiler passes the function name through | `group_concat(x[, sep])` (default `,`, input order) | V-AGG | translates for `group_concat` and `string_agg(x, sep)`; an `ORDER BY` inside the aggregate or `WITHIN GROUP`: gap `SQL_AGG_ORDER` (NEW) |
| 23 | `ARRAY_AGG`, `JSON_ARRAYAGG`, `JSON_GROUP_ARRAY` | crosswalk and dialect config only | none: V-AGG is a closed list (SPEC 2.7) | - | gap `SQL_ARRAY_AGG` (NEW) |
| 24 | `agg(..) FILTER (WHERE p)` | not parsed | `agg(case(p, x))` (SPEC 8.2) | V-AGG | translates |
| 25 | window functions, `PARTITION BY`, frames, named `WINDOW` | `SUP{window}`; the parser keeps the frame as a raw string; `PARTITION BY` identifiers only | `REC(by:, order:, rows: [lo, hi], set:)` over V-WIN; one `REC` per distinct window spec (SPEC 8.1) | V-WIN | translates; `GROUPS`, `EXCLUDE`, `RANGE` with offset, `FILTER` on a window: `SQL_WINDOW_FRAME` (SPEC 8.3) |
| 26 | `WITH n AS (Q)` (CTE) | `SUP{cte}` | `DEF(; bind: {n: Q}; in: body)` | none | translates |
| 27 | `WITH RECURSIVE` | `REC{anchor, recursive}` in the builder; the parser stores `{ctes, isRecursive}` instead, and the compiler then reads `anchor` and `recursive` from it, so by reading a parsed recursive query does not compile | `DEF(; fix: "n"; base:; step:; mode:; in:)` (P-FIX, SPEC 8.1 linear form) | P-FIX | translates the linear form; other shapes `SQL_RECURSIVE_SHAPE` (SPEC 8.3) |
| 28 | `CONNECT BY`, `START WITH` | crosswalk entries only, no parser | same landing as 27 (P-FIX) | P-FIX | gap `SQL_CONNECT_BY` (NEW) |
| 29 | `INSERT INTO t VALUES`, `INSERT ... SELECT` | `INS{operation:'insert', values\|select}` | `WRITE <op>(addr; kind: K; body:..)` for `INSERT INTO entries`; any other table `SQL_INSERT_SHAPE` (SPEC 8.4) | P-WRITE | optional tier (SPEC 8.4) |
| 30 | `UPDATE`, `DELETE`, upsert, `RETURNING` | `INS{operation:'update'\|'delete'}`; the compiler's `INS` handler reads only `source`, so by reading an update or delete compiles to a plain `SELECT ... FROM t [WHERE ..]` | `DELETE` is `WRITE NUL([ids])` (retraction). `UPDATE` has no landing by design: a new value is a new entry that cites the old (SPEC 4.4). Upsert, returning: none | P-WRITE | `DELETE` optional tier; `SQL_UPDATE`, `SQL_UPSERT`, `SQL_RETURNING` (SPEC 8.3) |
| 31 | placeholders `?`, `:n`, `@n`, `$n`; values in text | v1 inlines values (quote-doubling only); the tokenizer silently skips characters it does not know, so `?` vanishes | `:name` params (P-PARAM, SPEC 2.6, 8.2): values enter as data, never re-lexed | P-PARAM | translates |

### 2.3 Extras ledger: what the crosswalk needs, by name

PREREG C5 makes the count of extra primitives a finding. A primitive is an extra when a landing needs it and it is neither one of the nine verbs on read or write nor one of the 8 frame arguments (SPEC 2.6). This list says which of SPEC's eight extras the crosswalk REQUIRES, by the jobs above. It adds no extra of its own.

| extra | jobs in 2.1/2.2 that need it | what v1 did instead |
|---|---|---|
| `P-TERM` (term language, V1 values, three-valued logic) | every predicate, arithmetic, `CASE`, `CAST`, `LIKE`, `IN`, `BETWEEN`, null tests, join conditions, sort keys | v1 also needed a separate language outside its nine operators: `Expr`/`ExpressionTypes` (about 40 expression types). Parity, not a saving. |
| `V-FN` | `coalesce nullif case cast json_get strftime least greatest` and the rest of the closed list | v1's function vocabulary is OPEN: any function name passes into the SQL text unchecked. v2 is closed; a function outside the list is a typed gap, not a pass-through. |
| `V-AGG` | `count sum total avg min max group_concat`, `DISTINCT` inside | v1 `SYN` carries the function name as a string, open vocabulary |
| `V-WIN` | `row_number rank dense_rank ntile lag lead first_value last_value nth_value`, aggregates over a window | v1 `SUP` carries the function name as a string, open vocabulary |
| `P-FIX` (fixed point) | `WITH RECURSIVE`, `CONNECT BY`, `maxDepth`/`until` iteration, and on logs `CON depth: "*"` | v1 spent a VERB on it (`REC`). v2 spends a primitive: the nine verbs of v2 do not include recursion. |
| `P-WRITE` (the `WRITE` marker) | `INSERT`, `DELETE`, `CREATE` of a kind | v1 put `operation: 'insert'\|'update'\|'delete'` as a parameter of `INS` |
| `P-PARAM` | `?`/`:n` placeholders in SQL input; placeholders in compiled SQL | v1 has none |
| `P-LABEL` | not exercised by any v1 job or by the A1 interfaces | - |

**Count: 7 of SPEC's 8 extras are exercised (5 primitives minus `P-LABEL` = 4, plus 3 vocabularies = 7); 6 are needed by v1 jobs, and the seventh (`P-PARAM`) by the SQL placeholders the A1 interface has to accept. A1 adds 0.** For T(a) of PREREG the measured number remains the one test T reads from `explain.primitives`; this paragraph predicts nothing about it.

Three honest remarks the count hides:
1. **The nine-verb claim is smaller than it looks for the relational core.** v1's `DES`, `ALT`, `SUP` dissolved, but the cost moved to the term language and the three vocabularies. v2 relocates the SQL expression machinery out of the verbs; it does not remove it. By the PREREG measure v2 is NOT smaller than v1: v1 is 9 verbs plus one expression language; v2 is 9 verbs plus 8 frame arguments plus 8 extras. The additions buy log semantics (frames, held sets, writes, labels, parameters), which is the point of v2 and is not what the crosswalk measures.
2. **A world-carried "grouping annotation" is stated in SPEC 2.4 (`REC by` groups the world; the next `SYN` consumes it) and is neither a verb nor one of the 8 listed frame arguments nor in the extras list.** The crosswalk never relies on it: the translator emits `SYN(by: [...])` directly (SPEC 8.1). Only the holodeck seed form `REC(by x)` then `SYN(Count)` needs it. It is flagged here as an uncounted state of SPEC for the report to decide on; A1 does not count it and does not change it.
3. **`table:` and the SQL catalog (SPEC 1.8) are the bridge for every SQL landing.** They are SPEC's, are not an extra, and carry a lot of weight: without a relation catalog `FROM` has nothing to name.

### 2.4 v1 jobs with no landing (5)

| id | v1 job | why it has no landing | what the system does |
|---|---|---|---|
| J1 | host functions as parameters: `DES.classify`, `SYN.combine`, holon definitions as JS functions | v2 terms are a closed language; a host function would break determinism (SPEC L1) and the injection bar (L19) | `fromV1` (3.4) raises `SQL_V1_HOSTFN` (NEW); no SQL surface exists |
| J2 | `ARRAY_AGG` family | V-AGG is a closed list; no array value type among V1 values | gap `SQL_ARRAY_AGG` (NEW) |
| J3 | correlated scalar subquery, `LATERAL` | needs per-row evaluation of an inner world: a correlation primitive. Name used here: `P-CORR`. **Not added by A1.** | gap `SQL_CORRELATED_SCALAR` / `SQL_CORRELATED_OTHER` (SPEC 8.3). If it were added, the SPEC extras would be 9, not 8 |
| J4 | `UPDATE` | EOQL has no edit (SPEC 4.4, 9.3) | `SQL_UPDATE` (SPEC 8.3) |
| J5 | `upsert`, `RETURNING` | write constructs outside SPEC 8.4 | `SQL_UPSERT`, `SQL_RETURNING` (SPEC 8.3) |

### 2.5 What v1 does that A1 will NOT reproduce (read from source, not run)

The conformance corpus is v1's tests (V1), so the places where v1's own code departs from its own stated intent matter. By reading, these are the departures; the V1 and V3 runs MUST record them as v1 defects when they cause a difference, rather than as v2 misses. None is a claim about what v1 "really" outputs until V3 runs it.

* **V1-a** `parse()` returns after one statement and never checks the end of input: trailing tokens are dropped silently (a second statement, `LIMIT m, n`, `FOR UPDATE`, `QUALIFY`, a window clause). v2 is total and never translates a prefix (SPEC 8.3, last paragraph).
* **V1-b** Unknown characters are skipped by the tokenizer, so `?`, `$1`, `@p`, `::` casts lose their first character rather than failing.
* **V1-c** `x NOT LIKE p` and `x NOT BETWEEN a AND b`: the parser consumes `NOT`, finds no `IN`, falls through, and parses `LIKE` or `BETWEEN` without the `NOT`. By reading, the negation is dropped silently.
* **V1-d** `COUNT(DISTINCT x)`: `distinct` is parsed and the compiler's `agg` branch does not print it.
* **V1-e** `CASE`, window expressions and scalar subqueries parse into node types the compiler's expression formatter has no branch for; an aggregate or function as an `ORDER BY` key is carried as an object and printed as a string. By reading these print as an object, not SQL.
* **V1-f** `NULLS LAST` is parsed as `nullsFirst: false` and the compiler only reads `nullsFirst` (true) and `nullsLast` (never set), so `NULLS LAST` is lost for every dialect; `NULLS FIRST` is dropped on MySQL and SQL Server.
* **V1-g** An `OFFSET` with no limit prints `LIMIT ALL OFFSET n` (and `ALL` inside the other dialects' templates), valid only on PostgreSQL; SQL Server and Oracle `OFFSET .. FETCH` is printed with no `ORDER BY` check.
* **V1-h** `INSERT`/`UPDATE`/`DELETE` are parsed into `INS{operation: ...}` and the compiler's `INS` handler reads only `source`: by reading, they compile to a read query on the table. v2 write statements MUST NOT have any path that turns a write into a read or a read into a write (SPEC 4.1, mutant M9).
* **V1-i** `HolonRegistry.import` evaluates a function-valued string with `eval` after a regular-expression denylist. v2 has no `eval` path anywhere (SPEC 7.5, L19).
* **V1-j** Values are written into SQL text by doubling single quotes only: no backslash handling (MySQL), no placeholders.
* **V1-k** Of the dialect configuration keys only `limitOffset`, `booleanTrue/False`, `ilike`, `nullsFirst/Last` have a code path in the compiler. `stringConcat`, `stringAgg`, `arrayAgg`, `dateFormat`, `jsonExtract*`, `returning`, `upsert` are configuration with no reader. Section 4.4 reproduces all of them as data and says which v2 actually uses.
* **V1-l** `test_eoql.js` has 64 `test(` calls (counted by `grep`, which differs from PREREG-A1's "about 55"; the test author's count governs). Almost all assertions are `assertContains` on the generated text; none executes SQL. So "v1 passes its own tests" says little about row equality, which is why V1 runs on a fixture database.

## 3. Interfaces (fixed now; the test author calls exactly these)

All of SPEC 7 stands. A1 adds the following. Conventions of SPEC 7.3 apply: one JSON document on stdout, `--pretty`, errors on stderr as `{"error":{...}}` exit 1, usage errors exit 2, a query inline or `-f FILE` or `-` for stdin.

### 3.1 `parse`

```
node bin/eoql.mjs parse --from sql <text|-f FILE|->  [--catalog <source>] [--strict] [--pretty]
node bin/eoql.mjs parse [--from eoql] <text|-f FILE|->                      [--pretty]
node bin/eoql.mjs parse --from v1ast <json|-f FILE|->   (OPTIONAL tier T-V1AST, 3.4) [--catalog <source>] [--strict]
```

`--from sql` turns ONE SQL statement into an EOQL expression and prints both forms:

```
{ "v":"eoql-parse/1", "ok":true, "from":"sql",
  "eoql":"<canonical text, SPEC 4.5>", "expr_hash":"<sha256 of eoql>",
  "ast":<the JSON serialization of the Node that E.parse(eoql) returns>,
  "params":["p1","name",...],             -- names, in order of first appearance
  "columns":["a","n",...],                -- output column names of the SQL statement
  "order_sensitive":false,                -- true iff the statement has an outer ORDER BY (SPEC 8.1)
  "accepted_spellings":[{"construct":"ILIKE","as":"like","pos":23}],
  "gaps":[] }
```

* `ast` shape is the implementation's `Node` (SPEC 7.1 does not fix it and A1 does not). The contract is only: `E.print(ast) === eoql`, `E.parse(eoql)` equals `ast` structurally, and `E.hash(ast) === expr_hash` (law L22).
* `ok:false`: `eoql`, `ast` are `null` and `gaps` lists EVERY gap met, each `{gap, construct, pos}` with the gap ids of SPEC 8.3 and the NEW ids of 2.2. A gap is a result, so it prints on stdout and exits 0. `--strict` turns a nonempty `gaps` into stderr `E_SQL_UNSUPPORTED` exit 1 (the code SPEC 5.3 already defines; `detail.gaps` the list).
* A SQL syntax error (not a gap) is `E_PARSE` on stderr, exit 1, with `pos` the character offset in the SQL text and `detail.lang: "sql"`. Empty input is `E_PARSE` at `pos` 0.
* `accepted_spellings` lists every place the SQL used a non-SQLite spelling that the translator normalized, so no normalization is silent. The accepted set (OPTIONAL tier T-SPELL; without it each is `SQL_DIALECT_SPELLING` NEW, a gap): `ILIKE` as `like`; `x::type` as `cast`; `STRING_AGG(x, s)` and `LISTAGG(x, s)` as `group_concat(x, s)`; `ISNULL(a, b)`, `NVL(a, b)`, `IFNULL` as `coalesce`; `MINUS` as `except`; `LIMIT m, n`, `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, `LIMIT ALL` as `limit`/`offset`; `<>` and `!=`; backtick, `[x]` and `"x"` identifiers. `CONCAT(a, b)` is NOT accepted (its NULL handling differs by engine: MySQL returns NULL, PostgreSQL and Oracle skip NULL arguments), so it is gap `SQL_DIALECT_SPELLING`. SQL that SQLite accepts parses identically with or without this tier.
* `--catalog <source>` names a source whose catalog (`E.sqlCatalog`, SPEC 7.1, or a `sqlrel:` source, 3.3) supplies column lists. Without it the catalog is the fixed one of SPEC 1.8 without any `k_<kind>` table. A table not in the catalog is gap `SQL_CATALOG_UNKNOWN` (NEW), never a guess.
* The translator MUST be total (law L19): returns the object above or throws `EoqlError`; never loops; never executes SQL; never interpolates text into the output (SPEC 8).

`--from eoql` (the default) is `E.parse` then `E.print`: `{"v":"eoql-parse/1","ok":true,"from":"eoql","eoql":...,"expr_hash":...,"ast":...}`; an error is `E_PARSE` as in SPEC 5.3.

### 3.2 `compile`

```
node bin/eoql.mjs compile --to sqlite|postgres|mysql|sqlserver|oracle <expr|-f FILE|->  [--catalog <source>] [--strict] [--pretty]
```

`postgresql` is accepted as an alias of `postgres` (v1's key). `<expr>` is EOQL text. One statement gives one object, several give `{"v":"eoql-compile/1","statements":[...]}` as `run` does.

Success:

```
{ "v":"eoql-compile/1", "ok":true, "dialect":"sqlite", "sql":"<text>",
  "params":["since"],                   -- placeholder names in the order they first appear
  "bind_order":null | ["since","since"],-- positional dialects only: the name for each ? or $n, in order
  "columns":["a","n"],                  -- output column names, equal to the envelope's columns (R-COLS)
  "order_sensitive":true,
  "expr_hash":"<sha256 of the canonical EOQL>",
  "fragment":"C-REL",                   -- 4.1
  "notes":[ {"code":"W_...","detail":...} ] }
```

Not compilable (an outcome, printed on stdout, exit 0):

```
{ "v":"eoql-compile/1", "ok":false, "dialect":"sqlite", "sql":null, "expr_hash":"...",
  "not_compilable":[ { "reason":"as_of", "class":"not_native",
                       "verb":"DEF", "clause":"asof", "path":"statements[0].DEF.asof", "pos":19,
                       "detail":"a re-fold of the log prefix; the SQL catalog holds one fold" } ] }
```

* The list holds EVERY reason found, not the first. A reason has a stable `reason` id (4.2), a `class`, the verb and clause (or term) that triggered it, an AST path, a character offset into the canonical text, and a short detail. Nothing is dropped silently: either the result is `ok:true` and every clause of the expression is present in the SQL (mutant M11 applied to the compiler: dropping a `HAVING`), or `ok:false` and the reasons say what is missing.
* `--strict` turns `ok:false` into stderr `{"error":{"code":"E_NOT_COMPILABLE",...,"detail":{"not_compilable":[...]}}}` exit 1 (NEW code).
* An EOQL syntax error is `E_PARSE` (SPEC 5.3) on stderr, exit 1. `--to` absent or not one of the five dialects, exit 2 with `E_USAGE` (NEW code; SPEC states exit 2 for usage errors but defines no code). `--to mongodb` and `--to pandas` are section 5.
* A `WRITE` statement is `ok:false` with reason `write`. Compilation never executes, never opens a log, and needs no source; `--catalog` is optional and used only for column lists (R-COLS, 4.1).

### 3.3 Library equivalents and the new source

```js
E.parseSql(sql, { catalog?, strict? })           -> the object of 3.1 (a superset of E.translateSql in SPEC 7.1, which stays and returns its subset)
E.compile(textOrScript, { to, catalog?, strict? }) -> the object of 3.2, or { v:"eoql-compile/1", statements:[...] }
E.dialects()                                     -> [{ id, aliases:[...], executable:bool, config:{...} }]   // the data of 4.4, one entry per implemented target
E.fromV1(ast, { catalog?, strict? })             -> the object of 3.1 with from:"v1ast"     // OPTIONAL tier T-V1AST
```
`parseSql`, `compile` and `fromV1` never throw for any argument except `EoqlError` (law L19); `compile`/`parseSql` with `strict` throw the codes above.

**New source scheme `sqlrel:<file>`** (adapter in `src/adapters/`, where `node:sqlite` is allowed). It opens an arbitrary SQLite file READ-ONLY whose tables and views are plain relations (not a pharos projection), for the V1 conformance corpus, whose tables (`users`, `orders`, `customers`, ...) are not entries.
* Its catalog is the file's own tables and views with their declared columns and affinities.
* `SEG(sources; table: "t")` is the only way in: a derived world of the table's rows, no system columns (like SPEC 1.8 `table:` worlds), in SQLite's own scan order (the adapter MUST NOT re-sort), each row `_held 1`, determined, not incomplete.
* There is no log: any raw-world operation (a `SEG` selector, `DEF` frame arguments, `CON follow`, `INS` genesis, `SIG`, `NUL expect/gaps`) on a `sqlrel:` root is `E_SOURCE_CAP`. A write is `E_NOT_PRIMARY`. `explain.entries_read` is `{count:0}` with the digest of the empty id list; `records_read` counts rows read.
* It is not one of the nine formats of SPEC 6 and takes no part in F1. It is a conformance fixture adapter, and it is a source, not a language primitive.

### 3.4 OPTIONAL tier T-V1AST: v1's AST in

V3 compares v2's dialect text with the text v1's own compiler makes, and v1's compile cases are builder pipelines (`EOQL.from('users').where({..})...`), not SQL strings. `fromV1` is the mechanical bridge so the test author need not hand-transcribe to SQL. Input: v1's `toAST()` JSON `{pipeline:[{operator, params}], ctes}`. The pipeline order is NOT the meaning: v1's compiler assembles one context from all nodes and prints it in fixed clause order, so `fromV1` reads it the same way: `INS source` gives the FROM; `CON` nodes in order give joins; all `SEG where` nodes AND together as `EVA`; `SEG groupBy` with the `SYN aggregations` and `DES columns` give `SYN`/`REC`; `SEG having` gives `EVA` after; `SEG distinct`; `CON` set operations; `ALT orderBy` gives `DEF sort`; `SEG limit/offset` give `DEF`; `SUP cte` gives `DEF bind`; `SUP window` gives `REC`; a `NUL`/`ALT case` expression becomes a term. The mapping IS the table of 2.2. A pipeline with a host function (J1) is gap `SQL_V1_HOSTFN` (NEW); a `REC` node without `anchor`/`recursive` (the parser's shape, 2.2 row 27) is gap `SQL_RECURSIVE_SHAPE`. If T-V1AST is not built, V3 uses SQL transcriptions by the test author and the report says so.

## 4. Compile: EOQL v2 to SQL

### 4.1 The compilable fragment C-REL and the output rules

SQL has no log, so EOQL compiles to SQL OVER THE CATALOG of SPEC 1.8 (or a `sqlrel:` catalog). An expression is in **C-REL** iff every world-valued subexpression is one of:

* `SEG(sources; table: T)` and nothing else in that `SEG` call;
* `INS(; rows: ...; columns: ...)`;
* a bound name from `DEF bind` or `DEF fix`;
* `NUL(X)` with no clause (the identity, law L3: compiled as `X`);
* `EVA`, `REC`, `SYN` (with `agg`, `by`, `distinct`, or `with:` and `mode` in `union union_all intersect except`, never `merge`), `CON` (with `to`, `on`, `join`, `as`, `to_as`, never `follow`), `DEF` (with `sort limit offset bind fix base step mode in`, never a frame argument) applied to worlds in C-REL;

and every term uses only V-FN, V-AGG, V-WIN items that have a lowering for the target (4.4). Everything else is `not_compilable` (4.2). The raw projection `rows(W)` of a log world is NOT in C-REL: SPEC 1.7 and 1.8 say EOQL's slot `(addr, kind)` with ancestry basis `slot` and the catalog's grouping `(addr, cell)` with `≺full` disagree on some logs, so no catalog query is DECLARED equal to a raw-world expression. A user who wants SQL gets it by naming a catalog relation with `table:`.

**R-COLS (column names).** The compiled statement's output column names, in order, equal `columns` of the EOQL envelope. Join outputs are named `alias.column` in EOQL (SPEC 2.4 CON), so a compiled join selects each column with an explicit `AS "l.col"`; that needs the column lists of the base relations: from the catalog (`--catalog`), or from a `REC pick` that already names them. A join whose columns cannot be known is `not_compilable` reason `catalog_required`.

**Lowering rules (text level; the correctness criterion is R-EQ on SQLite, not textual equality).** Flatten where it cannot change rows, wrap otherwise; wrapping is always legal.

* F1 `EVA` directly over a base, join or `CON` chain: `WHERE`. F2 `EVA` directly over `SYN` with `by`/`agg`: `HAVING`, aggregate names replaced by their definitions. Any `EVA` over `REC` that computes a window function, over a `limit`/`offset`, or over a set operation: wrap as a derived table.
* F3 `REC set/pick/rename` over a base: the select list with aliases; with window functions the `OVER (...)` clause per window spec. F4 `SYN by/agg`: `GROUP BY` plus select list; `SYN distinct: true`: `SELECT DISTINCT`. F5 `DEF sort`: `ORDER BY`; `limit`/`offset`: the dialect clause (4.4), at the end of a chain only: any verb applied over a limited world wraps it. F6 `CON`: a join clause per `CON`, in order, a compound right side as a derived table.
* F7 `SYN with/mode`: a compound `A <op> B`; members that carry `ORDER BY`/`limit` or that SQLite would reject parenthesised are wrapped as derived tables. F8 `DEF bind`: `WITH`; `DEF fix`: `WITH RECURSIVE` per dialect (4.4).
* Layout is v1's: one clause per line (`SELECT`, `FROM`, join lines, `WHERE`, `GROUP BY`, `HAVING`, set operations, `ORDER BY`, the limit clause), `AND`/`OR` groups and arithmetic parenthesised as v1's formatter does, keywords upper case, so V3's differences are semantic and listed (4.5), not cosmetic.

**Identifiers, literals, parameters.**
* A name is quoted iff it is not `[A-Za-z_][A-Za-z0-9_]*` or it is in the target's published keyword list (the implementer embeds the list and records its source and sha256 in `notes`). Quote characters per dialect: `"` for sqlite, postgres, oracle; backtick for mysql; `[ ]` for sqlserver. (v1 quoted only non-simple names and always with `"`.)
* A literal is printed by one literal printer: strings single-quoted with `'` doubled and no other escape; MySQL additionally doubles a backslash; a string containing NUL is `not_compilable` reason `unsupported_term`; numbers as canonical JSON numbers (an integer stays an integer, never `1.0`); booleans per 4.4; `NULL`.
* A `:name` param is NEVER replaced by its value. Placeholders per target: sqlite `:name`, sqlserver `@name`, oracle `:name` (all named, `bind_order` null); postgres `$1..$n` and mysql `?` (positional; a param used twice appears twice in `bind_order`). Values enter SQL only as printed canonical literals of the expression text or as bound params; there is no interpolation of anything else, and a string value containing `'; DROP` stays inside one literal (law L19 applied to the compiler).

**R-EQ (what "same answer" means, used by V2 and by 4.6).** Two results are equal iff: the same number of columns with the same names in the same order; the same multiset of rows, or the same sequence when the statement is `order_sensitive` AND the `ORDER BY` key is total over the result (the test author declares which; EOQL `sort` is stable, SQLite's tie order is unspecified, SPEC 8.1); cells equal by SQLite storage class AND value (`1`, `1.0`, `'1'` are three different cells; NULL equals NULL; text byte-wise); reals bit-identical when both sides were computed by SQLite (V2: the original SQL and the compiled SQL both run on SQLite). Where one side is the EOQL evaluator (L18, P1) the rule of PREREG P1 governs and A1 introduces no tolerance.

### 4.2 Typed `not_compilable` reasons (stable ids)

Two classes, and only one is evidence for C4:

* `not_native`: faithful SQL of the MEANING needs something SQL's table model does not hold: a survivor count under a frame, a re-fold of a sub-log, an evidence marker, per-row provenance, a cost ceiling. A hand-built SQL answer would need several statements, a recursive re-fold, or application code.
* `not_lowered`: SQL (perhaps with a recursive CTE, a JSON function, or an emulation) could say it, or the catalog could be queried directly, but THIS compiler does not produce it. A `not_lowered` count says nothing about SQL's power and MUST NOT be reported as evidence for C4.

| reason | class | triggered by |
|---|---|---|
| `held_sets` | not_native | `_held`, `_determined`, any `collapse` rule list, `anc` (F4), a raw world's rows read under `none` or `drop-retracted`; any use of survivor counts |
| `causal_latest` | not_native | a raw world's `_pos`, `ordering` (F5), `latest`/`effective-latest` over a raw world, `CON dir: "concurrent"`. (The catalog's `pos` column and `latest_causal` relation, reached with `table:`, ARE in C-REL: they are precomputed columns of the projection.) |
| `as_of` | not_native | `asof` (F1) and `schema` (F2): a re-fold of a prefix of the log with the ground of that prefix |
| `perceiver` | not_native | `SIG perceiver` (F6): a re-fold of a sub-log chosen by writer or horizon |
| `counterfactual` | not_native | `SEG drop`, `SEG(.. cascade)`, `INS(; entries: ..)`, `SYN` of two raw worlds (`mode: "merge"`) |
| `incomplete_range` | not_native | `_incomplete`, `NUL(.; gaps:)`, `NUL(.; expect:)` |
| `provenance` | not_native | `_src`, `return: "pointers"` (F8), any use of a row's entry ids as a result of the reading rather than a column |
| `cost` | not_native | `SIG budget` (F7). A budget is not silently dropped even though it changes no row: the refusal keeps the statement's meaning exact |
| `ancestry` | not_lowered | `CON follow` in any form (`of seen full link`, `dir up down both`, any `depth`); the `_branch _fork _episode _siblings` columns of a follow additionally carry `held_sets` (episodes are a replay of head sets: not_native) |
| `raw_world` | not_lowered | a log projection with none of the features above, for example `SEG(sources; addr: "x")`, `SEG(sources; kinds: [..])`, bare `sources`, `INS(X)` genesis: no catalog query is declared equal to it (4.1). Query the catalog with `table:` instead |
| `write` | not_native | any `WRITE` statement: SQL cannot compute the entry id (a hash of canonical content), the causal frontier `seen`, or the writer. SQL writes into the projection are not built (SPEC 8.4) |
| `unresolved_name` | not_lowered | a stored-view call or any name not bound by the expression itself (compile has no log). With a `--catalog` source that holds the view definition it MAY be inlined (SPEC 4.5: a view of a view equals the inlined expression) and then re-checked; without one it is refused |
| `catalog_required` | not_lowered | R-COLS cannot be satisfied (4.1) |
| `dialect_construct` | not_lowered | valid in EOQL, no faithful text in the target; `detail` names the construct and the target (4.4, 4.6) |
| `unsupported_term` | not_lowered | a V-FN/V-AGG/V-WIN item with no lowering for the target, or a literal the printer refuses |
| `fix_shape` | not_lowered | a `DEF fix` the target cannot say (4.4: `mode: "union"` on sqlserver or oracle) |

The reason list is closed for A1 and versioned `eoql-compile/1`; adding a reason later is an addition. For V2 the report prints, per question, `ok` or the reasons, and the counts per class and per reason; C4's evidence is the `not_native` count only, and the report SHOULD also print how many questions were refused only because of `raw_world` or `ancestry` (not_lowered), so the reader sees how much of the gap is the compiler's choice.

### 4.3 Round-trip rules

* **RT1 (SQL, EOQL, SQL).** For a statement `q` with `parse --from sql` `ok:true` over a SQLite database `D` (the pharos projection, or a `sqlrel:` fixture): let `e` be `parse(q).eoql` and `s` be `compile(e, sqlite).sql`. Then `s` runs on `D` and returns a result R-EQ to `q`'s. Textual equality of `s` and `q` is NOT claimed.
* **RT2 (EOQL, SQL, run).** For `e` in C-REL with `compile ok:true` over SQLite: running `s` on `D` and evaluating `e` with the EOQL evaluator over the same catalog give equal results (the P1 comparison). This is law L18 read in the other direction.
* **RT3 (normal form).** `compile(parse_sql(s))` for a compiler-made `s` is claimed to return the same `s` after one more round. This is a CLAIM with a test sketch, not a law; if it fails the failures are listed by construct (several EOQL spellings may flatten to one SQL, and one SQL to several EOQL).
* **RT4 (no silent partial).** A SQL statement is either translated with every clause present or `ok:false` with its gaps; an EOQL expression is either compiled with every clause present or `ok:false` with its reasons. A translator that drops `HAVING`, `DISTINCT`, `LIMIT`, a window or a join condition is mutant M11 (SPEC 9.1), and the same drop in the compiler is the same mutant.
* **RT5 (typed total).** `parse --from sql` returns the object of 3.1 or throws `EoqlError` for every input; `compile` returns the object of 3.2 or throws `EoqlError` for every input; neither throws anything else and neither loops.
* **RT6 (parameters).** Placeholders survive the round trip by name; the translated expression's `params` equal the SQL's; the compiled SQL binds the same values and returns the same rows.
* **RT7 (other dialects).** Equality of RESULTS is tested only on SQLite (PREREG V3: only SQLite is executable here). For `postgres mysql sqlserver oracle` the claim is text equivalence to v1's output on the v1 cases, with every difference listed (4.5), nothing more.

### 4.4 Dialects: v1's configuration reproduced as data, plus the lowering

`E.dialects()` MUST return this table as data (so the test can diff it against v1's `SQL_DIALECTS`). The first block is v1's own configuration, copied. "v1 uses" says whether v1's compiler has a code path (2.5 V1-k); "v2" says what A1 requires.

| setting | postgres (v1 key `postgresql`) | mysql | sqlite | sqlserver | oracle | v1 uses |
|---|---|---|---|---|---|---|
| `stringConcat` | `\|\|` | `CONCAT({args})` | `\|\|` | `+` | `\|\|` | no |
| `limitOffset` | `LIMIT {limit} OFFSET {offset}` | `LIMIT {offset}, {limit}` | `LIMIT {limit} OFFSET {offset}` | `OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY` | same as sqlserver | yes |
| `booleanTrue / False` | `TRUE` / `FALSE` | `1` / `0` | `1` / `0` | `1` / `0` | `1` / `0` | yes |
| `ilike` | `ILIKE` | `LIKE` (case-insensitive by default collation) | `LIKE` | `LIKE` (collation-dependent) | `LIKE` (v1 comment: use `UPPER()`) | yes |
| `stringAgg` | `STRING_AGG({field}, {separator})` | `GROUP_CONCAT({field} SEPARATOR {separator})` | `GROUP_CONCAT({field}, {separator})` | `STRING_AGG({field}, {separator})` | `LISTAGG({field}, {separator}) WITHIN GROUP (ORDER BY {field})` | no |
| `arrayAgg` | `ARRAY_AGG({field})` | `JSON_ARRAYAGG({field})` | `JSON_GROUP_ARRAY({field})` | none | none | no |
| `dateFormat` | `TO_CHAR({field}, '{format}')` | `DATE_FORMAT({field}, '{format}')` | `STRFTIME('{format}', {field})` | `FORMAT({field}, '{format}')` | `TO_CHAR({field}, '{format}')` | no |
| `nullsFirst / nullsLast` | `NULLS FIRST` / `NULLS LAST` | none | `NULLS FIRST` / `NULLS LAST` | none | `NULLS FIRST` / `NULLS LAST` | partly (V1-f) |
| `returning`, `upsert` | `RETURNING *`, `ON CONFLICT (..) DO UPDATE SET` | none, `ON DUPLICATE KEY UPDATE` | `RETURNING *`, `ON CONFLICT ...` | `OUTPUT INSERTED.*`, `MERGE` | `RETURNING * INTO`, `MERGE` | no (write constructs; not compiled, reasons `write`) |
| `jsonExtractText` | `{field}->>'{path}'` | `JSON_UNQUOTE(JSON_EXTRACT({field}, '$.{path}'))` | `JSON_EXTRACT({field}, '$.{path}')` | `JSON_VALUE({field}, '$.{path}')` | `JSON_VALUE({field}, '$.{path}')` | no |

v2 requirements per construct (each is DECLARED and, off SQLite, untested beyond text):

* **limit / offset (F5).** The `limitOffset` templates above. When only `offset` is present (v1 prints `ALL`): postgres `OFFSET m`; mysql `LIMIT m, 18446744073709551615`; sqlite `LIMIT -1 OFFSET m`; sqlserver and oracle `OFFSET m ROWS`. SQL Server requires an `ORDER BY` for `OFFSET`: when the chain has none, emit `ORDER BY (SELECT NULL)` and add note `W_UNORDERED_PAGE`. When only `limit` is present the template is used with offset `0`, as v1 does (`LIMIT n OFFSET 0`, `LIMIT 0, n`, `OFFSET 0 ROWS FETCH NEXT n ROWS ONLY`); on sqlserver the same `ORDER BY (SELECT NULL)` rule applies.
* **booleans.** `true/false` per the table; a predicate used as a value in a select list on sqlserver and oracle (no boolean type) is wrapped `CASE WHEN p THEN 1 ELSE 0 END`.
* **`||` (EOQL: NULL if either side is NULL).** postgres, sqlite `||`; mysql `CONCAT(a, b)` (NULL if any argument is NULL, so equal); sqlserver `a + b` with non-text operands wrapped in `CAST(.. AS NVARCHAR(MAX))`; oracle: `||` treats NULL as empty, so the faithful text is `CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE a || b END` (4.5 CD12).
* **`like` (EOQL: ASCII case-insensitive, `%` `_`, optional `escape`).** sqlite `LIKE`; postgres `ILIKE`; mysql `LIKE`; sqlserver and oracle `LOWER(a) LIKE LOWER(p)` (so the text does not depend on a collation). `glob`, `nocase`, `typeof`: sqlite only; elsewhere `dialect_construct`. The declared delta: postgres `ILIKE` folds non-ASCII case, SQLite `LIKE` does not.
* **`group_concat(x[, sep])`** (default `,`, input order): the `stringAgg` templates with the separator always written out. The oracle template orders by the field itself, which is NOT input order: a note `W_AGG_ORDER` is emitted and the result is not claimed equal on a non-SQLite engine. `ARRAY_AGG` has no V-AGG counterpart (gap `SQL_ARRAY_AGG`).
* **nulls ordering.** EOQL sorts NULLs first ascending and last descending (SPEC 2.4 DEF, "as SQLite"). sqlite: as written. postgres and oracle default to the opposite, so they ALWAYS get an explicit `NULLS FIRST` (ascending) or `NULLS LAST` (descending) unless the clause is written, to keep the EOQL meaning. mysql (NULLs first ascending by default, last descending): the default already matches; an explicit `nulls first/last` against the default is emulated by a leading key `(x IS NULL)` ascending or descending. sqlserver (same defaults as mysql): emulated by a leading `CASE WHEN x IS NULL THEN 0 ELSE 1 END` key. v1 drops the clause silently on mysql and sqlserver (V1-f).
* **recursion (`DEF fix`).** sqlite, postgres, mysql: `WITH RECURSIVE n(cols) AS (base UNION [ALL] step)`; sqlserver and oracle: the same without the word `RECURSIVE`, and a column list is always written; `mode: "union"` on sqlserver or oracle (they require `UNION ALL` in the recursive member) is `not_compilable` reason `fix_shape`, class not_lowered. v1 prints `WITH RECURSIVE recursive_cte AS (anchor UNION ALL step)` for every dialect.
* **set operations.** `except` on oracle is `MINUS`; `intersect` and `except` on mysql need a 8.0.31 or newer server (note `W_VERSION`); `union_all` everywhere.
* **join kinds.** `full` on mysql has no faithful text: `dialect_construct`. `full` and `right` on sqlite need a version that has them (note `W_VERSION`; the test author records the SQLite version of the Node used). `semi` and `anti` compile to `EXISTS` / `NOT EXISTS` (correlated by the `on` equality); `anti_null` to `NOT IN (SELECT ..)`.
* **terms.** `json_get(x, "$.a.b[0]")`: sqlite `json_extract(x, '$.a.b[0]')`; mysql `JSON_UNQUOTE(JSON_EXTRACT(x, '$.a.b[0]'))`; sqlserver and oracle `JSON_VALUE(x, '$.a.b[0]')`; postgres a single-key path `$.k` with v1's template `x->>'k'`, a deeper path `jsonb_path_query_first(x::jsonb, '$.a.b[0]') #>> '{}'` (declared, untested). `strftime(fmt, x)`: sqlite only; elsewhere `dialect_construct` (v1's `dateFormat` templates have no mapping of EOQL's `%Y %m %d %H %M %S %f %j %w %s` specifiers, and A1 does not invent one). `nulleq(a, b)`: sqlite `a IS b`; postgres `a IS NOT DISTINCT FROM b`; mysql `a <=> b`; sqlserver and oracle `unsupported_term`. `a / b`: written as `a / NULLIF(b, 0)` everywhere (EOQL: division by zero is NULL); on mysql and oracle, where `/` of integers is not integer division, an expression whose operands are not both statically REAL is `dialect_construct` (the types are unknown at compile time).

### 4.5 Differences from v1's text that are INTENDED (the V3 ruling basis)

V3 compares v2's text with v1's by running v1 under `node --permission`. A difference is expected only for the reasons below; any other difference is a finding. Each id is a reason the V3 report may cite.

| id | difference | basis |
|---|---|---|
| CD1 | offset without limit: v1 puts `ALL` as the limit inside every dialect's template; v2 per 4.4 | V1-g |
| CD2 | `NULLS LAST` kept (v1 loses it everywhere) | V1-f |
| CD3 | nulls ordering on mysql and sqlserver emulated (v1 drops it) | V1-f |
| CD4 | postgres and oracle: explicit null ordering on every `ORDER BY`, because their defaults differ from EOQL's; this changes the text of every sort for those two dialects | 4.4 nulls ordering |
| CD5 | v2 never emits `DISTINCT ON`; EOQL `distinct` with columns is a projection | 2.2 row 11 |
| CD6 | identifier quote per dialect (v1: `"` always) and keyword-list quoting | 4.1 |
| CD7 | mysql string literals double a backslash (v1 doubles `'` only) | V1-j |
| CD8 | recursion: `RECURSIVE` keyword, the CTE name, the column list, `UNION` vs `UNION ALL` per dialect (v1: `recursive_cte`, `UNION ALL`, `RECURSIVE` always) | 4.4 |
| CD9 | `MINUS` on oracle (v1 prints `EXCEPT`) | 4.4 |
| CD10 | `FULL JOIN` on mysql refused (v1 prints `FULL OUTER JOIN`) | 4.4 |
| CD11 | `like` lowered per dialect (v1 prints `LIKE`, or `ILIKE` only for its `ilike` type) | 4.4 |
| CD12 | oracle `||` NULL-propagation wrapper; mysql `CONCAT` (v1 prints the function name `CONCAT(a, b)` everywhere) | 4.4 |
| CD13 | v1 prints an object where it has no formatter branch (`CASE`, window expressions, scalar subqueries, an expression `ORDER BY` key); v2 prints SQL. NOT comparable; ruled "v1 defect (read)" | V1-e |
| CD14 | `COUNT(DISTINCT x)`: v2 keeps `DISTINCT`; v1 drops it | V1-d |
| CD15 | `NOT LIKE`, `NOT BETWEEN`: v2 keeps the negation; v1's parser drops it | V1-c |
| CD16 | a write statement: v2 refuses to compile (`write`); v1 prints a read query | V1-h |

### 4.6 Declared non-equivalences off SQLite

These are the places where a non-SQLite target is known not to match EOQL's V1 semantics even when the text is "right", so RT7 never claims equality there: Oracle treats the empty string as NULL (so `is set`, `||`, `length`, comparison with `''` can differ); `like` on non-ASCII text (postgres folds, SQLite does not); integer division on mysql and oracle (4.4); the mixed-type ordering of SQLite (NULL < numbers < text) which postgres, sqlserver, mysql and oracle either reject or order differently, so a `sort` over a column of mixed types is only claimed for sqlite; SQLite's affinity coercions on comparison (SPEC 8.2, R-AFF) which other engines do not apply; collations. None of these is tested; all are listed so a text match is not read as a semantic match.

## 5. MongoDB and Pandas: declared future targets, NOT implemented

v1's compiler header and language header name MongoDB aggregation pipelines and Pandas as future targets (`@eo_operator SYN`, "Future: MongoDB aggregation pipeline, Pandas, etc."). They are declared future targets here and nothing more:

* No mapping, crosswalk row, dialect configuration or code is specified for either. A1 makes no claim about them.
* `compile --to mongodb` and `compile --to pandas` (and the library with `to` set to either) MUST fail with `E_TARGET_UNIMPLEMENTED` (NEW), stderr, exit 1, `detail: {"declared_future": true}`. They MUST NOT print a partial, approximate or stubbed query.
* `E.dialects()` does not list them.
* This machine has neither a MongoDB server nor Pandas (PREREG V4), so no behaviour could be checked even if one were specified; if an engine appears, a new amendment adds the mapping and the test.

## 6. What v1 could not say about logs, and v2 can [DECLARED differences of expressive reach]

This table compares what the LANGUAGES contain, read from v1's source and SPEC. It measures no answers; P2 measures answers on QA's questions. "v1 could not say" means v1 has no construct for it and no source with the structure it needs; some of these can be approximated in SQL over a hand-built table, which is why the last column also gives the typed refusal for compiling back (`not_native` counts as evidence for C4, `not_lowered` does not).

| capability | v1 (by reading) | v2 | compile-back reason |
|---|---|---|---|
| as-of any log position | no log and no position. The nearest is a user `WHERE ts <= t` on a table that holds only the present state | `DEF asof` (a cut; the ground read as of the same cut; SPEC 1.2, 3.9) | `as_of` (not_native) |
| held values with survivor counts | none: a row holds one value per column; v1's `SUP` ("superpose") is windows and CTEs | `_held`, the `held` summary, collapse rules that still report what they discarded (SPEC 1.3, 3.5, 3.6) | `held_sets` (not_native) |
| causal, not clock, latest | `ORDER BY ts DESC LIMIT 1` or `MAX(ts)`: clock order, which clock skew defeats | `pos`, `latest`, `effective-latest`; an entry named in a later `of` is never a head whatever its `at` (SPEC 1.2, 1.7) | `causal_latest` (not_native; the catalog's `latest_causal` compiles) |
| ancestry, transitive, conflict aware | `REC` recursion over a parent column the user supplies; no `of`/`seen`, no fork notion | `CON follow ... depth: "*"` with `_depth _branch _fork _episode _siblings` (SPEC 3.8) | `ancestry` (not_lowered); `_fork`, `_episode`: `held_sets` |
| perceiver windows | none | `SIG perceiver` re-folds the sub-log a reader could know (SPEC 3.7) | `perceiver` (not_native) |
| counterfactual re-fold | none: the user copies data and deletes rows | `SEG drop`, with the log untouched (SPEC 3.7, L11) | `counterfactual` (not_native) |
| incomplete ranges | none: `NULL` means missing in a row, not "entries may be missing from the source" | `incomplete`, `NUL(gaps:)`, `NUL(expect:)` (SPEC 1.6, 2.4) | `incomplete_range` (not_native) |
| result provenance | none: result rows do not say which source records produced them | `_src`, `row_meta.src`, `explain.entries_read`, `return: "pointers"` (SPEC 5.1, L2, L23) | `provenance` (not_native) |
| cost as output | none | `cost` counters, `SIG budget`, `E_BUDGET` (SPEC 5.2, L20) | `cost` (not_native) |
| writes that cannot overwrite | `INS{operation: update\|delete}` as flags (and compiled as reads, V1-h) | append only; retraction is a `NUL` entry; no edit, no delete (SPEC 4.4, L10, L15) | `write` (not_native) |
| a stored query is data, not a result | holon registry export of function strings; import evaluates them (V1-i) | a view is the EXPRESSION as an addressable event, never its answer (SPEC 4.5, M6) | `unresolved_name` (not_lowered) |
| values never become syntax | values inlined into SQL text; `?` skipped by the tokenizer (V1-b, V1-j) | `P-PARAM` and the one literal printer (SPEC 2.6, L19; 4.1 here) | n/a |
| the same answer across storage | n/a (v1 has one backend: SQL text) | L21 across `lib: lazy: blocks: sqlite: mem:` | n/a |
| log flow among formats | none | the converter matrix (SPEC 6) | n/a |

What v2 does NOT add over v1 on the relational core: v1's SQL surface is covered by SPEC's relational core already (SPEC 8.1) and, where v1's code is wrong (2.5), v2 is stricter, not newer. A1 does not claim v2 is "more powerful": PREREG allows that phrase only after P1 and P2 clear their bars, and V2's `not_native` count is evidence for C4 only as 4.2 limits.

## 7. Test hooks, open questions, non-goals

### 7.1 Additions to SPEC (the audit list)

* CLI commands: `parse`, `compile` (SPEC 7.3's eight become ten). Library: `E.parseSql`, `E.compile`, `E.dialects`, optional `E.fromV1`. Source scheme: `sqlrel:` (SPEC 7.2).
* Version strings: `eoql-parse/1`, `eoql-compile/1`, `eoql-dialect/1` (the shape of `E.dialects()` entries).
* Error codes (SPEC 5.3): `E_NOT_COMPILABLE`, `E_TARGET_UNIMPLEMENTED`, `E_USAGE`. Warning codes: `W_UNORDERED_PAGE`, `W_AGG_ORDER`, `W_VERSION`.
* Gap ids (SPEC 8.3): `SQL_CATALOG_UNKNOWN`, `SQL_GROUPING_SETS`, `SQL_ARRAY_AGG`, `SQL_AGG_ORDER`, `SQL_CONNECT_BY`, `SQL_DISTINCT_ON`, `SQL_DIALECT_SPELLING`, `SQL_V1_HOSTFN` (all NEW).
* Compile reason ids: the 16 of 4.2.
* SPEC Appendix B's counts become: 9 verbs; 8 frame arguments; 5 extra primitives and 3 vocabularies (unchanged: A1 adds none); 10 CLI commands; 9 formats; 23 laws (A1 adds none; RT1 to RT7 are claims for V2); 14 mutant hooks (unchanged; A1 extends M11's reading to the compiler).
* None of these is a language primitive. They are tooling and an adapter, listed so T can decide whether to count any.

### 7.2 Where each A1 test finds its hook

| test | needs from this file |
|---|---|
| V1 v1 conformance | `parse --from sql` (3.1) over the v1 test file's SQL strings; `sqlrel:` (3.3) built by the test author from the tables the strings imply; R-EQ (4.1). The empty-string case and the cases that never reach SQL (builder-API tests) are not executable and are listed, not counted against the 95 percent. The V1-a to V1-l notes (2.5) explain expected v1 oddities, never excuse a v2 miss |
| V2 compile-back | RT1, RT2, the reason list (4.2) with its two classes, `compile` (3.2) over QA's SQL-core set and over each beyond-SQL question; the report prints counts per class and per reason |
| V3 dialects | 4.4 as data (`E.dialects()`), the intended-difference ids CD1 to CD16 (4.5), `fromV1` or SQL transcriptions (3.4) |
| V4 untested targets | section 5: both targets raise `E_TARGET_UNIMPLEMENTED` |
| V5 what v2 adds | section 6 and 2.3 |
| safety (S) | the compiler and the translator are total (RT5); injection strings in literals, identifiers and params stay inside one token (4.1) |

### 7.3 Open questions (decisions the user or the results must settle)

1. **v1's operator set versus the canon** (PREREG-A1): the crosswalk assumes v2 stays on the canonical nine. If the user prefers v1's, SPEC and this file would both need a rewrite; this file does not hedge.
2. **`sqlrel:`** is a new source kind added only so v1's tables can be queried. Is a fixture adapter acceptable, or should v1's cases be imported as entries (which would require rewriting table names, adding a layer where mistakes hide)?
3. **Counting `not_lowered`.** 4.2 keeps `raw_world` and `ancestry` out of the C4 evidence. A reviewer may argue some `not_lowered` reasons are really not native; the per-reason counts are printed so the argument can be made with numbers.
4. **Closed vocabularies versus v1's open function names**: v1 passes any function name through; v2 refuses what is not in V-FN/V-AGG/V-WIN. This costs reach (for example `ARRAY_AGG`) and buys determinism and the injection bar. It was kept as is because SPEC stamps the lists as closed.
5. **Explicit null ordering on postgres and oracle** (CD4) changes the text of every sort; the alternative is to leave dialect defaults and accept a different row order than EOQL's. Chosen: keep EOQL's meaning.
6. **`raw_world` is refused rather than compiled to a catalog query** even where a catalog query would often agree (4.1). The alternative is a declared lowering for the default frame; it was not written because SPEC 1.7 says the slots and ancestry basis differ.
7. **The grouping annotation of SPEC 2.4** is not among SPEC's counted primitives or frame arguments (2.3 remark 2).
8. **SQLite version.** `full` and `right` joins, `RETURNING`, `NULLS FIRST/LAST` and `iif` depend on it; the test author records it.
9. **Accepted foreign spellings** (T-SPELL) widen the SQL accepted beyond SPEC 8's SQLite dialect. They are additive and listed in every result, but they are a policy choice.

### 7.4 Non-goals of A1

No compile target other than the five SQL dialects. No execution of a non-SQLite dialect. No SQL write-through (SPEC 8.4 stays optional). No translation of SQL DDL, `UPDATE`, upsert, `RETURNING`, table-valued functions, `NATURAL JOIN`, correlated subqueries (beyond SPEC 8.1's equality-correlated `EXISTS`/`IN`), `GROUPING SETS`, `DISTINCT ON`, `CONNECT BY`. No change to any definition of SPEC. No claim that the crosswalk is the right mapping, that v2 is more powerful, or anything about speed.
