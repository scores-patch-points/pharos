# EOQL as differences between frames

Designer 2 (premise: frames and the 27 positions), 2026-11-14, for `PREREG-A4.md`. Nothing is built. The only measurements are read-only scans I ran today on the replay and Ellison logs (marked "scan", one reader, nothing written).

Tags: [Result: where], [Prior art] (from memory unless said checked), [Proposal] (stated, not tested), [Open]. In sections 2, 3, 5 and 6 an untagged sentence is a Proposal. "Declared" means someone typed it and nothing checked it. Ids are the first 12 hex of the entry id; `file:line` is the replay or Ellison file and 1-based line. `g:name` is the id of a ground entry a script wove under that label.

## 1. Thesis

1. A frame is the four things a reading holds fixed: the adopted ground, the cut, the perceiver and the fold; the log never changes, only the frame does.
2. An EOQL expression is a difference between two frames, and a lone question is a difference against the baseline frame that the ground itself declares, so decision six of the ground (baseline) is a frame and not a number.
3. The nine verbs name classes of difference and a position is a verb at a grain, the grain being which part of the frame pair differs (declarations, instances, or entries written back from the first frame); a writer's typed cell is a label checked against the difference the entry makes, never assigned.
4. Identity, edges, time, absence, stopping, sameness and the fold are read from adopted ground entries, so held values, disagreeing perceivers, competing grounds, stops, Same/Other/Gap verdicts and late arrival are one result type, the typed delta.
5. Nothing here is a Result except the marked scans, and one of them already counts against my first reading of the positions (E13).

## 2. The kernel

Everything the evaluator hardcodes. Count: 16 items.

| # | Item | Why it is not a ground in disguise |
|---|---|---|
| K1 | Entry law: pharos weft, id = sha256 of canonical JSON, append-only, `retract` is an entry | Inherited from `pharos/SPEC.md`; interprets no entry |
| K2 | The 27 position ids and nine-operator dependency order (`cells.json`), as data | Names and order only; meaning is a declared reading |
| K3 | Frame record of four components, evaluated to slot states over a visible set; read form `same` | Fixed parameter list; every value declared |
| K4 | Delta: four parts and three flags, by set difference | Computes differences and names none |
| K5 | Adoption bootstrap: reserved body key `eoql` (members `adopts`, `stops`, nine ground keys), read only inside adopted entries | The regress of "which ground" ends at the reader (note); the keys are the six decisions plus folds, reads, claims |
| K6 | Null ground: nothing adopted gives identity = entry id, no edges, no order, fold `held`, marks `ungrounded` | Equates, orders and excludes nothing: the dual of "assume Other" |
| K7 | `both`: concurrent heads, competing pieces, adoptions or perceivers return every alternative with survivor count and grade | The note's default; the kernel's only fold |
| K8 | Backward walk from the heads of touched classes along declared edges inside the visible set | Direction is the wave fold; edges are declared |
| K9 | Identity classes: components of declared links and merge entries | Which links is the ground's |
| K10 | Term language: JSON values plus `gap`, paths, 23 total functions (`get put has len eq lt add sub mul div and or not if cat fold ord both secs prefix mentions rank pos`), bytewise strings, `gap` propagates | Computation only; no NULL, coercion or collation |
| K11 | Stop machinery: stop only when the ground's `root` and `enough` both hold, `enough` against the accumulated answer; no declaration, no early stop; a stop may be written | Thresholds and roots are the ground's |
| K12 | Absence classification: an empty answer is classified by the ground's ordered tests, else `unclassed` (Gap) | The kernel only refuses a bare "none" |
| K13 | Completeness evidence: corrupt or torn lines, dangling `of` or `seen`, on every answer | Integrity facts, not interpretation |
| K14 | Envelope marks: frame echo, citations, cone counts, `read N of M`, groups by fold value, pointer form, `hints_used` | Marks only |
| K15 | Write discipline: reads write nothing; `weave` appends; `of` names earlier entries only; `seen` from the `reads` frame; receipt with delta | Pharos law; "earlier only" is the note's stratification |
| K16 | Typed refusals, total parser, caller-supplied budget, no default | A default budget would be a typed constant |

