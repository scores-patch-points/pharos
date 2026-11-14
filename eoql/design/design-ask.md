# EOQL as the language of asking: a design (premise 3, asking by pointers)

Written 2026-11-14 for PREREG-A4. A design only: nothing is built, run or stamped. Tags close each claim: [Result: where] measured or read from a named file line; [Prior art] from memory, unchecked; [Proposal] stated, not tested; [Open] unresolved. DECLARED marks a reading somebody typed, not a finding. In section 4 data facts carry a Result tag and the language output is a hand walk, [Proposal]. No operator is given a meaning here as a finding. PROBLEMS = design/PROBLEMS.md; RPL = ledgers/pharos-lazy/data/replay; EPH = ledgers/ellison-statements/pharos.

## 1. Thesis

1. EOQL is first the language in which an agent with a small context, or a person who never reads the log, asks a question and receives pointers to entries, bounded excerpts, the dependency cone as the explanation, a status (determined, held, open), the frontier where the walk stopped and why, and the cost in records and bytes. [Proposal]
2. Every question is read under a ground (bylined entries that settle identity, dependency, time, absence, sufficiency and baseline) that the asker adopted; the evaluator holds none of the six, and one cone read under two grounds gives two answers and their difference. [Proposal]
3. A stop is an ordinary entry that can be contested and resumed, errors may cost reading and may never answer wrong, and "I could not tell" is a status, not a failure. [Proposal]
4. A question leaves a verifiable trace (a stop and use marks holding ids, reasons and costs, never values) that orders the next question's reads, and a trace is ignored once its recorded savings reach zero, so one notion of a difference that makes a difference governs sameness, stopping and forgetting. [Proposal]
5. Writes are entries with the same envelope, the kernel is fourteen small mechanisms, and folds, identity rules, time, absence names and position readings are data under a byline. [Proposal]

## 2. The kernel: everything the evaluator hardcodes

Count: 14 mechanisms; 14 term forms; 8 Gap reasons; 4 protocol kinds; 2 built-in folds (`here`, `held`); 0 numeric constants (the bound is a required argument; host process limits sit outside the semantics). [Proposal]

