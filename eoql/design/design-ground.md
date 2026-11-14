# EOQL, ground first: a design

Written 2026-11-14 by designer 1 of 3 for `PREREG-A4.md` (premise: the ground). This is a design. Nothing is built, run or measured, and no statement below has been executed. A tag opens a paragraph or list item and covers its claims: **Result** (measured, with where), **Prior art** (from memory unless checked), **Proposal** (stated, not tested), **Open**. DECLARED marks a reading I chose, not a finding. Data come from `design/PROBLEMS.md` (cited as RP-nn and E-nn); I did not open the replay or the Ellison log, so each datum is as quoted there, with one reader.

## 1. Thesis

**Proposal.** (1) EOQL is first the language in which a ground is declared, published under a byline, adopted by a reader and read, and only second a language for asking. (2) A ground is up to seven slot events (absence, baseline, time, identity, dependency, conflict, sufficiency), each an ordinary entry whose rule is written in a small total term language, so the decisions every database makes silently become attributed, revisable data. (3) A question is a fold from heads backward along the adopted dependency relation, stopped only at roots the ground declares, and its answer is a claim that names its cone, ground, byline, survivors, stops and holes. (4) The kernel hardcodes 27 things, none of which is a collapse rule, edge default, identity test, tie-break, NULL or threshold, and its default for contradiction, both, applies to grounds as well as to values. (5) Relational, document, graph, key-value, time-series, event-log and CRDT views are each a declared ground, and moving data between them is reading one cone under another ground, with the difference reported slot by slot as the loss.

## 2. The kernel

**Proposal.** Everything the evaluator must hardcode. "G:" gives the reason the item is not a ground in disguise.

*Bytes and order*
1. Entry format: the eleven pharos fields, canonical JSON, `id = sha256`. G: the shared protocol; changing it changes ids, not perspective.
2. Equality: identical canonical JSON. G: anything looser (case, units, tolerance) is declared in identity or baseline.
3. Existence order: A precedes B (written ⊏) when A's id occurs in B's `of` or `seen`, transitively. G: a hash fact, since an id cannot be cited before its entry exists; it says nothing about what the citation meant, so the edges a fold follows are the ground's.
4. Dangling: a cited id with no entry is reported, never repaired. G: mechanical.

*Verbs and positions*
5. The nine verb names, and for the seven stored ones a structural contract on write (3.1). DECLARED. G: arity of references only, no content.
6. Frame difference: a digest of (ground, figure, pairing) before and after each step; `changed` iff digests differ. G: comparison of two computed values.
7. Grain by use: Ground, Figure or Pattern, computed from what a reader's fold consumed an entry for. DECLARED. G: reports a use and assigns no meaning; the item most at risk (section 9).

*Grounds*
8. Seven slot names with an acyclic reading order (absence, baseline, time, identity, dependency, conflict, sufficiency); a slot may cite only earlier slots. G: the note's six plus its conflict rules; a family that needs an eighth slot counts against this (section 7).
9. Three kernel kinds, `ground`, `adoption`, `stop`, beside the protocol's `frame`, `kind`, `holon`, `retract`. G: the evaluator cannot find a ground without knowing the kind that carries it.
10. Adoption resolution: a reader's live adoption events as of a cut; two live events for one slot make a held ground. G: selection, not content.
11. Forward-reference refusal: ground, adoption and stop entries cite only earlier entries. G: gives stratification by construction and chooses no rule.

*Evaluation*
12. Backward walk: from heads along the edges the dependency slot returns, each entry once per branch. G: the wave fold itself; the edge set is the ground's.
13. The both default: two or more heads under the adopted identity and dependency are all returned with a survivor count. G: the user's stated default; it picks no value.
14. Survivor grades: one is `entailed`, more is `held`, zero is `neither` with the offending ids; `stopped-quiet` is never promoted.
15. Verdict lattice: is, is-not, both, neither, gap. `is-not` only from an entry that says so; `gap` for what could not be read or completed.
16. Hole origins by mechanism: no-field, null, retracted, unreached, unread, dangling. Any term over a hole is that hole unless the absence slot says otherwise. G: how a value is missing is observable; what it means is the ground's.
17. Completeness gate: "nothing found" is rendered `gap` unless a declared completeness claim covers the range. G: a refusal to infer absence, not a rule about it.
18. Retraction mark: `retract` never removes; whether dependents follow is the dependency slot's, default none.
19. Stop records: a `stop` entry names frontier, ground and baseline, is contradicted only by a later ordinary EVA, and has a grade, rooted or quiet.
20. Memo rule: any cache key contains the head set and the slot ids; caches are derived and disposable.