Not in the kernel: any fold other than `held`, edge set, identity rule, order, NULL, threshold, meaning of a position, shape vocabulary, trail, or cache that carries an answer. [Result: the first attempt's kernel was 9 verbs, 8 frame arguments, 5 primitives and 3 closed vocabularies, `eoql/test/out/t_report.json`; the count 16 is not comparable.] K10 is the largest item and is where SQL's value semantics could return; I removed NULL, coercion and collation and kept the rest [Open: whether 23 functions is too many].

## 3. The language

### 3.1 Objects

A **frame** F = ⟨G, c, p, f⟩: G the adopted ground, c the cut (resolved by G's time decision), p the perceiver (which entries this reader could know), f the fold (what a slot's members become). The visible set is V(F) = c ∩ p. A **region** is a term selecting seed entries. A **slot** is an identity class under G. A **slot state** is its heads (members not dominated under G's order), the fold's value over them, the survivor count n, and a grade (`entailed` only from `of` links or a superseding entry, else `held`).

A **delta** Δ(A, B; r) has four parts, three flags. `ent`: entries in B's cone for r and not A's, and the reverse. `eq`: pairs of cone entries equated by B's identity and not A's (merged) and the reverse (split). `edge`: edges followed by B and not A, and the reverse. `val`: for each pair of classes sharing an entry, the two fold values and a verdict Same, Other or Gap under the judging baseline (B's ground unless `under` names another). Flags: `decl` (G or f differs), `inst` (V differs), `fed` (some entry in V_B and not V_A has `basis.frame` equal to A's digest). A delta with every part empty and no Other verdict is reported as `no transformation`: a result, never an error or an absence.

The unit of a delta is an **element**: one added entry, one pair, one edge, one val change. Each entry also has its own delta, Δ(past(seen), past(seen) plus the entry), computed online from what its writer saw.

### 3.2 Grammar

```
stmt  = read | same | write ;
read  = ( "ask" "in" frame [ "against" frame ] [ "of" term ]
        | ( "diff" | POS ) "(" frame "," frame [ ";" term ] ")" )
        [ "under" ref ] [ "stop" "keep" ] [ "return" form ] ;
same  = "same" "(" term "," term ")" "in" frame "respect" string ;
write = "weave" kind "at" term "of" "[" ids "]" [ "reads" frame ]
        [ "cell" CELL ] "body" json ;
frame = "{" comp { ";" comp } "}" | ref | frame "with" comp { "," comp } ;
comp  = "ground:" gref | "cut:" cut | "by:" perc | "fold:" ident ;
gref  = "none" | "adopt" "(" ids ")" | "adopted-by" "(" ident ")" ;
cut   = "head" | "asof" "(" term ")" | "past" "(" ids ")" ;
perc  = "all" | "past" "(" ids ")" | "only" "(" idents ")" ;
form  = "answer" | "pointers" [ "unseen-by" perc ] ;
POS   = OP [ "·" GRAIN ] ;
OP    = "NUL"|"SIG"|"INS"|"SEG"|"CON"|"SYN"|"DEF"|"EVA"|"REC" ;
GRAIN = "Ground" | "Figure" | "Pattern" ;
term  = scalar | path | ident "(" [ term { "," term } ] ")" | term "=" term ;
path  = ident { "." ident } ;
```

`=` is sugar for `eq`; `has(p)` tests that path p exists. Lexical: `ids` are comma-separated id prefixes or labels, `CELL` is one of the 27 position ids, `json`, `string` and `scalar` are JSON.

`ask in F` means `diff(F0, F)`, where F0 is the frame named by F's ground at `baseline.frame`, else the null frame at the empty cut. `fold: held` is the kernel fold; any other name must be declared in the adopted ground or the statement is refused `E_NO_FOLD`, with no fallback. `POS(A, B)` returns the elements of Δ(A, B) that the active reading places at that position. `same(x, y) in F respect R` evaluates the ground's respect term R on x and y: true is Same, false is Other, `gap` is Gap, an undeclared R is refused `E_NO_RESPECT`. Statements hold references only: a ground body, fold body or cell enters through `weave`, never inline. Any text outside the grammar is `E_PARSE` with a position; the parser never translates a prefix.

Bound names in terms: `e` (an entry, in regions), `a` and `b` (consecutive members of a block, in identity links), `x` and `acc` (fold), `s` (slot), `d` (a delta element, in readings), `g` (an adopted ground body).

### 3.3 Ground: declared, adopted, read

**Declared.** Any entry, by any byline, whose body has `eoql` with any of these keys is a ground piece (the note's six decisions plus three accessories).

```
eoql = {
 identity:    { block: term(e), link: term(a,b), merge: kind },
 edges:       { follow: [edge], voids: [edge] },
 time:        { order: "edges" | term(e), tie: term(a,b), then: term(e) },
 absence:     [ [name, term(frame, region)], ... ],            (ordered)
 sufficiency: { root: term(e), enough: term(acc, next) },
 baseline:    { frame: frame, respect: { name: term(x,y) } },
 folds:       { name: { input: "heads"|"members", init: term,
                        step: term(acc,x), post: term(acc) } },
 reads:       { ops: { OP: term(d) }, grain: { GRAIN: term(d) } },
 claims:      [ term(frame) ] }
edge = "of" | "seen" | { field: path } | { mentions: { in: path, names: path } }
```

`identity` partitions entries: `block` groups, `link` joins consecutive members of a block under the time order, `merge` names a kind whose entries join the classes they cite. `edges.follow` is what the backward walk follows (the cone); `edges.voids` is along which a retraction also voids dependents. `time.order: "edges"` means later is the dependency order; a term means a key (clock or valid time). Heads are the members not dominated under `time`; the cone is what `edges` reaches from them. Pieces compose by union of keys. Two adopted pieces that set the same key are competing and the frame splits in two (K7).

**Adopted.** The reader weaves an entry whose body has `eoql.adopts: [ids]`, under the reader's own byline, `of` the pieces. `ground: adopted-by(W)` resolves to the heads of W's adoption entries as of the frame's cut; concurrent heads give both frames. `ground: adopt(ids)` writes nothing and marks the answer `adoption: unrecorded`. A publication changes nothing until someone adopts it.

**Read.** Pieces are resolved as of the cut. A piece that supersedes another cites it in `of`; the head of the chain is in force. A past cut under a later piece needs explicit `adopt(ids)` and marks `anachronistic: true`. Every answer cites the piece ids and bylines used. A byline attributes and does not validate, so `claims` carry predicted structure; a check is `diff(A, N)` on the claim's value, N being a null frame the checker names (a shuffled copy of the log, say); the kernel generates no nulls (note, falsification).

### 3.4 Folds and stops

A fold's input is `heads` or `members`, visited in a linear extension of `ord(a, b)`, which returns `<`, `>` or `~` (concurrent) under G's time decision; against a held list it returns `~` if any element is concurrent. `both(a, b)` is the held-set union. Five starter folds, each declared without a kernel keyword [Proposal; PREREG-A3 counts any failure here against the small kernel]:

```
latest   { input: heads,   init: none, step: if(eq(acc,none), x, both(acc,x)) }
first    { input: members, init: none, step: if(eq(acc,none), x,
             if(eq(ord(x,acc),"<"), x, if(eq(ord(x,acc),"~"), both(acc,x), acc))) }
count    { input: heads,   init: 0,    step: add(acc,1) }
sum      { input: members, init: 0,    step: add(acc, x.body.v) }
sources  { input: members, init: [],   step: both(acc, x.by), post: len(acc) }
```

Not yet tried: `per-field` and `ranked-by-author` (authority order read from `g`) [Open].

The fold is also the question's shape. Static analysis of `step`, `post` and the region term gives the paths an entry can touch; an unread entry that touches none is skipped when the store can say so, and a store hint is never authority. The walk reads members backward and accumulates `acc`. A branch stops only when `root(e)` holds for an entry already read in it and `enough(acc, next)` holds, `next` being the next unread layer. Because `acc` holds everything read, many sub-baseline edits accumulate instead of passing one by one (note, test b). With no `sufficiency`, nothing stops early. `stop keep` weaves an entry whose `eoql.stops` holds the frame digest, frontier ids, `root` and `enough`, and no result. A later entry citing below the frontier, or a retraction of the stop entry, ends its use. A stricter reader resumes with `diff(F_stopped, F_stricter)`, whose delta is what the stricter ground reads beyond the frontier.

### 3.5 Positions: where the 27 live

1. **Data.** `weave ... cell INS·Pattern` passes any of the 27 ids through, marked `cell_basis: declared`; an unknown id is `E_CELL`. Nothing is inferred from a kind name.
2. **Reading.** `reads_as(d)` for an element: every OP whose `reads.ops[OP]` holds and every GRAIN whose `reads.grain[GRAIN]` holds. None gives `unread` (Gap). Several are all reported (K7).
3. **Selectors.** `INS·Pattern(A, B)` returns the elements read at that position. All 27 are in the grammar.
4. **Check.** A write receipt carries `reads_as` for the entry's own delta next to the typed `cell`, and `agree`.
5. **Grid.** The 9 by 3 view is an ordinary `ask` whose fold is `cell` or `reads_as`; it is not a construct.

Grain is computed from the frame pair, not typed: Ground when `decl`, Figure when `inst`, Pattern when `fed`. The same entry is Figure-grain for a reader who has not adopted it and Ground-grain for one who has, which gives a test that holds the label fixed and changes the role (section 7). Distinguishable by behaviour means a witness pair per position: for example NUL·Pattern is a frame B that adds an entry written `reads A` which restates a held value. The test builds 27 such pairs; a position with no witness under a reading is reported unreachable under it [Open].

**Reading d1** (declared by me, a candidate for refutation, any other author may declare another): NUL, no element or only Same verdicts. SIG, a val element whose verdict differs only because the baselines differ. INS, an added entry whose class is new in B. SEG, a split pair. CON, an added edge between existing classes. SYN, a merged pair. DEF, an added entry that joins an existing class and changes its value while `decl` is false. EVA, an added entry whose `of` names an entry of G_B. REC, a changed val element with `decl` true. Grain: `d.decl`, `d.inst`, `d.fed`. [Prior art: the frame-diff labeller recovered CON only and DEF, EVA and REC showed no geometry in frames of beings and edges (project memory); I expect the same rows to be weak here.]

### 3.6 Result envelope

```
{ "v": "eoql-result/1",
  "frame": { "ground": [{id, by}], "cut", "perceiver", "fold", "adoption": "recorded"|"unrecorded",
             "anachronistic": false, "ungrounded": false },
  "answer": [ { "slot", "value" | "held": [...], "n": 1, "grade": "entailed",
                "absence": "name" | "unclassed" } ],
  "groups": [ { "value", "n" } ],
  "delta": { "ent": {"+":n,"-":n}, "eq": {"merged":n,"split":n}, "edge": {"+":n,"-":n},
             "val": [ {"from","to","verdict"} ], "flags": {"decl","inst","fed"},
             "reads_as": ["DEF·Figure"], "no_transformation": false },
  "both": [ <another resolved frame's answer> ],
  "cone": { "read": 5, "of": 10244, "bytes": n, "stops": [ {"branch","frontier","root","enough"} ] },
  "incomplete": null, "values_discarded": 0, "hints_used": false }
```

With `return pointers`, `answer` has ids, addresses and counts, no body, and only entries outside the `unseen-by` perceiver; the rest appear as `already: n`.

### 3.7 Where the twelve tests of the note land

(a) Head finding: heads are members not dominated under G.time, found by reading the class; a reverse index is a derived hint [Open]. (b) Stop soundness: `enough` against `acc`. (c) Starvation: a stop needs the declared `root`. (d) Corroboration: fold `sources` reads `x.by`, so the prune keeps other bylines and a first hit is not a stop. (e) Late arrival: memo key is frame digest, region and a digest of the class members (E9). (f) Concurrent heads: `~` and `both`; head choice is the ground's (E3). (g) Rules that look back: `weave` refuses `of` naming a later or unknown entry. (h) Falsification: `claims` against a named null frame (E8). (i) Compiled layouts: a disposable memo of a fold under a stable ground, keyed as in (e); section 5 is the comparison. (j) Whole corpus: the envelope says `read N of N`; no speed claim. (k) Erasure [Open]: an entry that blanks a body and keeps its skeleton, with absence test `erased`. (l) Kernel size: section 2.

Flow: a conversion is `diff(source frame, target-ground frame)` and its loss manifest is the `val` and `eq` parts [Proposal]. Agents: `return pointers unseen-by` returns the difference between the answer's cone and the asker's perceiver, so nothing already received is resent [Proposal]. No trail may appear in an answer (`hints_used` false).

## 4. Worked examples

Problem ids are from `design/PROBLEMS.md`. "Scan" is my read-only `python3 -I` scan today of the replay or Ellison log. "PROBLEMS" means quoted from that file (one reader), not recomputed. `g:` grounds are named by the keys they set.

**E1 RP-01 and RP-17, two identity grounds, then adoption.**
`diff({ground: adopt(g:id-key); fold: nlanes}, {ground: adopt(g:id-12h); fold: nlanes}; has(e.body.args.clipId))`
`g:id-key`: block `e.body.args.clipId`, link true, time order `e.at`. `g:id-12h`: same block, link `lt(sub(secs(b.at),secs(a.at)),43200)`. `nlanes`: members, `both(acc,x.by)`, post `len`.
Walk, clip 000f4989: v2-sec-04:98 (11-06T22:34Z), editor-premiere-3:937 to 941 (11-12T01:09Z), oracle-v2-master:5379 (03:11Z); gaps 122 h 35 m and 2 h 02 m. A: one class, 3 lanes. B: two classes, 1 and 2 lanes [Result: scan]. All clips: A 258 multi-lane of 1,864 classes, B 236 of 1,929 [Result: OUT/t4.json via PROBLEMS]. Delta: net +65 classes, val 258 to 236, `decl`; reads_as {SEG·Ground, REC·Ground}. The 12 h is a reviewer's choice, not earned [Open].
RP-17 is the write: `weave adoption at reader:t4 of [g:id-12h] body {eoql: {adopts: [g:id-12h]}}`, then `ask in {ground: adopted-by(t4); fold: nlanes}` returns B's 236 and cites both entries. A reader who adopted nothing gets the null ground (K6), where `nlanes` is undeclared: `E_NO_FOLD`. PROBLEMS expected 258 there; here 258 needs `g:id-key` adopted [Proposal].

**E2 RP-03, who created 000f4996.** Same frames; folds `first` and `creator` (post reads `x.body.created`).
Walk: v2-sec-10:33 (16e22d64ad64, 11-06T21:46Z), v2-sec-07:23, v2-sec-04:142 (23:14Z), then oracle-v2-master:5381 (a9ce356581f8, 11-12T03:11Z) and later entries; gap 123.96 h [Result: scan]. `first` is v2-sec-10 under A; under B incarnation 2 starts with oracle-v2-master. `creator`: no member has `body.created` (0 of 1,988 creating calls, PROBLEMS), so absence test `created-unrecorded` matches and the answer is that absence with a pointer. The log has no value for the second fold.

**E3 RP-06, ten grants within 3 ms.**
`diff({ground: adopt(g:of); fold: first}, {ground: adopt(g:of-seen); fold: first}; and(e.kind='permit-granted', lt('2026-11-06T21:20:03.610Z',e.at), lt(e.at,'2026-11-06T21:20:03.614Z')))`; `g:of` follows [of], `g:of-seen` follows [of, seen], both time `edges`.
Walk: ten grants, v2-sec-01:2 (8ff2a0570ac0) through v2-sec-12:6. Each `of` names its own lane's raise, so under A every pair is `~` and `first` is held, n = 10. Each `seen` names the previous grant in replay order (01:2 sees v2-sec-07:9, 03:10 sees 01:2, ..., 12:6 sees 11:2), so under B they chain and first is v2-sec-01:2 [Result: scan]. The importer says `seen` is replay order, not perception (PROBLEMS). Delta: 10 `seen` edges, n 10 to 1, `decl`; reads_as {CON·Ground, REC·Ground}. A clock ground would tie 01:2 and 03:10 at .611 under a typed tie rule [Open].

**E4 RP-07, in flight at the hang.**
`ask in {ground: adopted-by(coordinator); fold: writes} of or(e.addr=P, e.body.permit=P) return pointers`, P = `20261111-175958946__oracle-v2-master`.
Walk: raise 5317 (00c959e54206), grant 5318 (dcf000fecf68, 23:59:59Z), release 5319 (fa5adfb04a0b, 00:08:35Z): `writes` = 0. Neighbours 5315 (23:59:58Z) and 5325 (01:06:55Z) bound the gap [Result: scan]. Absence test `silent-lease` (grant and release, no write) matches. Answer: absence `silent-lease`, not none; `read 5 of 10,244`. Unlogged calls appear only in prose (BL:1354), as a pointer. 181 of 1,132 granted permits carry no write by `body.permit` [Result: scan], so silence under a lease is common.

**E5 RP-09, retraction and dependents.** (Scratch write; none made. The real logs hold no retract, PROBLEMS E-16.)
`weave retract at Q of [9b02506ce583] reads {ground: adopt(g:lease)}`, Q = `20261111-230838172__oracle-v2-master`; then `diff({ground: adopt(g:voids-of); fold: inflight}, {ground: adopt(g:grant-stands); fold: inflight}; ...)` at 05:13:00Z.
Walk: raise 9b02506ce583 (05:08:38Z), lane release 054f5a56a4fb (05:11:00Z), grant 7068cb995a0c (05:12:49Z), the last two citing the raise [Result: scan]. With `voids: [of]` the grant is void and `inflight` is absence `retracted-by-dependency`. With `voids: []` it is true until expiry 05:15:49Z (PROBLEMS). Delta: val true to absence, `decl`, no entry; reads_as {REC·Ground}. The receipt reads the retract element under d1 as DEF·Figure; the protocol's cell for retract is NUL·Figure: disagree [by d1's rules, not run].

**E6 RP-10, writes after release.**
`diff({ground: adopt(g:permit-id)}, {ground: adopt(g:permit-lease)}; prefix(e.addr,18)='20261110-155554179')`; `g:permit-lease` has block `prefix(e.addr,18)`.
Walk: A has the suffixed class (raise 4186, grant 4188, writes 4189 and 4191 to 4219, reconcile 4221) and a separate class holding the release `276e46ffefd1` (unattributed:4, 21:58:30.707Z, no suffix): none after release. B is one class; after 21:58:30.707Z are 4194 to 4219, 26 execute_extendscript [Result: scan]. Delta: one release merged, val 0 to 26; reads_as {SYN·Ground, REC·Ground}. `same(release, grant) respect "names one lease"` is Same, `"identical id string"` is Other, no respect is `E_NO_RESPECT`.

**E7 RP-13, did anyone change this since I last wrote.**
`diff({ground: adopt(g:premiere); cut: asof('2026-11-12T01:09:39.107Z')}, {ground: adopt(g:premiere); cut: asof('2026-11-12T03:14:31Z')}; e.addr='000f4989') return pointers`; `g:premiere` orders by `e.at`.
Walk: A is the lane's last write on the clip (editor-premiere-3:941, 949ce5cc2231). B adds one entry at the address: 63446d2b50aa (oracle-v2-master:5379, remove_from_timeline, 03:11:28Z). The cone is 7 entries, 13 by `of` closure [Result: scan]; by sequence, 25 entries (PROBLEMS E-07). The new clip 000f4996 has no recorded edge: absence `created-unrecorded`; by track and time: Gap (14% of writes carry them, PROBLEMS). Reply: one id, `read 13 of 10,244`, a named censor, no bodies. A `by: past(941)` perceiver would miss the lane's earlier entries (each `of` names only its permit); hence cuts.

**E8 RP-16, declare the Ellison ground.** (Write; not made.)
`weave ground-rule at ellison:attribution of [...] cell DEF·Ground body {eoql: {identity: ..., edges: {follow: [of]}, absence: [...], sufficiency: {...}, claims: [eq(trailing, 4)]}}` under the experimenter's byline; `trailing` is a declared fold counting `not-established` entries of class `pass-trailing-cue-only`.
Walk the claim: 49 `not-established`, 4 of that class: verifier:237, 249, 250, 251 (4321b4f7651d, 7640f175315d, 0fb14fe7dc96, c48faee3dc74) [Result: scan]. It holds in A. No null frame is named: `claim: untested-against-null`. The ledger states no baseline, so deltas are raw. "Who withheld this, under what rule" then cites the experimenter's entry; gate decisions stay under `verifier`.

**E9 RP-18, a stop, then a late entry.**
`ask in {ground: adopt(g:id-12h); fold: latest} of e.body.args.clipId='000f4989' stop keep`; `g:id-12h` declares `root` true, `enough` as head found.
Walk: incarnation 2 has six members (937 to 941, 5379), ordered by clock; head 5379. Finding the head reads the six members (test a), then the walk stops with 5379's `of` unread [Result: scan]. `stop keep` writes a stop entry with that frontier and the class digest. Now a backfilled e* (hypothetical; PROBLEMS RP-07) with `at` 11-11T18:00:03Z at the address: 7 h 09 m before 937, so it joins incarnation 2 as its earliest member. `latest` is unchanged and its stop stays usable. `first` changes, 937 to e*. A memo keyed by head set and ground id (the note's key) would serve the old `first`: wrong. The key needs the class digest, and the new digest shows e* outside any earlier stop. Delta: ent +1, val {latest Same, first Other}; reads_as {DEF·Figure}. [Proposal: a finding about my own rule, by hand.]

**E10 RP-21, how many statements are his.**
`diff({ground: adopt(g:gate); fold: status}, {ground: adopt(g:gate-open-cue); fold: status}; e.kind='utterance')`; `status` is attributed if an `attributed` entry cites the utterance, withheld if a `not-established` entry does; B lets class `pass-trailing-cue-only` not withhold.
Walk: 202 utterances, 153 attributed, 49 withheld (44 `fail-attribution`, 4 `pass-trailing-cue-only`, 1 `pass-no-own-ref`) [Result: scan]. B: 157. Delta.val: 4 slots Other (V02-02, P03-04, P04 S01, P04 S05), `decl`; reads_as {REC·Ground}; +644.6 s (PROBLEMS E-19). The 156 of revision 1 is in another folder: Gap, absence `outside-log` (PROBLEMS).

**E11 RP-23, what did he say at 100 to 200 s.**
`ask in {ground: adopt(g:ellison); fold: statements} of and(e.body.source='v03-x5gmidnyeds-whitehouse-stargate-remarks-73e4886b', lt(e.body.t0,200), lt(100,e.body.t1)) return pointers`
Walk: one entry overlaps, extractor:306 (6315d52dab2b, t0 0, t1 268.1, class `not-his`, "Host's own remarks"), citing source 7778d1dd7247 [Result: scan]. The fold is empty, so the ordered absence tests run and `not-his` matches. Answer: absence `not-his`, 0 attributed, 100 of 100 s examined; `read 2 of 764`. Not-his entries carry four classes (PROBLEMS E-17); a bare "none" would merge them.

**E12 RP-24, what the extractor knows.**
`diff({ground: adopt(g:ellison); by: only(extractor); fold: status}, {ground: adopt(g:ellison); by: all; fold: status})`, plus `by: past(extractor entries)` under grounds following [of] and [of, seen].
Walk (scan): whole log (153 attributed, 49 withheld, 0 undecided). `only(extractor)`: (153, 0, 49). Past following `of`: 482 entries, none by the verifier, (153, 0, 49). Following `of` and `seen`: 764 entries, 253 by the verifier, (153, 49, 0). Cause: the extractor's `attributed` entries carry a `seen` chain through the verifier's entries because the log was woven in one burst (18:35:37.028Z to .298Z). That frame is one no lane had. Delta between the two past frames: 253 entries, 49 slots Other, `decl`; reads_as {REC·Ground, CON·Ground}, and d1 leaves the 253 added entries unread. PROBLEMS RP-24 gave only the writer filter.

**E13 RP-25, positions in use, and the check.**
`ask in {ground: adopt(g:ellison, g:d1); fold: reads-grid}`
Walk (scan): the replay uses 10 cells, Ellison 6, union 11 of 27; none Pattern, none SIG; the 16 others are listed unoccupied, not as zero activity. In Ellison, 404 entries (153 `attributed` DEF·Figure, 202 `verified` EVA·Figure, 49 `not-established` SEG·Figure) each cite one utterance in `of` and share its address. By d1 each is an added entry joining an existing class with `decl` false: DEF·Figure [hand-walk of d1, not run]. Agreement is 153 of 404 (37.9%); the 202 utterances read INS·Figure and agree. This counts against d1, not the design: structure does not recover the pipeline's labels. The shuffled-`seen` null was not run [Open].

**E14 RP-27, one recording, four names.**
`same(x, y) in {ground: adopt(g:media)} respect R`, x the hq file, y the ledger source.
Walk: names X5gMiDnYEds_sec.mp4 (oracle-v2-master:3027 f8a77ed4aa3d), _full_1080p (:5295 15e998dd3cae), _hq_stream_copy (:5314 7b510ea258e5), and ledger source 7778d1dd7247 (scout:14, address id lowercase) (PROBLEMS). Bytewise comparison fails across the case difference; the kernel has no case fold. `g:media` makes respect `recording` true when a `same-recording` entry by a named byline cites both; none exists: Other (unearned). Respect `file bytes` compares `a.sha`, recorded by neither log: Gap. `words at time` needs an offset entry: Gap. The reply to "which statements does the clip show" is Gap with four pointers. A giver's `same-recording` entry with a basis would make `recording` Same. PROBLEMS gave Same on filenames; here sameness is earned [Proposal].

## 5. Many models, one log

Each family is a ground plus a fold. None promises native-engine speed.

**Relational (should reproduce the pharos-sqlite tables).** Two grounds.

```
g:rel-rows  identity { block: e.id, link: true }; edges { follow: [] };
            folds { row: { input: members, step: <project e.body by the kind's declared schema> } }
g:rel-heads identity { block: cat(e.addr, cat("|", e.cell)), link: true };
            edges { follow: [of, seen] }; time { order: "edges", then: cat(rank(e.cell), e.id) };
            absence [ ["NULL", <body key missing>] ];
            baseline { respect: { bytes: eq(a.body, b.body) } };
            folds { heads: held, conflicts: <pairs of heads whose bodies differ under bytes>,
                    latest_causal: <head of greatest pos(e)> }
```

Table `entries` is `ask` under `g:rel-rows` with `pos(e)`; `heads` and `conflicts` are asks under `g:rel-heads`; `k_<kind>` is `row` per kind; `kinds` is the declaration pieces. Retractions: `voids: []`; the target takes absence `retracted`. Test: the row sets equal the `entries`, `heads`, `conflicts`, `kinds` and `k_*` tables of `ledgers/pharos-sqlite` on both real logs. [Proposal; the pharos-sqlite DESIGN says its tables regenerate from the log.] [Open: `pos` needs the Kahn order of the first attempt, so K10 may be one function short.]

**Document.** Identity block `e.addr`; time `edges`; fold `doc` builds an object with `put` per declared field; a missing key is absence `missing`, distinct from JSON `null`.

**Graph.** Pieces of kind `rel` (`body.from`, `body.to`); `edges.follow: [{field: body.to}, {field: body.from}]`; reachability is the backward walk; shortest path and pattern match are not expressed [Open].

**Key-value.** Identity block `e.addr`; time `e.at`; fold `latest`; absence `absent`; `enough` is head found. Test: answers equal a replay into a map, reading fewer entries than the whole log on hot addresses.

**Time series.** Identity block `cat(e.addr, e.body.series)`; time `e.body.t` (valid time, not `at`); folds `sum`, `count`; a window is a region term; whole-corpus aggregates have a cone of everything and say `read N of N`.

**Event log.** The null ground of K6 plus a declared `step` over `members`.

**CRDT.** Identity block `e.addr`; time `edges` (partial); declared merges `union` (set), per-byline `sum` (counter), `ranked-by-author` (register); a tombstone is a retract with `voids: []`. Law tests are deltas: `diff(merge(L1,L2), merge(L2,L1))` and `diff(L, L plus L)` must select no element.

Vector, search, columnar, spatial and object stores are not declared; a similarity term would be a new kernel function [Open].

## 6. What it refuses to do, and why

1. UPDATE and DELETE. A change is a new entry; retraction is a mark (wiki: UPDATE conflates DEF, EVA and REC).
2. NULL and SQL's three-valued logic. Absences are declared and classified; `gap` is not false (note, absence).
3. A default ground, edge set, order, identity or fold. K6 returns the null-ground answer instead.
4. Inline folds, grounds or cells in a statement. Bodies enter through `weave` and are cited.
5. Collapse that the answer does not state. `values_discarded` is always reported (A3).
6. Ordering by `at` unless a ground declares it (pharos: order is causal).
7. Inferring a cell from a kind name, or defaulting an unknown cell (A2).
8. Sameness by equality, a default of Same, or `same` with no respect (SAME-OTHER-MAP).
9. "Select everything" for an agent, or a result with no `read N of M`.
10. Any answer that depends on a trail or hint (pharos-lazy A7).
11. Stored answers. A stop entry holds a frontier and a digest, never a result.
12. Statement count as the measure of power [Result: the first attempt's SQL arm answered 106 of 107 in one statement over a projection that already stored the fold, PREREG-A2].

## 7. What it would teach about EO, and what counts against it

- **Operators exist between frames.** If `reads_as` under a reading declared before looking agrees with writers' cells better than a shuffled-`seen` null, positions are recoverable from frame structure. Against: agreement at the null. d1 gets 153 of 404 on Ellison verdict entries (E13); the null is not run [Open].
- **Grain is a frame component.** Hold an entry's `cell` fixed, have a reader adopt the piece that moves it from instance to declaration, and the computed grain should flip. Against: no reading flips grain without a label change; then grain is a label (project memory: 27 strings).
- **Role is perspective-dependent.** E12: 49 of 202 slots differ with the dependency choice [Result: scan]. Against: answers rarely depend on the ground (PROBLEMS flags 12 of 27 problems as two-ground, a Proposal count).
- **One difference that makes a difference.** `respect`, `enough` and trail evaporation would read one baseline. Against: they need three different terms.
- **Earned sameness.** E14 returns Other and Gap where a filename reading returned Same. Against: a licence-free respect that recovers the paraphrase-test pairs without false accepts.
- **The ground carries the fold.** Against: any starter fold that needs a kernel keyword; the count is reported (A3).

## 8. Open decisions for the user

- **D1 Ungrounded read.** Recommend the null-ground answer marked `ungrounded`, Gap where a decision is missing. Refusal instead blocks agents that need the entries; mine risks being read as an answer.
- **D2 Term language.** Recommend K10 in the kernel (23 functions). Terms as declared function entries still need a bootstrap set and make each function a piece to adopt.
- **D3 Read traces.** Recommend a gateway outside the language writes receipts and the agent's perceiver is built from them. An in-language trace makes every read a write. Cost of mine: reads outside the gateway are invisible, so deltas err toward re-sending.
- **D4 Stop recording.** Recommend opt-in `stop keep`. Always recording makes reads write; opt-in leaves unrecorded stops that cannot be revised.
- **D5 Grain.** Recommend computed flags plus a declared reading. Typed cells only removes K4's flags and the check and leaves 27 strings.
- **D6 Budget.** Recommend caller-supplied, no default (K16). A ground-declared budget lets a ground starve its readers.
- **D7 SQL.** Recommend no translator; the relational ground is the test. A translator costs the v1 conformance work (27 of 31 strict in the partial run, PREREG-A2) and imports SQL's value rules.
- **D8 Memo key.** Recommend frame digest, region and class digest (E9). The note's head set and ground id is smaller and serves stale answers on backfill under a clock ground.
- **D9 The `fed` flag.** Recommend reading `basis.frame`, a field pharos has. A new entry field needs a pharos change.

## 9. Where this may be SQL or Datalog renamed

My own calls, [Prior art] from memory:

- Frame as a database value with as-of, hypothetical and history views: Datomic, XTDB bitemporal. Refinement.
- Delta of two frames: symmetric difference of two results. Refinement (typed parts, flags).
- Ground as a chosen rule set: a Datalog program, or RDF named graphs with SHACL shapes. Rename; adoption by a byline is the added piece.
- Identity as components of links within blocks: entity resolution, sessionising window, union-find. Rename.
- Edges and the backward walk with a stop: recursive CTE, Datalog magic sets, LSM newest-first reads (the note says so). Rename.
- Shape as the fold, prune by free paths: projection pushdown. Rename.
- Fold declared in the ground: user-defined aggregates, CRDT merge functions. Rename.
- `both` with survivor count and grade: MVCC and Riak siblings. Refinement.
- Absence kinds with ordered tests: Codd's two missing-value marks, typed nulls. Rename of the idea.
- Respects with Same, Other, Gap: parametric equivalence, `IS NOT DISTINCT FROM` with a name. Refinement.
- Pointers unseen by a perceiver: conditional fetch, change tokens. Rename.
- A declared reading that classes delta elements into nine operators: nearest is change-data-capture operation types (3, assigned from row state). No counterpart I know.
- Grain as which frame component differs: no counterpart I know.

Of these 13 constructs, 7 are renames, 4 refinements and 2 have no counterpart I know: 2 of 13, 15 percent, both untested. A Datalog with stratified aggregation, named rule sets and database-as-value could express most of the rest; if the two new constructs fail, this design is that.