1. **Entry form.** The weft fields; id = sha256 of canonical JSON; an id mismatch is `corrupt` and never an answer; `cell` is one of the 27 ids (an opaque list from cells.json); a statement may not supply `at`, `seen`, `by` or `id`. Not a ground: the log's own law, shared by every ground; the 27 ids carry no meaning here.
2. **Value reading.** Paths (`.key`, `[n]`, `[*]`) and byte equality of canonical JSON. No coercion, case folding, regex, substring or similarity. Not a ground: anything wider than byte equality is a declared identity or edge.
3. **Term language.** Fourteen forms: literal, path, `=`, `<`, `+`, `-`, `and`, `or`, `not`, `if`, `fold(set, init, step)`, `gap?`, `entries(anchor)`, `inc(entry, rule)`. `<` takes two numbers or two strings (bytewise), else Gap(type). No recursion, so every term ends. `and` and `or` stop at false or true; a Gap operand actually evaluated gives Gap. Not a ground: the smallest language in which a ground's count, threshold and incarnation rules can be data; it names no domain word. [Open: see 9]
4. **Gap.** The one non-value, with eight structural reasons: no-path, type, dangling, outside-cut, torn, bound, unsettled(decision), hole. Each is a mechanical fact observed. Not a ground: what a reason means (unknown, not applicable, retracted, not extracted) is a name the ground maps it to; there is no NULL.
5. **Edges.** Rules the ground declares: a path edge (`from`, `to`, target an id or an address), a `chain` edge (each entry depends on its predecessor at the same key in the ground's order), a `join` (connected components of a named rule, for identity merges). Heads are sinks. Reverse lookup is a source capability. Not a ground: no default edge set; `of` is followed only if a rule says so, except for the protocol kinds (item 12).
6. **Wave walk.** Backward from the heads, per branch, stopping only at a ground-declared root, a natural end, an identity-class boundary, or the bound; each stop is recorded with its reason. Not a ground: reading order is strategy (to be tested against a full forward fold) and picks no value; sufficiency comes from the ground.
7. **Both.** Every head survives, survivors are counted, no tie-break, concurrent means both. `here` (pointers to entries matching an anchor, no judgement) and `held` are the only built-in folds. Not a ground: the one behaviour that cannot answer wrong under contradiction.
8. **Ground resolution.** The asker's adoption entries, newest by dependency (never clock), as of the cut; concurrent adoptions mean the ask runs under each; an unsettled decision refuses only an ask that needs it. The four protocol kinds are read through `of` alone, which ends the regress of "which ground reads the ground" at the reader.
9. **Cuts.** A head set (causally closed by construction) or a `where` term, from the ask or the ground; an edge leaving a cut is Gap(outside-cut). Not a ground: a cut selects entries; what "now" means belongs to the ground.
10. **Status and cost.** Survivors and reading (complete or open) give the status; counters of records and bytes the source delivered, and "read N of M"; the bound is required. A bound hit is Gap(bound), status open, never a truncated answer.
11. **Pointers.** Items are entry ids with a role; `show` paths give excerpts cut at the byte bound on a character boundary; `except <stop>` returns ids already received as `known`. Not a ground: nothing leaves except through a named path and a bound.
12. **Protocol kinds.** `ground`, `stop`, `mark`, `hole`. A stop is contested by any dependent that is not a mark. Stops and marks are hints, verified by id before use, consulted for cost only. A hole keeps an entry's skeleton and reads as Gap(hole). Not a ground: the evaluator needs these names to read a ground, stay sound with hints and stay sound under erasure. [Open: D9]
13. **Linearize.** Only if a ground declares a total order: a linear extension of the edge relation choosing the least by a declared key list among ready entries. Not a ground: no key is built in. [Open: D3]
14. **Purity.** The evaluator writes nothing. `put` goes through the door's weave, which computes `at`, `seen`, `by` and `id`; the trace an ask offers is filed only by a `put`.

## 3. The language

### 3.1 Statements

Two statements, `ask` and `put`. Grammar (EBNF, `#` comments; STR, INT, KEY, NAME, JSON as usual; CELL is one of the 27 ids; HEX is an id or a unique prefix of 12 or more hex characters):

```
statement = ask | put
ask    = "ask" FOLD "about" anchor { clause } "bound" INT "records" [ "," INT "bytes" ] [ "," INT "excerpt" ]
FOLD   = "here" | "held" | NAME                 # NAME is declared in the ground
anchor = "id" HEX | "ids" "[" HEX {"," HEX} "]" | "addr" STR | "key" STR | "kind" STR | "stop" HEX
clause = "where" term | "group" term | "via" NAME | "under" ( "adopted" | HEX {"," HEX} )
       | "as-of" cut | "since" HEX | "resume" HEX | "except" HEX
       | "show" path {"," path} | "why" | "positions"
cut    = "heads" "[" HEX {"," HEX} "]" | "where" term
put    = "put" STR "at" STR [ "cell" CELL ] "of" ( "heads" | "[" [ HEX {"," HEX} ] "]" ) "body" JSON [ "basis" JSON ]
term   = or ;  or = and {"or" and} ;  and = not {"and" not} ;  not = ["not"] cmp
cmp    = sum [ ("=" | "<" | ">") sum ] ;  sum = atom { ("+" | "-") atom }
atom   = JSON | path | "(" term ")" | "if" term "then" term "else" term
       | "fold" "(" set "," term "," term ")" | "gap?" "(" term ")"
set    = path | "entries" "(" anchor ")" | "inc" "(" path "," NAME ")"
path   = ROOT { "." KEY | "[" INT "]" | "[*]" } ;  ROOT = "e" | "x" | "acc" | "prev" | "base"
```

`key` is the ground's declared identity key; `addr` is byte equality on the address field; `kind "*"` is a corpus scope and the envelope says so. A door supplies `bound` for an agent. The parser is total: every refusal is typed with a position; no prefix is ever run. [Proposal]

Clauses apply in the seed's reading order: scope, group, fold, frame. [Prior art: holodeck `eoTrace`, EOQL_TRANSLATION_STANDARDS 1.1] The nine operator names are not executable syntax; an optional trace line prints the reading the project declares for each clause, DECLARED, never executed through. [Proposal]

### 3.2 The result envelope

One block per ground the ask ran under (default: every adopted ground, so both applies to grounds too):

```
{ "v":"eoql-ask/0", "key":"<hash of the ask without its bound>",
  "ground":{"id":..,"by":..,"how":"named|adopted"}, "cut":{"heads":[..]}, "scope":"region|corpus",
  "fold":"held|<declaration id>",
  "answer":{"survivors":n,"items":[{"ptr":id,"role":..,"excerpt":..,"known":bool}]},
  "status":"determined|held|void|open|unsettled", "reading":"complete|open",
  "withheld":[{"ptr":id,"as":NAME}], "unjudged":[ptr], "unsettled":[decision], "prose_only":[decision],
  "differs":[ptr], "frontier":[{"ptr":id,"stopped":"root|end|class|bound|gap|contested","why":ref}],
  "cone":{"entries":n,"edges":n}, "read":{"records":n,"of":M,"bytes":n},
  "hints":{"consulted":n,"verified":n,"failed":n}, "trace":{"stop":{..}} }
```

- determined: one survivor, reading complete. held: two or more. void: zero survivors and at least one withheld entry, listed with pointers, never an empty determined answer. open: reading incomplete (a bound, a Gap, a failed `expect`, a hole, a contested stop). unsettled: a refusal naming the decision. Precedence: unsettled, open, void, held, determined; survivors and reading are always printed. [Proposal; Prior art: R-count and R-grade of pharos-lazy A6]
- An empty answer is determined only if the source reports clean integrity for the plan and the fold's `expect` holds. A `where` that evaluates to Gap lists the entry under `unjudged`, never drops it silently. [Proposal]
- `differs` lists pointers whose survival differs between grounds. `trace` is the stop the door may file.

### 3.3 Grounds: declared, adopted, read

A ground is an entry of kind `ground` under a byline. Body fields, each optional: [Proposal]

```
{ "name":.., "cut":term, "ident":{"key":path, "split":term, "join":NAME},
  "dep":[{"name":NAME,"when":term,"from":path,"to":path,"to_is":"id|addr"} | {"name":NAME,"chain":true}],
  "time":{"order":"dependency" | {"by":path,"tie":term} | {"linearize":[key,..]}},
  "absent":{"map":{REASON:NAME},"withheld":[{"when":term,"as":NAME}]},
  "suff":{"roots":[term],"quiet":{"below":"base.stop"}},
  "base":{JOB:{"value":..,"unit":..,"basis":..}},
  "folds":{NAME:{"needs":[..],"reads":[path],"init":term,"step":term,"done":term,"expect":{"holds":term,"else":NAME}}},
  "writes":{KIND:{"requires":[path]}}, "reading":{KIND:CELL}, "predicts":[{"fold":NAME,"expect":JSON}],
  "prose":{DECISION:"words"} }
```

- **Declared:** `put "ground" ... of [earlier ground]`. A revision is a new entry. Identity merges and splits are data: `join` names a dep rule over `alias` entries by listed bylines; `split` is a term over `e` and `prev` (the predecessor at the key in the ground's order). A dependency written only in text (RP-11, RP-12) is an asserted `cites` entry with a byline and a basis, admitted by a `when` term, because the kernel has no regex. [Proposal]
- **Adopted:** `put "ground" at "adopt:<asker>" of [previous adoption] body {"adopts": id}`. The ground in force is the asker's newest adoption by dependency as of the cut. `under <id>` overrides it and the envelope says `named`. Reading the past with a newer ground needs `as-of ... under <newer id>` explicitly. Adoption selects; it does not endorse. [Proposal; Prior art: the note, "perspective is a selection"]
- **Read:** `ask here about id <ground>` needs no ground. Identity fixes the anchor's class and the cone's boundary; dependency, edges and heads; time, `chain` order and ties; absence, the names Gap reasons carry and which entries are withheld; sufficiency, roots; baseline supplies `base.<job>` to terms. A decision settled only in `prose` is settled for the human reader and unsettled for the evaluator: the envelope lists it under `prose_only`, and an ask that needs it gets `unsettled`. [Proposal]
- **Falsified:** each `predicts` entry is a fold run by an ordinary ask; a mismatch is a finding. [Open: the null for statistical predictions]

### 3.4 Folds

A fold is a declaration in a ground; an ask names it and cannot define one inline. `reads` lists the paths the fold touches: an entry touching none is pruned structurally but its edges are still followed, so a long chain of trivial entries cannot hide a root. `done` is tested on the accumulated result after each step, never on the step alone. `needs` lists the decisions used. `expect` is the ground's own completeness test, for example "a lease with no logged write is not no write". [Proposal]

```
"count": {"needs":["dep"], "reads":[], "init":0, "step":"acc + 1", "done":false}
```

`held` is `done: true` at the heads unless `why` is asked. Count-like and corroboration-like shapes declare `done: false`, so the walk never stops at the first hit. A ground may declare `suff.quiet`: a branch then stops when its cumulative effect over a widening window stays below `base.stop`, reason `quiet`, status always open. Sum, count and max are expressible with `fold`, `if` and `<`; I walked count and one threshold by hand only. [Open]

### 3.5 Stops, marks, and the loop

A `stop` entry: `{key, ground, cut (heads), frontier [{id, reason, why}], cost {records, bytes, cold}}`, with `of` = the ids read. It holds no answer value and no excerpt. A `mark`, written by the door after a verified use: `of` = [stop], body `{saved: records, basis: "model|shadow"}`. [Proposal]

1. Ask 1 runs cold and returns `trace.stop`; the door files it with `put "stop"`.
2. Ask 2 with the same key reads the marks at the stop's address (counted in its cost), verifies the stop's ids, and starts from the frontier. Consulting a mark changes cost only. `since <stop or entry>` changes the question: it returns pointers to region entries not in the stop's cut, and the contested check.
3. The door files a mark with `saved` = the stop's recorded cold cost minus this ask's cost.
4. A mark is ignored when its net saving over recent uses is zero or less. The window widens (1, 2, 4, 8 uses) until the keep or drop decision stops changing. Nothing is deleted; evaporation means not being consulted, and an unused mark has net zero. [Prior art: pharos-lazy A8; Proposal here]
5. A dependent that is not a mark contests a stop; a contested stop is not used and the ask walks cold. `resume <stop>` continues from the frontier under the asker's ground, so a stricter ground goes deeper where the old root no longer counts.

Removing every stop and mark changes cost and never an answer. Values may be memoized in a reader-private cache keyed by head set and ground id, disposable and never in the log. [Prior art: the note] The three jobs of a difference that makes a difference (sameness, `quiet`, evaporation) read `base.<job>`, so a threshold lives in one place. [Open: one baseline for three jobs, D8]

### 3.6 Where the 27 positions live

(a) As data: `cell` on every entry, one of 27 ids, writable by `put ... cell C`, filterable and groupable (`group e.cell`), carried as `cell_basis: declared-by-writer`. An unknown id is a typed error; no cell is inferred from a kind name. (b) In a ground's `reading` table, kind to cell, DECLARED. (c) As an observed effect: with `positions`, the evaluator records for each cone step a mechanical difference between the answer frame before and after it: unchanged, member (survivor set changed), class (an identity class merged or split), edge (an edge between entries already in the cone), value (a fold result changed), ground (the ground in force changed). No effect carries an operator name. The envelope adds a 9 by 3 count of declared cells and an agreement table between each writer's declared cell and the ground's DECLARED reading of the observed effect. [Proposal; Prior art: user direction that operators exist only between frames and NUL is a non-transformation, memory note acts-are-frame-diffs]

A position thus differs by more than its label: relabel an entry and its effect holds; change what a step does and the effect moves with the label held. The frame-diff labeller recovered only CON [Result: project memory, act-tag: INS 5 of 9, SIG 4 of 5, DEF 3 of 6, CON 17 of 26, not above the first-INS-else-CON baseline], so the effect classes are a proposal to test.

### 3.7 Writes

`put` has no update or delete. Its receipt is an envelope: `status: written|refused`, the new entry as the one item, `of` as pointers, `read` (what `of heads` cost), the ground id in the entry's `basis.ground`, the bytes appended. A field in `writes.<kind>.requires` must be a value or `{"absent": NAME}` with NAME a declared absence name, so "not read" is stored as a name and never as empty. A retraction is an ordinary entry; whether dependents follow is the ground's `absent.withheld` rule. A hole is `put "hole" ... of [id] body {reason, skeleton_id}`. [Proposal; Open: the hole form]

## 4. Worked examples

Hand walks; ids are 12-hex prefixes, unique in both logs [Result: E-01].

**E1. RP-19, the basis of one statement (pointer reply).**
```
ask held about addr "p04-qwnvn9mcox4-oracle-health-summit-fireside-ellison-bell-33b5a3bb#1207.8-1209.2"
    group e.kind why show body.label, body.tier, body.with_caveat, body.result
    bound 10 records, 2000 bytes, 120 excerpt
```
The address holds utterance 1f39a696e57e (EPH extractor:176), attributed e07d1a17d4c4 (extractor:448, tier T2, with_caveat true) and verified a2325eaddbf0 (verifier:176, result pass). Each group has one head. `why` follows `of` from the utterance to the scout source entry 38496b23bdf4 (scout:12, no `of`), a natural end. [Result: re-read of those lines] Output: determined, 3 group pointers, cone 4 entries, 4 records, no transcript text; the ref and the `[name] window` command stay in the utterance body unless `show body.ref` is added, cut at 120 bytes. [Proposal]

**E2. RP-23, what was said in 100 to 200 s (absence has kinds).**
```
ask coverage about key "v03-x5gmidnyeds-whitehouse-stargate-remarks-73e4886b"
    where (e.kind = "utterance" or e.kind = "not-his") and e.body.t0 < 200 and e.body.t1 > 100
    group e.body.class bound 60 records
```
`ident.key` is `e.body.source`; `coverage` adds each run's overlap with [100, 200] using `if`, and declares `expect: acc = 100, else range-not-covered`. One run overlaps: 6315d52dab2b (extractor:306, class not-his, 0 to 268.1), 100 s, `expect` holds. Output: determined, 0 attributed statements, 100 of 100 s examined, inside a run recorded as the host's own remarks. "None" would be wrong: the log says the range was examined. [Result: E-10, coverage 0 to 2,783 with no gap] Cost is the entries under the key, not counted. [Open] [Proposal]

**E3. RP-21, how many statements are his (ground evolution).**
```
ask n-attributed about kind "utterance" under G_now, G_notrail  bound 500 records
```
G_now: 153. G_notrail omits the withhold rule for class pass-trailing-cue-only: 157 (153 plus the four withheld by that rule alone). Seconds under it: 2,165 plus 644.6 is 2,809.6, 11.4 percent of 24,594.5 s. [Result: E-09, E-19, LED] The figure 156 (before patch 1) is a ledger file, not a cut of this log, so no `as-of` reproduces it. [Open] `differs` lists c125b41d56a7, c023259f6c15, 1d32a342155a, 2d13e2045972; scope is corpus. [Proposal]

**E4. RP-16, writing a ground.**
```
put "ground" at "ground:ellison-attribution" of [] body {"name":"cue-before-run",
  "absent":{"withheld":[{"when":"e.body.class = \"pass-trailing-cue-only\"","as":"not-established-trailing-cue"}]},
  "folds":{"withheld-by-this-rule-only":{..}}, "predicts":[{"fold":"withheld-by-this-rule-only","expect":4}],
  "prose":{"ident":"a speaker is the person a cue names","dep":"a trailing cue is not followed","suff":"T3 provenance alone is never sufficient"}}
```
Receipt: written, 0 pointers read. Identity, dependency and sufficiency are prose because the cues live in transcripts, not entries; the ledger states no baseline, so an ask needing `base` gets `unsettled: base`. The prediction is checkable: 4 of the 49 withheld entries have that class (EPH verifier:237, 249, 250, 251). [Result: E-09] The four existing entries cite no ground, so "who withheld this, under what rule" returns the verifier's entry with `ground: none cited` until the experimenter files entries `of` those four that cite it. [Proposal]

**E5. RP-01 and RP-17, clips touched by two or more lanes (identity, adoption).**
```
put "ground" at "ground:clip-gap12" of [] body {"ident":{"key":"e.body.args.clipId",
  "split":"e.body.ts - prev.body.ts > base.quiet"},"base":{"quiet":{"value":43200,"unit":"s","basis":"typed, not earned"}},..}
put "ground" at "adopt:t4-reviewer" of [] body {"adopts":"<id of the ground above>"}
ask multi-lane about kind "*" group e.body.args.clipId under adopted, G_id  bound 4000 records
```
G_id: 258 multi-lane clips of 1,864 ids. The adopted 12 h ground: 236 of 1,929 classes. [Result: OUT/t4.json, A_strict and C_gap_split] `differs` lists 22 clips; classes grew by 65. The envelope prints `base.quiet` as "typed, not earned" (counts move from 188 to 253 across thresholds). For 000f4989: three lanes under G_id; two classes at 3 h or more (d05ce57f16b2 on 11-06 and 0a28d31ca5c4 on 11-12 are 122 h 35 min apart); three at 1 h (the lift 63446d2b50aa follows the fifth write by about 2 h). [Result: RPL timestamps; OUT/t4.json] Scope is corpus (3,292 clip writes). [Proposal]

**E6. RP-03, who created clip 000f4996 (asserted edges, grading).**
```
put "cites" at "000f4996" of [b6382f7c25f2] body {"to":"000f4996","rel":"created",
  "basis":"BL:1359 says re-placed from 000f4987 with in 22.208333 out 26.583333 as 000f4996; args of b6382f7c25f2 match"}
ask creator about addr "000f4996" under G_first, G_class, G_infer  bound 30 records
```
G_first (first entry at the address): v2-sec-10, 16e22d64ad64 (RPL v2-sec-10:33, 11-06). G_class (first entry of the 11-12 class, 124 h later): oracle-v2-master, a9ce356581f8 (:5381). G_infer admits `cites` entries by the reviewer's byline: oracle-v2-master, b6382f7c25f2, whose address is the sequence id, not the clip. Output: three answers, all in `differs`, G_infer's graded `asserted`, not entailed. No entry carries a created id (0 of 1,988 creating calls). [Result: E-03; OUT/t5.txt] [Proposal]

**E7. RP-06, ten leases within 3 ms (time regime).**
```
ask first about kind "permit-granted"
    where e.at > "2026-11-06T21:20:03.600Z" and e.at < "2026-11-06T21:20:03.620Z"
    under G_ms, G_us, G_tie3  bound 40 records
```
G_ms orders by `e.at` (millisecond text): two grants tie at .611, 8ff2a0570ac0 (v2-sec-01) and 49ce2de43643 (v2-sec-03): held, 2 survivors. G_us orders by `body.granted`: the ten epochs run from 1794000003.61119 to 1794000003.613069, a span of 1.879 ms, with no tie: one survivor, 8ff2a0570ac0. G_tie3 declares `base.tie` 0.003 s (typed, not earned): no grant precedes another by more than the window, so all ten survive. [Result: I re-read the ten `body.granted` values in RPL] PROBLEMS reads the tie as a fact of the clock; it is a fact of millisecond text only, and the importer's `seen` chain agrees with the microsecond order. Whether one coordinator issued the grants serially is not checked. [Open]

**E8. RP-10 and RP-27, same or other (a respect or a refusal).**
```
ask same about ids [dda6de5af1ed, 276e46ffefd1]        -> unsettled: ident (no respect declared)
put "alias" at "20261110-155554179" of [276e46ffefd1, dda6de5af1ed] body {"a":"20261110-155554179",
  "b":"20261110-155554179__oracle-v2-master","respect":"names one lease","basis":"identical timestamp prefix"}
ask late-writes about kind "permit" under G_strict, G_lease  bound 600 records
```
The release 276e46ffefd1 (RPL unattributed:4) names `20261110-155554179`; the grant dda6de5af1ed names the suffixed permit. G_strict has no `join`: 0 writes after release. G_lease joins over the reviewer's `alias` entries: 26 of the 31 writes under that permit follow the release (TL rows 5130 to 5155). [Result: E-08] `same` defaults to Other, sameness is earned by a declared respect, and with none the answer is a refusal. For RP-27 (the hq copy against the ledger's source V03) the respect "words at a time" needs a time map neither log holds: Gap, three pointers, no statements. [Result: PROBLEMS RP-27] [Proposal]

**E9. RP-13, did anyone change this since I last wrote (since, censor).**
```
ask held about addr "000f4989" since 949ce5cc2231 as-of where e.at < "2026-11-12T03:14:31.806Z"
    group e.by under G_clip, G_seq  bound 60 records
```
G_clip (region by clip id): one pointer, 63446d2b50aa, oracle-v2-master, the lift at 03:11:28.734Z. G_seq (region by sequence id fe6d6e93): 25 pointers, 16 by editor-premiere-3 and 9 by oracle-v2-master; `differs` has 24. [Result: E-07] Both grounds declare an `expect`: a lift means "slot may be refilled", an add_to_timeline in the delta means "created id unknown". G_clip fails on the lift and G_seq on b6382f7c25f2, so both are open, not "nothing changed". A track-and-time ground leaves most writes in `unjudged` (14 percent carry sequence, track and time); the count is not computed. [Open] The region is 7 entries, the `of` closure 13, 12,502 of 10,350,899 bytes. [Result: E-04] No bodies are returned. [Proposal]

**E10. RP-18, a recorded stop, then a late entry (the loop).**
Ask 1: `ask held about addr "000f4989" why under G_clip12 bound 20 records`. The region is 7 entries; under the 12 h split the class holds six (the five editor-premiere-3 writes 0a28d31ca5c4 to 949ce5cc2231 and the lift 63446d2b50aa) and d05ce57f16b2 is a class boundary. Frontier: 0a28d31ca5c4 stopped `root`, d05ce57f16b2 stopped `class`; 7 records. [Result: RPL lines; E-04] The door files `put "stop"`. Ask 2 with the same key reads the stop and one adoption head: 2 records against 7, `saved` 5, the mark stays. Later the unlogged 18:00 replace_clip on 000f4438 is backfilled, with `put "dissent" at "000f4989" of [stop] body {"contests":"949ce5cc2231"}` (one of two apply_effect entries; which carries the Lumetri is not checked [Open]). Ask 3: the stop has a non-mark dependent, so it is contested, the walk runs cold (8 records), the frontier shows 949ce5cc2231 `contested`, status open; the first answer stays readable `as-of` its cut. [Proposal; the 7, 2 and 8 are a hand model, not measured] Under G_id the root is d05ce57f16b2: one cone, a different frontier under another ground.

**E11. RP-07, what was in flight when Premiere hung (silence is not none).**
```
ask in-lease about addr "20261111-175958946__oracle-v2-master" under adopted  bound 10 records
```
The grant dcf000fecf68 (23:59:59.616Z) has one dependent by `of`, its release fa5adfb04a0b (00:08:35.828Z), 8 min 36 s later; no write depends on the grant. [Result: RPL oracle-v2-master:5318, 5319; E-05] `in-lease` returns 0 and declares `expect: acc > 0, else unlogged-possible`: survivors 0, reading open, gap `unlogged-possible`, grant and release as pointers. The prose pointer BL:1354 (a replace_clip that hung) is outside the log and enters only as a `put "cites"` by a named byline. An empty SQL set reads as "nothing happened". [Proposal]

**E12. RP-09, a withdrawn request that was granted (a write with dependents).**
```
put "retract" at "20261111-230838172__oracle-v2-master" of [9b02506ce583] body {"why":"withdrawn by the lane"}
ask held about addr "20261111-230838172__oracle-v2-master" as-of where e.at < "2026-11-12T05:13:00Z" under G_void, G_stand  bound 10 records
```
Dependents of the raise 9b02506ce583 by `of` are the release 054f5a56a4fb (05:11:00.254Z) and the grant 7068cb995a0c (05:12:49.343Z, expires 05:15:49Z); PROBLEMS listed only the grant. [Result: RPL oracle-v2-master:5452, 5455] G_void withholds dependents of a retracted entry as `retracted-by-dependency`: no lease at 05:13:00Z, both pointers under `withheld`. G_stand withholds only the raise: the grant stands to 05:15:49Z. `differs`: the grant. Retracted is a declared name, not absence. [Proposal]

**E13. RP-25 and RP-24, positions occupied; a perceiver window.**
```
ask here about kind "*" group e.cell positions bound 11000 records
```
Occupied: 11 of 27 (eight operators at Figure, three at Ground); 16 are reported unoccupied, not as zero activity. 978 write entries sit at NUL·Ground because their tools are unmapped. [Result: E-12] The holon kind's body names DEF·Pattern while its entry is at DEF·Figure (RPL pharos-import:4): two declared readings that disagree are both returned. The agreement between declared cell and observed effect needs a run. [Open] RP-24 is a ground declaring `cut: e.by = "extractor"` that maps outside-cut to the name `unseen`: 153 attributed, 0 withheld, 49 undecided, against 153, 49, 0 for the full log [Result: E-11]; filtering values and limiting knowledge stay two grounds, both returned. [Proposal]

## 5. Many models, one log

Each family is one ground over the six decisions plus its folds; none promises native speed. [Proposal]

- **Relational (the pharos-sqlite tables).** ident: key `[addr, cell]`; dep: `of` and `seen`; time: `linearize` with keys `[index of e.cell in the ground's cell list, e.id]`; every Gap reason maps to one name, `null`; no roots, `done: false`. Folds: `entries` (with `pos`), `heads` (`held` per key), `conflicts` (pairs of heads with unequal bodies), `latest_causal` (greatest `pos` among heads), `retracted` (`absent.withheld` when `inc(e,"retracts")` holds an entry not itself retracted; depth 2 only, terms cannot recurse), `k_<kind>` (a fold per declared kind with its schema columns). Test: row equality with pharos-sql on both real logs; it fails on depth-3 retraction chains or if `linearize` is refused (D3). [Prior art: pharos-sqlite DESIGN]
- **Document.** ident: key `e.body.id` or `e.addr`; dep: `of`; a missing path is `not-set`, a present JSON null is `null-value`; one fold per field path, each `done: true` at that field's superseding entry (stop per field).
- **Key-value.** ident: key `e.addr`; dep: `chain`; `done: true` at the head, so the first hit stops; a missing key is `no-entry`, a retraction `retracted`.
- **Graph.** Edges are dep rules; an RDF triple is an entry with `body.s`, `body.p`, `body.o`, the rule name read from `body.p`. `ask held about id X via follows why` returns the reachable set as its cone.
- **Time-series.** ident: series key; time: `by e.body.t` with `tie` the sample period; windows are folds under `where`. Bucketing by floor needs a division the term language lacks. [Open: D4] The weakest fit.
- **Event log.** ident: stream key; dep: `chain`; state is a declared fold; any cut is a head set; a verified `stop` is a snapshot checked, not trusted.
- **CRDT.** Time is `dependency` only, so concurrency is native. LWW register: a fold choosing the greater `[body.ts, e.by]` by nested `if`. Observed-remove set: a remove names the adds it observed in `of`, and `absent.withheld` fires on `inc(e,"observed-by")`, so a concurrent add survives. Each carries a `predicts` that the step commutes and is idempotent, falsified by shuffling a cone's entries.
- **Not grounds.** Vector similarity, full-text search and spatial indexes need a distance or text match the kernel refuses; a giver may nominate `near` edges as entries with a byline and a basis, verified by use. Columnar scans are `scope: corpus` asks: nothing is saved and the envelope says so.

## 6. What it refuses [Proposal, all]

1. An ask with no ground when it needs a decision: it gets `unsettled`. `here` and `about id` need none.
2. A default fold, tie-break, edge set, clock order or bound; a `quiet` stop is never determined.
3. A select-everything form for an agent.
4. UPDATE and DELETE, and any statement supplying `at`, `seen`, `by` or `id`.
5. NULL, three-valued logic and SQL value coercions as kernel meaning: Gap is one non-value with reasons, and `unjudged` entries are listed.
6. Inline fold bodies, and any vocabulary of folds, windows or functions read as a keyword.
7. Regex, text search, vector similarity, and any claim of native-engine speed.
8. A trace that carries a value, an answer that depends on a trace, absolute local addresses as identifiers.
9. Inferring a cell from a kind, or an operator name in an executable clause.
10. Statement count as the measure of power, adoption counts as endorsement, a stop that cannot be contested.

## 7. What it would teach about EO, and what would count against it

- **Positions.** Whether mechanical step effects separate writer-declared cells better than the kind name alone. Against: effects predict declared cells no better than kind does, or a label-held role change leaves the answer unchanged. [Proposal]
- **One baseline.** Whether sameness, `quiet` and evaporation can read one `base`. Against: a value fitted for one job misfires on the others. [Open]
- **Asking by pointers.** Whether a small local model that sees only envelopes answers the PROBLEMS questions as well as with full content, in fewer characters per step. Against: it treats `survivors > 1` as an answer. [Prior art: pharos-intelligence claim C]
- **Traces.** Whether marks save reads on a real stream, not a built Zipf one. Against: no saving over cold, or verification never fails (hints are good or nobody checks). [Open; Prior art: ESSAY section 6]
- **Kernel size.** Against: a starter fold that needs a keyword the kernel interprets (time-series windows already point at one).
- **Same and Other.** Against: every real pair ends in Gap (decorative).

The twelve tests of the note map to: head finding, item 5 and a derived reverse index; stop soundness, `done` on the accumulated result; starvation, pruned entries still followed to roots; corroboration, `done: false`; late arrival, contested stops (E10); concurrent heads, item 7; rules that look back, `of` only; ground falsification, `predicts`; compiled layouts, the relational ground; whole corpus, `scope: corpus`; erasure, `hole`; kernel size, section 2. [Proposal; none is run]

## 8. Decisions for the user

- **D1 Ungrounded asks.** Recommend: refuse by `needs`, with a marked locating floor (`here`). Refuse-all blocks first contact; mark-all lets defaults creep in.
- **D2 Who files traces.** Recommend: the door, the evaluator pure. Otherwise reads gain a write path and read-only replicas break.
- **D3 Linearize.** Recommend: include, ground-declared. Without it the relational ground cannot reproduce `pos`.
- **D4 Term language.** Recommend: 14 forms, adding `div` only if a real window question demands it. A richer one grows the kernel; programs stored in the log put code in the log.
- **D5 Operators in the kernel.** Recommend: the 27 ids as opaque data, no operator dependency order for entailment until cells are earned. Using it now types cells.
- **D6 Positions.** Recommend: declared cell plus observed effect. Pass-through alone is 27 strings.
- **D7 `quiet` stops.** Recommend: allowed only if declared, always open. Banning them costs reads; calling them determined invites salami slicing.
- **D8 One baseline, three jobs.** Recommend: one `base` keyed by job, split if tests show misfires. Else three typed epsilons.
- **D9 `hole`.** Recommend: include it. Without it erasure is out of scope and a deletion request cannot be met.
- **D10 Surface.** Recommend: the forms of 3.1 with a DECLARED operator trace line. Seed-style nesting (`SEG(EVA(..))`) keeps compatibility but overloads each verb.
- **D11 Sample salt.** Recommend: shadow-read samples salted by a door secret; a public hash can be gamed.
- **D12 Agent corpus asks.** Recommend: counts only; whole-log pointer lists defeat the premise.

## 9. Where this may just be SQL or Datalog renamed

My call for each construct against its nearest counterpart [Prior art, from memory]:

| construct | nearest | call |
|---|---|---|
| `here`, pointer-first replies | SELECT id with LIMIT, keyset cursor | rename (a policy) |
| `held` both default | multi-value register, Datomic cardinality-many | refinement |
| ground: bylined, adopted, as-of | schema plus session settings, Datomic schema datoms | refinement |
| dep rules, heads, `chain` | Datalog rules, recursive CTE | rename |
| backward wave walk | magic sets, backward slicing, newest-first reads | rename |
| declared roots and `done` | early termination, EXISTS | refinement |
| stop as entry, `resume`, contest | truth maintenance, checkpoints | refinement |
| survivors by reading, frontier | open versus closed world, EXPLAIN | refinement |
| Gap with reasons, `unjudged` | NULL, UNKNOWN | refinement |
| terms and folds | SQL scalars and aggregates | rename |
| `since` as a pointer delta | change data capture, Datomic `since` | rename |
| one ask under several grounds | one view per ground | refinement |
| marks, net-saving evaporation | query cache, cost-aware eviction | refinement |
| `except` known set | pagination cursor | rename |
| positions: declared cell, observed effect | none I know | new (untested) |
| `same`: default Other, a respect | record linkage (match, non-match, possible) | refinement |
| writes with receipt | event-sourcing commands | rename |
| `hole` | Matrix redaction, crypto-shredding | rename |
| `alias` and `cites` entries | owl:sameAs with named graphs | rename |
| `unsettled` refusal | type error | refinement |

Of 20 constructs: 9 renames, 10 refinements, 1 with no counterpart I know (5 percent). A critic may move refinements to renames. [Proposal]

Honest worries, in order of weight. First, a door that wraps SQL over a plain entries table with the envelope, the pointer policy, a seen list and stop rows could deliver the asking benefits, so what is new would be a protocol and not a language. The separating test is what each question must re-implement (fold, ground, stop) and what a change of ground costs the asker, against SQL over a table that stores no fold; statement count does not separate them (PREREG-A4 item 9). [Open] Second, the evaluator is goal-directed Datalog with negation refused, and strict Gap plus `unjudged` is NULL with a report. Third, a ground may be views plus a search path with Datomic's byline and as-of rules; marks are a cache with provenance. Fourth, `positions` has no counterpart and the least support. Fifth, `fold` plus `if` plus arithmetic is a small aggregate language, and fourteen is a count I chose.