*Term language T*
21. Values are JSON; paths over entry fields; no NULL; `prev` and `incarnation` are bound inside an identity slot.
22. Operators: comparison (numbers; strings by code point), and, or, not, + - * /, if, let, lambda, in, len, map, filter, fold(init, step), concat, distinct. No recursion, clock, randomness or I/O, so every term halts. G: arithmetic and list operations are not perspectives.
23. Time: `ms(iso)` for UTC instants and duration literals such as `12h`; a non-UTC string is a typed error.
24. Text: contains, starts-with, split, ascii-lower; no regex (section 8).

*Operation*
25. Budget and typed errors: caps on entries, bytes, steps and depth set by the host; a breach is an error, never a truncated answer. Listing order is ascending id and means nothing. G: resource limits, values untuned.
26. The evaluator is read-only; writes pass through weave, which computes `seen`, `at` and `id`.
27. The result envelope (3.5) and the three return forms: pointers, excerpts, rows.

**Result** for what the first attempt held in its kernel: 9 verbs, 8 frame arguments, 5 primitives and 3 closed vocabularies (`test/out/t_report.json` T.a). **Proposal:** the count here is 27, and none of these were in this design's kernel: a collapse list, `latest`, a default edge set, a tie-break, a default identity, grain defaults, aggregate or window lists, a shape list, NULL, an epsilon. Items 21 to 24 are the bulk and are close to SQL's expression core. Items 7, 8 and 16 are where a critic should push.

## 3. The language

### 3.1 What gets written

**Proposal.** Every statement is a write of an entry or a read of entries. The seven stored verbs have write forms with a checked structural contract; NUL and SIG are not stored (**Prior art**: the project's standards note) and appear only in reads. The verb-to-form reading is DECLARED, taken from the EO wiki (DEF axiom, EVA satisfaction, REC frame change; **Prior art**, the wiki says it is not peer reviewed) and from the first attempt (SYN merges heads).

| Verb | Write contract (checked) | Read form |
|---|---|---|
| INS | mints an `addr` no entry in `seen` holds (`E_NOT_FRESH`) | `INS(t)`: entity t under the identity slot |
| SEG | `of` one anchor and a boundary value | `SEG(sel)`: raw scope |
| CON | two anchors and a relation name | `CON(rel)`: follow declared edges |
| SYN | `of` two or more entries | `SYN(fold)`: apply a declared fold |
| DEF | a value at an anchor, and `before` | `DEF(...)`: set the frame |
| EVA | `of` the thing tested and a verdict | `EVA(term)`: keep where the term holds |
| REC | `of` the entry it supersedes | `REC(key)`: regroup |
| SIG | not stored | `ASK name`: the attended difference (the shape) |
| NUL | not stored | a trace step that changed nothing |

`GROUND` is `WRITE DEF` (`WRITE REC` when it carries `OF`). `ADOPT` is `WRITE DEF` on the reader's anchor. A stop is `WRITE EVA`. A fork is resolved by `WRITE SYN` whose `of` names the heads. **Open:** the protocol writes `retract` as NUL, while the canon says NUL is not stored.

### 3.2 Grammar

**Proposal.**

```
statement = ask | contrast | check | write | ground | adopt ;
ask       = [ "RECORD" ] "ASK" NAME "OF" seed { step } [ frame ] ;
seed      = "INS" "(" term ")" | "SEG" "(" sel { ";" sel } ")" ;
sel       = ( "addr" | "kind" | "by" | "cell" | "range" ) ":" term ;
step      = "CON" "(" NAME [ ";" ( "back" | "fwd" ) ] [ ";" INT ] ")"
          | "EVA" "(" term ")" | "SYN" "(" NAME ")" | "REC" "(" term ")" ;
frame     = "DEF" "(" farg { ";" farg } ")" ;
farg      = "as:" adoption | "asof:" cut | "for:" ref | "respect:" NAME
          | "frontier:" ref | "return:" ( "pointers" | "excerpts" | "rows" )
          | "budget:" budget | "quiet:" ( "allow" | "never" ) ;
adoption  = "@" NAME | "{" SLOT ":" ref { "," SLOT ":" ref } "}" ;
contrast  = "CONTRAST" ask "VERSUS" adoption [ "BY" "slot" ] ;
check     = "CHECK" ref ;
write     = "WRITE" VERB "(" "addr:" term ";" "kind:" NAME ";" "body:" json { ";" wopt } ")" ;
wopt      = "of:" ids | "basis:" json | "grain:" GRAIN
          | "before:" ( "unread" | ref | "complete-none" "(" ref ")" ) ;
ground    = "GROUND" SLOT NAME json-with-terms [ "OF" ids ] [ "CLAIMS" "[" term { "," term } "]" ] ;
adopt     = "ADOPT" SLOT ":" ref { "," SLOT ":" ref } ;
ref       = "#" HEX | "$" NAME ;
SLOT      = "absence" | "baseline" | "time" | "identity" | "dependency" | "conflict" | "sufficiency" ;
VERB      = "INS" | "SEG" | "CON" | "SYN" | "DEF" | "EVA" | "REC" ;
```

Clause order in the text is free; evaluation order is fixed (3.4). `NAME` after `ASK` is resolved in the adopted sufficiency slot; the kernel has no shape names. Every refusal is typed with a position.

### 3.3 Declaring a ground

**Proposal.** A ground is one entry per slot, each with a name, a byline, an optional `OF` (what it supersedes or extends) and optional `CLAIMS`: boolean terms over the log that any reader can run with `CHECK`, so a ground can be falsified and a byline stays attribution only. A revision is a new entry; old folds stay valid under the old one. An adoption names exact ids and never follows a chain, so a revision does nothing until re-adopted, and the envelope warns when an adopted entry has a descendant. Slot bodies:

- **absence:** `origins` (origin to `propagate`, `as(v)` or `refuse`); `negative` (terms marking an entry as evidence against, the only road to `is-not`); `meaning` (the writer's words, unchecked).
- **baseline:** `differs(a, b)`; `names` (name to value) with `earned` (true, or false with a basis). Terms say `baseline.name`; a literal compared with a measured quantity is listed in the envelope.
- **time:** `order` (a term, or `causal`) and `concurrent-within`. It defines latest, first, asof and now.
- **identity:** `via` (the raw path to look up, which is the head-finding hint), `key`, optional `split`, and named `respects`.
- **dependency:** `edges` (a term from an entry to a list of refs: `of`, `seen`, a body path, split text) and `voids` (`none` or `dependents`).
- **conflict:** `folds` (name to `init`, `step`, optional `commutes` claim) and `accept` (which resolving entries count). `both` needs no declaration.
- **sufficiency:** `shapes` (name to `touches`, `fold`, `root`, `requires`, `complete`, `quiet`). A shape's `touches` is the structural prune; `root` is the per-branch declared sufficient root.

### 3.4 Adopting and reading

**Proposal.** An adoption is a reader's `DEF` entry naming slot entries. A read runs in this fixed order.
1. Resolve the ground: the reader's live adoptions as of the cut, only for the slots the statement needs. A needed slot with none is `E_SLOT_UNADOPTED`, except absence, which defaults to `propagate`. Two live entries for one slot make two grounds; the read runs under each and the verdict is both unless the answers agree. With no adoption at all only raw reads exist (by id or `addr`), graded `raw`.
2. Seeds: `INS(t)` looks up by `via`, applies `key`, keeps matches; `SEG` is a raw selector with no identity.
3. Walk backward, one branch per head. A branch stops at an entry satisfying the shape's `root` (rooted). With `quiet: allow` it may stop earlier, when widening the read window by 1, 2, 4, ... entries leaves the accumulated answer unchanged under `baseline.differs` twice running; the grade is then `stopped-quiet`. **Open:** soundness of the quiet stop (note tests b and c).
4. Fold per slot: two or more heads give both, unless the statement names a declared fold, whose result cites its declaring entry and reports `discarded`.
5. `EVA`, `SYN`, `REC` in that order. Holes propagate per the absence slot. A negative without a completeness claim is `gap`.
6. Build the envelope. Reading writes nothing.

### 3.5 The result envelope

**Proposal.** `answer`; `verdict`; `survivors`; `grade`; `ground` (per slot: entry id, name, byline; `superseded_by` warnings); `cut`; `perceiver`; `baselines` (name, value, earned) and `literals`; `cone` (entries read of total, bytes, id digest, frontier, `stops` with branch, entry, grade, root); `holes` (where, origin, the ground's meaning); `coverage`; `trace` (per step: verb, `changed`, grain by use); `selectivity` (`cone` or `scan`); `cost`; `hints_used`. With `return: pointers` the envelope carries ids, addresses, counts and "read N of M", and no body text; `excerpts` adds bounded text for ids the caller names.

### 3.6 Folds, stops, positions

**Proposal.** A fold is declared in the conflict slot: `count` is `init 0, step acc + 1`; `sum`, `max` and a per-field fold are the same form. No fold name is built in except `both`. `RECORD ASK ...` writes one `stop` entry per stopped branch. A later `EVA` with verdict is-not, citing the stop and the new entry, contradicts it; a stricter reader resumes with `frontier:`. A rooted stop may let a later read skip below its root only when the ground ids match, and the result then says so; a quiet stop never lets a read skip.

A position has two halves. **Operator half:** the verb of the write, whose contract the evaluator checked; for entries written outside EOQL it is the writer's `cell` label, unchecked as today. **Grain half:** written by the writer through `grain:` or the kind's declaration (DECLARED, unchecked), and separately computed by use for each reader: Ground if the reader's fold consumed the entry to resolve its ground; Pattern if it consumed it as a rule or relation applied to other entries (a declared fold it applied, a SYN or a stop that changed heads); Figure otherwise. All 27 can be written, read raw (`SEG(cell: ...)`), filtered by use and grouped with `REC(e.cell)`. The halves can disagree and the disagreement is reported, not repaired. A step whose frame did not change is a NUL step, never a gap. A position-sensitivity test holds the label and changes the role: one reader adopts a ground entry, another does not.

## 4. Worked examples

**How to read.** Each is a hand walk: I read the statement against the entries PROBLEMS.md cites and wrote what the language would have to return. Data are tagged as PROBLEMS.md tags them. The statements and returns are **Proposal**; nothing was run. Ground labels such as `$clip-12h` stand for entries not yet woven; times are shortened.

**E1. RP-01 and RP-17: identity chosen, adopted, re-asked.**
```
GROUND identity clip-12h {via: args.clipId; key: [args.clipId, incarnation];
  split: ms(e.at) - ms(prev.at) > baseline.quiet}     -- baseline.quiet = 12h, earned: false
ADOPT identity: $clip-12h, baseline: $quiet-12h ;     -- by the T4 reviewer
ASK multi-lane OF SEG(kind: write) DEF(as: @reviewer)
```
The shape `multi-lane` is declared in the same ground family (`touches` `by` and `args.clipId`, no root, so `selectivity: scan`). Return for the reviewer: 236 of 1,929 (**Result**, `OUT/t4.json` C_gap_split via RP-01). A reader who adopted only the protocol ground (identity is the `addr` string) gets 258 of 1,864 (A_strict). `CONTRAST` by slot reports identity as the only slot that differs: 22 fewer multi-lane clips, 65 more entities. For `000f4989`: one entity with three lanes under the protocol ground, two incarnations under 12 h. **Open:** RP-01 does not restate the lane definition used by T4; and 12 h has no earned value, so the envelope prints `earned: false`.

**E2. RP-03: who created `000f4996`.**
`ASK creator OF INS("000f4996") DEF(as: @editor)`. Protocol ground: first entry at the address is `16e22d64ad64` (v2-sec-10, 11-06), a different clip that held the id 123.96 h earlier (E-03); `entailed` under that ground and about the wrong clip. Under `$clip-12h`: the second incarnation starts at `a9ce356581f8` (oracle-v2-master, apply_effect, 03:11:39.407Z). The creating call `b6382f7c25f2` names `projectItemId 000f4987`, not the clip, and no creating call carries a created id (0 of 1,988, **Result** `OUT/t5.txt` B), so it is reachable only through an `inferred` edge (matching in 22.208333, out 26.583333, 7 s earlier) declared in the dependency slot. Return: `b6382f7c25f2`, grade `held`, never `entailed`, with BL:1359 as a prose pointer that is not an entry.

**E3. RP-06: ten grants in 3 ms.**
`ASK first OF SEG(kind: permit-granted; range: ["21:20:03.600Z", "21:20:03.620Z"]) DEF(as: @auditor)`. Under `$clock-5ms` (time `ms(e.at)`, concurrent within 5 ms; dependency `of` only, citing `pharos-import.jsonl:1` where the importer states that `seen` is replay order): the ten grants lie within 2 ms (`8ff2a0570ac0` v2-sec-01 to `d583fddbb47b` v2-sec-12), none cites another (each cites its own raise, shown for another permit in RP-09, not re-checked for these ten), so there are ten minimal elements: verdict both, survivors 10, grade `held`. Under `$replay-seen` (edges `of` and `seen`): v2-sec-01 is first and `entailed`, which is file order. Active at once: 10 by lease validity, one at a time by writer (105 writes, 3 lane switches).

**E4. RP-07: in flight at the hang.**
`ASK in-flight OF INS("20261111-175958946__oracle-v2-master") DEF(return: pointers)` (identity `via: body.permit`). The log holds the raise (`00c959e54206`), grant (`dcf000fecf68`, 23:59:59.616Z) and release (`fa5adfb04a0b`, 00:08:35.828Z), adjacent lines, no write between them, and no write from `4b863adaf274` (23:59:58.649Z) to `086ca3d5a9d2` (01:06:55.013Z). The shape needs a completeness claim for the lane's calls; none exists. Return: verdict `gap`; answer "0 writes recorded in an 8 min 36 s lease"; pointers to the five ids; "read 5 of 10,244"; BL:1354 as a prose pointer. Never `none`.

**E5. RP-09: a withdrawn request that was then granted (a write).**
`WRITE retract(addr: "permit:20261111-230838172__oracle-v2-master"; of: [#9b02506ce583]; body: {reason: "withdrawn"})`, then `ASK in-flight ... DEF(asof: 05:13:00Z)`. Dependents of the raise: release `054f5a56a4fb` (05:11:00.254Z) and grant `7068cb995a0c` (05:12:49.343Z, expires 05:15:49Z). The real log holds no retraction (**Result** E-16), so this is synthetic. `$void` (dependency `voids: dependents`): both dependents void, is-not. `$stand` (`voids: none`): the grant stands, is, until 05:15:49Z. A third answer, no, comes from `$stand` with a time rule that an end before its start still ends it (the QA C05 convention). `CONTRAST BY slot` returns dependency for the first pair and time for the second.

**E6. RP-10: writes after release.**
`ASK after-release OF INS("20261110-155554179__oracle-v2-master")`. The release entry `276e46ffefd1` (21:58:30.707Z) carries `20261110-155554179` with no suffix; 31 log rows carry the suffixed permit and 26 follow the release time (E-08). Strict identity: the permit has no release, so the shape returns a hole, not 0. With absence `no-release: as(false)` the answer is 0 (**Result** E-08, 0 over all permits). With `respects: {names-one-lease: prefix}` the answer is 26. The clean 0 came from an absence decision.

**E7. RP-12: who touched `000f8314`.**
Three dependency slots. Edges from `args.clipId` only: audio-mix alone (16 entries). Edges also from ids in script text: audio-mix and oracle-v2-master (`d2742b71b263`, a read-only script). Text edges only where the script has a mutator token: audio-mix alone. The re-fit in BL:652 is found by none and is returned as unresolved prose.

**E8. RP-13: did anyone change this since I last wrote (pointers).**
`ASK since OF INS("000f4989") DEF(for: editor-premiere-3; frontier: #949ce5cc2231; asof: 03:14:31Z; return: pointers)`. By clip id: 1 entry, `63446d2b50aa`; cone 13 entries, 12,502 of 10,350,899 bytes (E-04). By sequence region: 25 entries, 9 by another lane. By track and time: `gap`, since only 14% of writes carry all three and the replacement clip's id is unrecorded. Envelope: `read 13 of 10,244`, `hints_used: false`, no bodies.

**E9. RP-05 and RP-15: what a write replaced, and recording it.**
Before: `ASK before OF INS("000f44a7")` returns hole origin `unread` and the pointer BL:1363 (six keys, linear scale, 0.1778 = 0 dB, prose). After: `WRITE INS(addr: "obs:000f44a7:keys"; kind: observation; body: {keys: [...six...]; unit: "linear"}; basis: {source: "BL:1363"})`, then `WRITE DEF(addr: "000f44a7"; ...; of: [#8f865ef34e59]; before: #obs)`. A DEF without `before` is refused (`E_NO_BEFORE`); `before: unread` is allowed and is stored as such, so "not read" never becomes empty. RP-05 then returns the six keys with their source.

**E10. RP-16: declare the Ellison attribution ground.**
Slot entries by the experimenter for identity, dependency, absence, sufficiency, baseline and time (the "before" in "cue before run"); no conflict rule is stated. dependency: leading cue, hand-over, single-speaker run after one; a trailing cue is not an edge. absence: a run without a leading cue is `not-established`, separate from entries of class `not-his` (marked `negative`). sufficiency: a T2 leading cue; T3 provenance never alone. baseline: left undeclared (the ledger states none), so a shape that needs a baseline refuses (**Open**). `CLAIMS [count(withheld, class = "pass-trailing-cue-only") = 4]`. By hand from E-09: 4 of 49, the verifier entries `4321b4f7651d`, `7640f175315d`, `0fb14fe7dc96`, `c48faee3dc74`. `CHECK` would pass.

**E11. RP-18: record a stop, revise it on a late entry.**
`RECORD ASK value OF INS("000f4989")` writes a `stop` (EVA) naming the frontier, ground ids and baseline; the cone is 7 entries in 3 permits (E-04). The unlogged 18:00 `replace_clip` (BL:1354) is backfilled; its writer weaves an EVA is-not citing the stop and the new entry. Nothing detects this mechanically, since no logged field links the two. The next ask has a new head set, so the memo key misses; it returns the new answer citing the contradiction, and `asof` before the cut still returns the first. A stop is a claim, never a fact.

**E12. RP-21: one cone, three grounds.**
`CONTRAST ASK attributed-count OF SEG(kind: utterance) DEF(as: @script) VERSUS {dependency: $no-trailing-rule}`. 153 attributed under the current ground; 157 when the trailing-cue edge is dropped (153 plus the four of E10; E-09). Dependency is the only slot that differs, so it carries all four. Seconds: 2,165 plus 644.6 = 2,809.6, 11.4% of 24,594.5 (an upper bound; E-19). The 156 before patch 1 exists only in `out/pre_patch/LEDGER.md`; as a ground it was never authored, so `asof` over grounds cannot reach it (**Open**).

**E13. RP-23 and RP-19: absence kinds, and pointers.**
`ASK attributed OF SEG(addr: "v03-x5gmidnyeds-whitehouse-stargate-remarks-73e4886b"; range: [100, 200]) DEF(return: pointers)`. The range lies inside run `6315d52dab2b` (class not-his, the host's remarks), marked `negative`, so the verdict is is-not: "0 attributed; 100 of 100 s examined". Seconds by class: not-his 2,406.1; unattributed-or-unproven 284.0; attributed 90.9; withheld 2.0; no entry 1.7 (E-10); only the last is a hole. For `#372.2-536.1` (`7cbe4c70af48`) the return carries class and reason text as two fields; it does not judge them. RP-19: the same form with `basis` returns `1f39a696e57e`, `e07d1a17d4c4` (T2, caveat true) and `a2325eaddbf0` (pass), the plate ref, the recorded `[name] window` command, "in point safe, out point has none", and "read 3 of 764", with no utterance text.

**E14. RP-27: same or other.**
`ASK same OF SEG(addr: "X5gMiDnYEds_hq_stream_copy.mp4"), SEG(addr: "V03_X5gMiDnYEds_whitehouse-stargate-remarks.mp4") DEF(respect: "words-at-a-time")`. The shape declares `requires: [respect]`; with none, refusal. `respects` in the identity slot: "recording" (key `ascii-lower` of the YouTube id read from the file name) gives Same, grade `held`, since provenance is inferred from names; "file bytes" gives Other (no hashes, **Open**); "words-at-a-time" needs the hq-to-V03 time map, which neither log holds, so `gap` with three pointers.

**E15. RP-24, RP-08, RP-25, briefly.** RP-24: `ASK status OF SEG(kind: utterance) DEF(for: extractor)` gives (153 attributed, 0 withheld, 49 undecided); the all-writer ask gives (153, 49, 0). `SEG(by: ...)` and `for:` are separate forms because they can differ (556 of 3,690 pairs on the Premiere replay, **Result** `t_report.json` T.b). RP-08: with `baseline.starve` at 600 s the list has 28 raise-to-grant waits (the 251 s citizens wait absent), at 240 s 88; `CONTRAST BY slot` names baseline as the only difference. RP-25: `ASK occupied OF SEG(all) REC(e.cell)` lists the 11 declared positions (E-12) and the 16 others as unoccupied, not zero. Computed grain by use needs the protocol ground's text and cannot be walked here (**Open**).

## 5. Many models, one log

**Proposal.** Each family is a ground (slot values below) plus, where wanted, a derived layout. A layout is a memoized fold under a stable ground, keyed by head set and slot ids, disposable and never read back as truth. No family is promised native-engine speed; the note says no existing system is first rate at all of them.

- **Relational.** Identity `[addr, cell]` via `addr`; dependency `of` and `seen`, `voids: none`; time causal with the frozen library's tie declared as a 27-row rank table in the slot; absence: `no-field` and `null` both `as(NULL)`; baseline `differs` is body inequality; conflict: `latest_causal` by `pos`, plus all heads; layout: one table per declared kind from its `schema`. Test: `heads`, `conflicts`, `latest_causal` and `entries` row sets equal the pharos-sqlite tables on both real logs, compared by its `canon` hash (**Result** as stated in its DESIGN.md, not re-run here: both logs regenerate byte for byte; the equality with the fold is **Open**). Where the layout cannot hold an entry (extra fields) it refuses, as pharos-sql does with `E_LOSSY`.
- **Document.** Identity the root of `addr`; dependency edges downward from `body.parent` (a forward lookup); absence keeps `no-field` apart from `null`; conflict per-field latest; one root per field; `REC(path)` rebuilds the nesting. Test: write a nested object field by field and read it back equal.
- **Graph.** Identity `body.id`; edges are CON entries; `CON(rel; fwd; n)` is the query and the kernel walk is the traversal; absence is open world (a missing edge is `unreached`, never false); conflict union. Test: reachability against a reference graph engine.
- **Key-value.** Identity `addr`; dependency `of`; delete is `retract` with no reach; root is an entry whose `of` covers the found heads, so a hot key stops after one entry. Test: at most 100 entries read on a 10^4-entry chain.
- **Time-series.** Identity `[addr, tags]`; time `order` is `body.t` with `concurrent-within: 0`; no dependency, so every point is a root and the cone is the window (`selectivity: scan`); a silent interval is `unread` unless a completeness claim covers it; buckets by `REC`. Test: window sums equal a reference over the same points.
- **Event log.** Identity the stream `addr`; time causal; conflict fold `append`; state is a declared fold whose step is `apply`. Test: equals the reference state.
- **CRDT.** Identity `body.item`; dependency `of` and `seen`; time causal. The multi-value register is the kernel default, both; LWW is a declared fold with its tie `(ms(at), by)` written out; a G-counter is max per replica then sum; an add-wins set is `voids` limited to the adds in a remove's `seen`. Each merge carries `commutes: true`, which `CHECK` tests over shuffled orders of concurrent entries (necessary, not sufficient).

**Flow.** Data written under one ground are read under another with `CONTRAST ... VERSUS {...}`. The loss manifest is measured, not declared, in three columns: values a fold discarded, identities merged or split, and holes whose origin changed (a relational `NULL` read under the document ground is a `null` hole; the original `no-field` cannot be recovered). A foreign import is `WRITE INS` per row with `basis` naming importer and input hash.

## 6. What it refuses

**Proposal.** Each refusal cites the learning in LEARNINGS.md.
- UPDATE and DELETE: writes append (33). A retraction never removes.
- An ASK with no adopted ground (1, 2, 5, 38).
- A built-in fold, collapse, shape, window or function list (8, 36).
- A default edge set, identity, tie-break or ordering by `at` (19, 20).
- NULL, three-valued logic or SQL value coercion as kernel semantics (35).
- `none` for a negative without completeness evidence (18).
- A first-hit stop where the shape asks for count or standing (14), and a per-step stop test (15).
- A stop that cannot be contradicted, and a stored answer in the log (17, 31).
- Editing a ground in place, or reading a past cut with a later ground unsaid (4).
- A statement that infers a cell from a kind name (22), or an identity merge inline (1).
- An answer that depends on a scent trail; trails shape the plan only and the envelope says whether a hint was used (30).
- Inline fold bodies, and a fallback to a similar built-in (8).

Out of scope: the per-caller seen ledger and trails belong to the door (28, 30); erasure (test k) needs a protocol change, since stripping a body breaks the content id.

## 7. What it would teach about EO, and what would count against it

**Proposal.** It would teach whether the six decisions plus conflict rules suffice for seven database families; whether stopping at declared roots is sound and cheap; whether an entry's position by use differs from its typed label on logs that hold ground events; and whether one baseline serves sameness, the stop and trail evaporation (27). DECLARED, to test: reading the slots as absence, baseline, identity, time, dependency would follow the operator order NUL, SIG, INS, SEG, CON. This design puts time before identity because RP-17's split needs a time metric, so the alignment is already contradicted unless the split is a later SEG of an identity.

Outcomes that would count against it. A family needs a built-in kernel rule (a tie-break, an edge set) that no declaration can express. A family needs an eighth slot. The kernel count grows when the next problems are added. `CONTRAST BY slot` attributions interact (non-additive) in most real contrasts, so the slot split is decoration; no real problem in PROBLEMS.md differs in two slots, so this is untested. Grain by use never differs from the typed label on any log with ground events. A quiet stop stops before a seeded consequential change (note test b). Bars are set in the next pre-registration.

Twelve tests of the note, mapped: (a) head finding: identity `via`, index derived; (b) stop soundness: `quiet` grade and `CHECK`; (c) starvation: per-branch `root`; (d) corroboration: shapes `touch` `by`, no first-hit root; (e) late arrival: memo key, E11; (f) concurrent heads: both, E3; (g) rules that look back: item 11; (h) ground falsification: `CLAIMS`, E10; (i) compiled layouts: relational test, section 5; (j) whole corpus: `selectivity: scan`; (k) erasure: out of scope, **Open**; (l) kernel size: section 2.

## 8. Decisions for the user

Each is **Open**, with my recommendation first.
1. **An ungrounded read.** Refuse; raw reads only. Other: return both marked ungrounded. Cost: it looks like a result with no ground named, the first attempt's default-frame fault (38).
2. **Where the term language lives.** In the kernel, total and listed (items 21 to 24). Other: grounds as pure assertions with no computed rule. Cost: a smaller kernel, but RP-01's split and RP-08's thresholds cannot be declared.
3. **Grain by use.** Compute it beside the label. Other: label only. Cost: 27 strings, and position sensitivity cannot be tested (22, 23).
4. **Read traces.** Outside the language, through the gateway (keeps "reading is not writing"). Other: a write form for traces. Cost: every question grows the log.
5. **Quiet stops.** Allowed behind `quiet: allow`, never by default. Other: rooted only. Cost: a long chain of restatements is always read.
6. **Held grounds.** Both across grounds. Other: refuse two live adoptions per slot. Cost: a reader cannot hold two perspectives, which the note's competing grounds need.
7. **Literal thresholds.** List them in the envelope. Other: refuse a literal compared with a measured quantity. Cost: a refusal on every ad hoc question.
8. **A first ground.** Republish the frozen library's rules (identity `addr`, edges `of` and `seen`, tie by cell rank then id, retraction reach none, conflict both) as one ground under the pharos author's byline. Other: each reader authors their own. Cost: no shared start, and every first read is an authoring task.
9. **Verbs for ground, adoption and stop** (DEF or REC, DEF, EVA) from the wiki. Keep, flagged DECLARED. Other: more verbs or kinds. Cost: more kernel; and the NUL and `retract` clash stays.
10. **Text edges.** `split` and `contains`, no regex. Other: bounded regex. Cost: shorter terms for RP-11 and RP-12, more kernel, and a ReDoS surface.

## 9. Where this may be SQL or Datalog renamed

**Proposal** (my call; a critic is to overrule it). Eighteen constructs.

| Construct | Nearest | Call |
|---|---|---|
| ASK clause chain (SEG, EVA, SYN, REC, DEF) | SELECT, WHERE, aggregate, GROUP BY, ORDER, AS OF | rename |
| `CON(rel; dir; n)` | recursive CTE, graph path | rename |
| `INS(t)` under a declared key | key lookup, Datomic lookup ref | refinement |
| Term language T | SQL expressions, Datalog bodies without recursion | rename |
| Ground rule as an attributed entry | Datomic schema as datoms, Datalog rules as facts | refinement |
| Seven slots in one ground | DDL, collation, NULL policy, views, separately | refinement |
| Adoption by a reader | role or `search_path`, versioned views | refinement |
| Fold by `init`, `step` | user-defined aggregate, event-sourcing apply | rename |
| Both with a survivor count | multi-value register | refinement |
| Held grounds (both across grounds) | none known to me, unchecked | new |
| Hole origins by mechanism | NULL, missing key, tombstone, separated | refinement |
| Completeness-gated negatives | open-world assumption, Bloom-style one-sided errors | refinement |
| `CONTRAST BY slot` | diff of two views | new |
| Stops: rooted, quiet, recorded | backward slicing, magic sets, newest-first reads | refinement |
| Grain by use, frame-difference trace | none known to me | new |
| `for:` perceiver window | as-of, snapshot, Matrix state at an event | refinement |
| `return: pointers` | key-only SELECT, cursor | rename |
| `before:` on writes | RETURNING old values, audit trigger | refinement |

By my call: 5 renames, 10 refinements, 3 new, so 3 of 18 (17 percent) have no counterpart I know. **Open:** prior art for ablating schema decisions is unchecked, so "new" may be wrong.

Places it may be renamed SQL or Datalog in substance:
- Stratification by existence order is stratified Datalog with a different order, and T is Datalog without recursion.
- A SQL user with a plain entries table and one view per ground gets E1, E5, E6 and E12. The first attempt found that one statement did not separate the two when SQL read a projection that stored the fold (**Result**, `test/out/p23_answers.json` and PREREG-A2: 106 of 107 SQL answers were one statement). What could separate them is re-implementation per question (fold, ground, stop), to be measured against a plain table.
- `CONTRAST BY slot` is two views and a diff unless the slots are separable. If identity reads time (RP-17) they interact and the attribution is an approximation.
- The kernel claim leans on T being perspective-free. A critic can show that `ms()` or `ascii-lower` already carries a choice.
- Held grounds and grain by use have the least support; they exist because the note and the 27-position requirement ask for them, not because a result does.
