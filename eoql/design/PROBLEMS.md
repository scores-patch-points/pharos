# Real problems for the EOQL design round

Written 2026-11-14 by the real-problems collector for `PREREG-A4.md` (it feeds C-4 worked examples, C-5 many models, C-7 decisions, and the tests the design must survive). This is a design input. It builds nothing and runs nothing that changes any file. It lists 27 questions and actions that a person or an agent needs from the project's own two real logs, each with the real ids that answer it, what a correct answer looks like, and which ground decisions it leans on. Nothing here says EOQL works.

Tags on every claim: **Result** (measured, with where), **Prior art** (from memory or a cited note, not checked here), **Proposal** (stated, not tested), **Open** (unresolved or unchecked). "DECLARED" marks a reading somebody typed, not a finding. Cells are earned, never typed: no operator is given a meaning here as a finding. "SQL" and "KV" lines say why a table or a plain key-value view struggles; where SQL is easy on the existing projection, the line says so, because the first attempt (PREREG-A4 item 9) learned that a projection which already stores the fold hides the difference.

## 0. How to read this

**Source key** (all paths under `<workdir>/`).
- **RPL** = `ledgers/pharos-lazy/data/replay/<lane>.jsonl:<line>`, the 10,244-entry Premiere replay (read only). An entry is cited by file, 1-based line and the first 12 hex of its id. The 12-hex prefixes are unique in the replay and in the Ellison log [Result E-01].
- **TL** = `phasepost-labels/pharos-premiere/data/TOOLLOG.jsonl`, 1-based row. **BL** = `.../data/BUILD_LOG.md`, 1-based line. **OUT** = `phasepost-labels/pharos-premiere/out/` (T1 to T5 results and their reviews). **CP** = `phasepost-labels/pharos-premiere/CAPTURE-PLAN.md`.
- **EPH** = `ledgers/ellison-statements/pharos/<scout|extractor|verifier>.jsonl:<line>`, 764 entries. **LED** = `ledgers/ellison-statements/LEDGER.md`.
- **QA** = `ledgers/pharos-eoql/qa/questions.json` (question text and class only; `ground-truth.json` was not opened). **OLM** = `ledgers/pharos-eoql/prior/one-log-many-projections.txt`. **A3** = `PREREG-A3.md`. **SOM** = `SAME-OTHER-MAP.md`. **QSET** = `ledgers/pharos-intelligence/QSET-SPEC.md`.
- **E-nn** = a measurement made in this round by a read-only `python3 -I` scan, no script kept (the round writes documents only). Method for each is in Appendix A. Each E-nn has one reader (me) and no second reader yet [Open].

**Ground decisions** (OLM, the six): **IDENT** identity, **DEP** dependency, **TIME** time regime, **ABS** absence, **SUFF** sufficiency (the stop rule), **BASE** baseline (what difference is worth reporting).

**Flags**: **W** write; **GD** the answer depends on the ground; **2G** two grounds give two different answers (both are given); **PTR** asked by an agent that must receive pointers and no content; **SO** Same vs Other style (a verdict under a declared respect, refusal without one, SOM section 1).

**What a pointer reply is** (used by every PTR problem) [Proposal]: ids of entries, their file addresses or refs, counts, a `read N of M` figure, and named censored regions; no body text. The agent asks for an excerpt by id as a second step. The convention comes from CP section 9 (`here`, `ask`, `edges`, `reopen`, `verify`) and from the Rule two pipeline (`[name] window`, `[name] holo verify`).

## 1. Index

| ID | Problem | Flags | Grounds |
|---|---|---|---|
| RP-01 | How many clips were touched by two or more lanes | GD 2G | IDENT TIME BASE DEP |
| RP-02 | Which lane wrote this: who, session or permit | GD 2G SO | IDENT DEP ABS |
| RP-03 | Who created clip 000f4996 | GD 2G | IDENT DEP ABS |
| RP-04 | What did clip 000f4998 carry before the ducking pass | GD 2G | IDENT ABS DEP |
| RP-05 | What did the ducking write on 000f44a7 replace | GD | ABS DEP |
| RP-06 | Ten leases granted within 3 ms: who was first, who was active | GD 2G | TIME DEP BASE |
| RP-07 | What was in flight when Premiere hung at 18:00 | PTR GD | ABS DEP SUFF |
| RP-08 | Which permit requests starved | GD 2G | BASE IDENT |
| RP-09 | A request withdrawn, then granted: the retraction | W 2G | DEP TIME ABS |
| RP-10 | Writes made after their permit was released | 2G SO | IDENT TIME |
| RP-11 | Why was this request denied | GD | DEP TIME |
| RP-12 | Who touched title music 000f8314 | GD 2G | DEP IDENT |
| RP-13 | Did anyone change this since I last wrote | PTR GD | SUFF DEP TIME ABS |
| RP-14 | Which clips are at risk from replace_clip after grading | GD | ABS DEP |
| RP-15 | Record a lane's action with its before-state | W | DEP ABS TIME |
| RP-16 | Declare the attribution ground of the Ellison ledger | W | IDENT DEP ABS SUFF BASE |
| RP-17 | Adopt a clip-identity ground and re-ask | W 2G | IDENT TIME BASE |
| RP-18 | Record a stop, then revise it when a late entry arrives | W | SUFF TIME ABS |
| RP-19 | What did he say at p04 1207.8 to 1209.2, and on what basis | PTR | DEP ABS |
| RP-20 | Why is v01 1285 to 1287 not shown as his | PTR GD | DEP ABS IDENT |
| RP-21 | How many statements are attributed to him | GD 2G | BASE TIME DEP |
| RP-22 | May the cancer-vaccine soundbite be used as his words | GD 2G | SUFF ABS IDENT |
| RP-23 | What did he say between 100 and 200 s of the White House source | PTR GD | ABS |
| RP-24 | What does the extractor lane know when it decides | GD | TIME DEP ABS |
| RP-25 | Which of the 27 positions do the real logs occupy | GD | IDENT ABS |
| RP-26 | A control file that is a cut of a source: same or other | SO GD | IDENT |
| RP-27 | One recording, four files, one ledger source: same or other | SO GD | IDENT TIME |

Counts against the brief (floor in brackets): problems 27 [20]; writes 5 (RP-09, 15, 16, 17, 18) [4]; ground-dependent questions 20 (every GD row) [4]; two grounds two answers 12 (RP-01, 02, 03, 04, 06, 08, 09, 10, 12, 17, 21, 22, with RP-09 and RP-17 also writes) [3]; agent pointer questions 5 (RP-07, 13, 19, 20, 23) [3]; Same vs Other 4 (RP-02, 10, 26, 27) [2]. Section 3 repeats the count by ground.

---

## 2. Problems

### A. Who and what: identity in the Premiere log

### RP-01. How many clips were touched by two or more lanes
**Flags** GD 2G. **Situation.** After the White House swap damage the editor wants to size how many clips more than one lane has written, to know where cross-lane damage can sit.

**Data.** 3,292 writes carry a clip id and there are 2,049 distinct clip ids [Result OUT/review_T5.json]. One clip the prose names, `000f4989`: RPL `v2-sec-04.jsonl:98` d05ce57f16b2 (move_clip, 2026-11-06T22:34:30Z); RPL `editor-premiere-3.jsonl:937` to `941` 0a28d31ca5c4, 0c5f681ad884, 395c9df36a34, 08bee3ee8730, 949ce5cc2231 (2026-11-12T01:09:36Z to 01:09:39Z); RPL `oracle-v2-master.jsonl:5379` 63446d2b50aa (remove_from_timeline, lift, 03:11:28Z). The project item `000f4987` was imported at TL 6431 (RPL `oracle-v2-master.jsonl:5314` 7b510ea258e5, 2026-11-11T23:59:40Z), after the 11-06 move, so the 11-06 write touched an earlier clip that held the same id [Result OUT/review_T4.json, field 000f4987_import_row].

**Correct answer.** A number and the ground it was taken under [Result OUT/t4.json, C_gap_split, C_sequence_keyed, A_strict]:

| Identity ground | Multi-lane clips | Of |
|---|---|---|
| id is identity (args.clipId) | 258 | 1,864 ids |
| id split where the id is quiet more than 24 h | 253 | 1,875 |
| ... more than 12 h | 236 | 1,929 |
| ... more than 6 h | 214 | 2,051 |
| ... more than 3 h | 203 | 2,079 |
| ... more than 1 h | 188 | 2,214 |
| (sequence, id) is identity | 146 | 2,014 |

For `000f4989`: three lanes under id identity; under a 3 h or longer gap two incarnations (v2-sec-04 alone on 11-06; editor-premiere-3 plus oracle-v2-master on 11-11), under a 1 h gap three incarnations of one lane each [Result OUT/t4.json, C_gap_split]. The answer has to cite the ground, because no one value is right.

**SQL** [Prior art]: a GROUP BY on a clip-id column that already assumes id equals identity; each gap threshold is a different window-function query and nothing records which was meant. **KV** [Prior art]: key = id merges the incarnations by construction, so the question cannot be asked.
**Grounds.** IDENT (primary: when two writes are one clip), TIME (the gap rule), BASE (no earned value for the gap: the count moves from 188 to 253 with it), DEP (whether sequence is part of identity).

### RP-02. Which lane wrote this: who, session or permit
**Flags** GD 2G SO. **Situation.** A reviewer needs the writer of every Premiere write in order to say which lane touched which clip, and finds three candidate fields.

**Data.** TL has `who`, `permit`, `session` per row. Session `443896f2-d557-4a9d-b9d0-b763858bcecf` spans TL 11 to 2403 and carries nine different `who` values over 139 rows (v2-sec-10 85, v2-sec-03 17, v2-sec-02 12, v2-sec-05 12, v2-sec-04 6, oracle-v2-master 3, v2-sec-08 2, v2-sec-09 1, null 1); 16 of the 23 sessions carry more than one `who` value [Result E-02]. 15 of 17 lane names span more than one session [Result OUT/review_T5.json]. Two rows have `who` null and `permit` null: TL 23 (RPL `unattributed.jsonl:1` cd5be4b84855, rename_project_item `000f430f`, 2026-11-06T20:42:04Z, session 443896f2), which repeats the tool and args of TL 11 exactly (RPL `oracle-v2-master.jsonl:16` ca2d5b713341, by oracle-v2-master under permit `20261106-144112536__oracle-v2-master`, same session, 40 s earlier) [Result E-02], and TL 5156 (RPL `unattributed.jsonl:5` bcb675801b79, execute_extendscript, 2026-11-10T22:10:58.622Z, session b810d6b6). TL `who` is only the first active permit and is wrong on the rows that had more than one [Result CP section 8, from BOARD/state/pre.jsonl, not re-checked here: BOARD is off limits].

**Correct answer.** For TL 5156: by `who` no lane; by session b810d6b6 the session holds 2,147 oracle-v2-master rows, 7 audio-mix, 7 editor-premiere-3, 1 null [Result E-02]; the lease of permit `20261110-155554179__oracle-v2-master` expired at 22:10:57.996Z and the row is 0.626 s later [Result E-08], which explains the null permit and does not name a writer. The call exports PNG frames (read only by its text) [Result RPL `unattributed.jsonl:5`]. For TL 23: no lane by `who` and no permit; an identical call by oracle-v2-master in the same session 40 s earlier, so it may be a repeat of that write or a second write [Open: the log cannot say which]. Cross-lane counting: 539 of 3,292 clip writes follow a write by a different lane when lane = `who`, 1,105 when lane = permit [Result OUT/review_T5.json]. Same vs Other, verdicts DECLARED [Proposal]: is TL 23 the same write as TL 11? Respect "same intended action" (identical tool and args): Same; respect "separate logged call": Other; respect "who held authority": Gap, because the row has no permit. Is the writer of TL 5156 the same lane as oracle-v2-master? Respect "who may have written this" (shared session): Same, weakly, since a session carries several lanes; respect "held a lease": Other (the lease had lapsed). Without a named respect the answer is Gap and a refusal.

**SQL** [Prior art]: trivial once the lane column is chosen; the choice is the whole problem (539 versus 1,105). **KV** [Prior art]: key = lane name hides the 16 multi-lane sessions and the null rows.
**Grounds.** IDENT (what a writer is), DEP (joining rows to the guard log by key, CP section 8), ABS (null who: nobody, or unknown).

### RP-03. Who created clip 000f4996
**Flags** GD 2G. **Situation.** The editor asks which lane created the clip now on V3 at 80 s of the film master (sequence `fe6d6e93-83a1-45cc-b151-59719dacbaef`).

**Data.** The first entries at address `000f4996` are three add_audio_keyframes writes on 2026-11-06: RPL `v2-sec-10.jsonl:33` 16e22d64ad64 (21:46:17Z), `v2-sec-07.jsonl:23` 6cfa1a2a4daa (22:33:51Z), `v2-sec-04.jsonl:142` b43ef6089890 (23:14:06Z). The 11-12 entries start 124 hours later: RPL `oracle-v2-master.jsonl:5380` b6382f7c25f2 add_to_timeline (projectItemId `000f4987`, trackIndex 2, time 80, sourceInPoint 22.208333, sourceOutPoint 26.583333, 03:11:32.173Z), then `:5381` a9ce356581f8 apply_effect on `000f4996` (03:11:39.407Z) [Result E-03]. BL:1359 says the clip was re-placed from `000f4987` with in 22.208333 out 26.583333 as `000f4996`; the args match it. No log entry carries a created id: 0 of 1,988 creating calls [Result OUT/t5.txt section B].

**Correct answer.** Three answers, each with its ground:
- First entry at the address (the QA H10 rule): v2-sec-10, `16e22d64ad64`. This is a different clip that held the id 124 h earlier [Result E-03].
- First entry of the 11-12 incarnation (gap split): oracle-v2-master, `a9ce356581f8` (apply_effect).
- Creator inferred from the creating call whose args match the later prose: oracle-v2-master, `b6382f7c25f2`, corroborated by BL:1359 [Result by reading; the inference rule is a Proposal].

**SQL** [Prior art]: first-row-by-address is one MIN; incarnation and creation inference are not queries over the stored columns. **KV** [Prior art]: the key `000f4996` returns the last write, not a creator.
**Grounds.** IDENT (incarnation), DEP (which call counts as the creating one), ABS (creation is unrecorded, so a creator is an inference, never a fact).

### RP-04. What did clip 000f4998 carry before the ducking pass
**Flags** GD 2G. **Situation.** The audio lane needs the volume state of `000f4998` just before it ducks the music at 2026-11-12T03:25Z.

**Data.** 2026-11-06: RPL `v2-sec-10.jsonl:35` 514046f00df1 (21:46:19Z, keys 0 dB at 23.0883, -40 at 23.2083), `v2-sec-07.jsonl:25` 96ce78ec0833 (22:33:52Z), `v2-sec-04.jsonl:144` 3f5d8839ca9d (23:14:07Z, keys 0, 0, -40). 2026-11-12: RPL `oracle-v2-master.jsonl:5388` 3ca8a8960516 set_effect_property Volume Level 0.33919912576675 (03:12:25Z) [Result E-03]. BL:1359: "refilled with 000f4998 (in 32.4583-36.8333, Level 0.339)". BL:1363: "44a4/44a5/4997/4998 no keyframes (static 0.1778 / 0.339 for 4997,4998)". The same pattern holds for `000f4997` (RPL `v2-sec-10.jsonl:34` e1b3f353df56, `v2-sec-07.jsonl:24` ea608be72557, `v2-sec-04.jsonl:143` 746cf6863e04).

**Correct answer.** Under id identity the held curve is the 3-key curve written by v2-sec-04 on 11-06 (add_audio_keyframes replaces the whole set, CLAUDE.md audio rules [Prior art]), with a later static level write on a different property, and no entry says the keys were removed. Under incarnation identity the clip carried a static level 0.339 and no keys, which is what BL:1363 says [Result by reading]. The log alone cannot decide; the only statement of "no keyframes" is prose, so a correct answer names BL:1363 as that source and names it as prose.

**SQL** [Prior art]: last row per (id, property) returns the stale curve with confidence. **KV** [Prior art]: the key `000f4998` has one value and no way to say it is two clips.
**Grounds.** IDENT, ABS (no keys: unknown, or absent), DEP (a placement resets what an id holds).

### RP-05. What did the ducking write on 000f44a7 replace
**Flags** GD. **Situation.** The user judges the ducking too heavy and wants the music restored to what it was.

**Data.** RPL `oracle-v2-master.jsonl:5424` 8f2acdafbe66 (add_audio_keyframes, `000f44a7`, 21 keyframes in dB, 2026-11-12T03:25:09.626Z), `:5425` c1c189eb4da4 (a second write 10 s later), `:5423` 9a949525bbd3 (the same on `000f44a6`). The original curve exists only in prose, BL:1363: `44a7 [41.916667:0.00177828, 42.375:0.129593, 47.186957:0.129593, 48.702512:0.011475, 81.887723:0, 83.738426:0.135265]` in clip-source seconds and linear values, where 0.1778 is 0 dB. The call takes dB with a 15 dB calibration offset (CLAUDE.md audio rules [Prior art]). Before-state is recorded in 0 of 1,887 destructive calls; for add_audio_keyframes the prose states a prior on 12 hand-read lines and up to 85 of 388 calls aligned by id [Result OUT/t5.txt, OUT/review_T5.json].

**Correct answer.** "Not recorded in the log" with the pointer BL:1363 and its six keys, the unit difference stated (linear versus dB with offset), and no restored curve invented. The earlier write on the same tool for the same clip would give a prior only when no move intervened; 156 of 388 add_audio_keyframes calls have an earlier same-tool write on the same clip id, and BL:584 says move_clip_to_track drops volume keyframes [Result OUT/t5.txt; BL:584].

**SQL** [Prior art]: a self-join to the previous row, which is wrong whenever a move dropped the keys; the units live in a convention, not a column. **KV** [Prior art]: only the new curve is stored.
**Grounds.** ABS (before-state unrecorded versus none), DEP (which intervening writes reset the keys), plus a unit convention that has no home in the log [Open].

### B. Permits, time, absence

### RP-06. Ten leases granted within 3 ms: who was first, who was active
**Flags** GD 2G. **Situation.** A scheduler audit asks which lane was granted first at the 2026-11-06 21:20:03Z gate and how many lanes held a lease at once.

**Data.** After two denials (RPL `v2-sec-00.jsonl:9` 5da0383713a3 at .607, `v2-sec-07.jsonl:9` 5530c77e6b96 at .609) ten permit-granted entries land between 21:20:03.611Z and 21:20:03.613Z: `v2-sec-01.jsonl:2` 8ff2a0570ac0, `v2-sec-03.jsonl:10` 49ce2de43643, `v2-sec-04.jsonl:12` 7d3289158bd3, `v2-sec-05.jsonl:2` bbee60cc4e38, `v2-sec-06.jsonl:2` d844e98fb1c3, `v2-sec-08.jsonl:4` 485d0cd93528, `v2-sec-09.jsonl:4` 9da528b9af81, `v2-sec-10.jsonl:7` 7b637fd58a8b, `v2-sec-11.jsonl:2` 961127cec5ce, `v2-sec-12.jsonl:6` d583fddbb47b [Result E-06]. In the replay each entry's `seen` points at the previous grant in replay order (time, then file name); the importer states that `seen` is the replay order and not what any lane perceived [Result RPL `pharos-import.jsonl:1`, body.assumed]. In the next 20 minutes 4 of the 10 lanes wrote (v2-sec-04 67 writes, v2-sec-09 14, v2-sec-12 13, v2-sec-10 11) with 3 lane switches in 104 writes [Result E-06]. Three of the 28 waits over 10 minutes ended at this gate [Result E-06].

**Correct answer.** By clock at millisecond resolution: two grants tie at .611 (v2-sec-01, v2-sec-03), so no first. By the replay's `seen` chain: v2-sec-01 is first, which is an artifact of file order. By concurrency under a declared tie window: ten concurrent heads, the answer is "all ten, unordered" (the OLM default is both). Active at once: 10 by lease validity, 1 at a time by who was writing [Result E-06]. The ground picks which.

**SQL** [Prior art]: ORDER BY timestamp returns a first and hides the tie; "active" needs a lease-interval join. **KV** [Prior art]: no order at all.
**Grounds.** TIME (clock, causal chain, tie window), DEP (what counts as an edge between two grants), BASE (how close is simultaneous: no earned value).

### RP-07. What was in flight when Premiere hung at 18:00
**Flags** PTR GD. **Situation.** A new session starts after the 2026-11-11 crash and asks which writes may have been in flight, so it does not repeat or undo them.

**Data.** The log holds no write between RPL `oracle-v2-master.jsonl:5315` 4b863adaf274 (save_project, 23:59:58.649Z) and `:5325` 086ca3d5a9d2 (remove_from_timeline `000f498a`, 2026-11-12T01:06:55.013Z), 67 minutes [Result E-05]. Inside that gap permit `20261111-175958946__oracle-v2-master` was granted at 23:59:59.616Z (`:5318` dcf000fecf68, raise `:5317` 00c959e54206) and released at 00:08:35.828Z (`:5319` fa5adfb04a0b), with no entry between the grant and the release [Result E-05]. BL:1354 says a replace_clip on V3 `000f4438` ran at about 18:00 and hung for about 10 minutes. `000f4438` has 0 logged writes [Result OUT/review_T4.json]. CP section 8 reports 249 allowed calls (3.7%) never reached the log, among them the 18:00:03 replace_clip [Result CP section 8, from pre.jsonl, not re-checked here].

**Correct answer** (a pointer reply) [Proposal]: the raise, grant and release ids above with the previous and next write ids; "0 writes recorded inside an 8 min 36 s lease"; the censor line "calls may have been made that this log does not hold" (a lease was open, writes occurred by the prose, none are logged); BL:1354 as a prose pointer. The correct verdict is unknown, never none. The agent receives no body text.

**SQL** [Prior art]: `SELECT ... WHERE permit = P` returns the empty set, which reads as "nothing happened". **KV** [Prior art]: a missing key is indistinguishable from a quiet one.
**Grounds.** ABS (no record is not no event), DEP (the permit's lease is the only link), SUFF (how far before and after to look).

### RP-08. Which permit requests starved
**Flags** GD 2G. **Situation.** The coordinator wants the lanes that waited too long for a lease, mechanically, without being told the case.

**Data.** 1,227 raises, 1,132 grants, 95 denials, 1,087 releases [Result OUT/t3.txt]. Raise-to-grant waits over a threshold: more than 600 s 28, more than 300 s 74, more than 240 s 88, more than 60 s 182; the longest is 21,671 s (6.02 h), RPL `v2-sec-03.jsonl:744` 979fee77a21f for permit `20261107-114458514__v2-sec-03` [Result OUT/t3.txt, OUT/review_T3.json; recomputed E-14]. 10 of the 28 are v2-sec-03 [Result E-14]. The 2026-11-11 citizens request, permit `20261111-230838172__oracle-v2-master`: raised RPL `oracle-v2-master.jsonl:5451` 9b02506ce583 (05:08:38.172Z), granted `:5455` 7068cb995a0c (05:12:49.343Z), a wait of 251.2 s, rank 85 of 1,132 [Result OUT/review_T3.json]. It was blocked by editor-premiere-3's permit `20261111-230349366__editor-premiere-3` (raise `editor-premiere-3.jsonl:1000` ccb5622d97c7, grant `:1001` e0f8f31aeb0f, release `:1052` 051a180cdb69 at 05:12:48.363Z, 0.98 s before the grant) [Result E-14].

**Correct answer.** A list whose length depends on the baseline: 28 at 600 s (the citizens case is not on it), 88 at 240 s (it is). Per raise or per request name: 255 request names, 15 never granted, 12 whose first raise to first grant exceeds 600 s [Result OUT/review_T3.json]. Whether a re-raise is the same request matters: 75 denied raises have a later grant of the same request name [Result OUT/review_T3.json; same count in E-14], and 76 have a later raise of it, granted or not [Result E-14]. One example: request `20261106-1500__v2-sec-04__sec04-no-blanks-no-clipped-audio.md` was raised with plan.json (RPL `v2-sec-04.jsonl:5` a081ff6595db), released after 9 s, raised again 0.19 s later with plan_a.json (`:7` 27760a3e6b83), and the old raise was denied (`:8` d330cb141600) within 1 ms of the new grant (`:9` 7270a3bd73be) [Result E-18]; whether that is one request or two is a Same vs Other question for the wait count. The answer states the baseline and the unit.

**SQL** [Prior art]: a self-join with a literal threshold in the query; no record of why 600 or 240. **KV** [Prior art]: cannot join raise to grant.
**Grounds.** BASE (primary: the threshold has no earned value; the 10-minute bar was fixed in PREREG before the data), IDENT (raise versus request name).

### RP-09. A request withdrawn, then granted: the retraction
**Flags** W 2G. **Situation.** A lane withdraws a request it no longer wants; the coordinator grants it anyway. The lane must say so in the log and a later reader must know whether a lease existed.

**Data.** RPL `oracle-v2-master.jsonl:5451` 9b02506ce583 (raise, 05:08:38.172Z), `:5452` 054f5a56a4fb (permit-released, 05:11:00.254Z, `of` the raise), `:5455` 7068cb995a0c (permit-granted, 05:12:49.343Z, expires 05:15:49Z, `of` the raise). No TOOLLOG row carries this permit [Result E-14]. 16 permits have a release stamped before their own grant and 14 have a release with no grant [Result OUT/review_T3.json]. The replay and the Ellison log contain no entry of kind retract [Result E-16]; the QA README says the same for the real logs.

**The write** [Proposal]: the lane's withdrawal is an entry that targets the raise `9b02506ce583`, by the lane's byline, with a reason. The replay has the lane's release in that place.

**Correct answer after the write.** Is the permit in flight at 05:13:00Z? Under "a retraction voids the entries that depend on the retracted one": no, the grant at `:5455` is void. Under "the grant event stands": yes until its expiry at 05:15:49Z. The QA convention (C05) treats an end positioned before its grant as still ending it, which gives no. The answer cites which ground it used, and lists the dependents of the retracted entry by id (the grant `7068cb995a0c`).

**SQL** [Prior art]: a row-level soft delete plus a NOT EXISTS; dependents of a retracted row are not followed unless the schema says so. **KV** [Prior art]: a delete loses the fact that the withdrawal happened and the grant arrived after it.
**Grounds.** DEP (whether a retraction reaches dependents), TIME (release before grant), ABS (retracted is not absent).

### RP-10. Writes made after their permit was released
**Flags** 2G SO. **Situation.** An auditor asks for every write that happened after its permit had been released.

**Data.** Permit `20261110-155554179__oracle-v2-master`: raise RPL `oracle-v2-master.jsonl:4186` 8acb4de8e423, grant `:4188` dda6de5af1ed (21:55:57.996Z, expires 22:10:57.996Z), reconcile `:4221` a449e2a99069 (22:12:20.098Z). A release entry exists at RPL `unattributed.jsonl:4` 276e46ffefd1 (21:58:30.707Z) whose id is `20261110-155554179`, with no `__oracle-v2-master` suffix; the flag file is `flags/released/20261110-155554179.json`; the suffixed permit has no release file, only a reconcile file [Result E-08]. 31 TL rows carry the suffixed permit (TL 5125 to 5155); 26 of them (TL 5130 to 5155, 15:59:10 to 16:10:33 local) come after the release time [Result E-08].

**Correct answer.** If the two permit ids are Other (strict id equality) the answer is 0 writes after release for this permit; if they are Same (the timestamp prefix names one lease) the answer is 26 [Result E-08]. Over all permits under strict equality the count is 0 [Result E-08]. Same vs Other verdict (DECLARED) [Proposal]: respect "names one lease": Same, by identical timestamp prefix and the same host lane's activity; respect "identical id string": Other; no respect named: Gap.

**SQL** [Prior art]: an equi-join on permit id returns 0 and the data looks clean. **KV** [Prior art]: two keys, no relation.
**Grounds.** IDENT (primary), TIME (release versus write), plus how a reconcile closes a lease (QA H05 and H13 use release or reconcile; T4 reports 51 versus 4 clips depending on it [Result OUT/review_T4.json]).

### RP-11. Why was this request denied
**Flags** GD. **Situation.** A lane asks why its request at 2026-11-06T20:51Z was denied and how long it was really blocked.

**Data.** RPL `v2-sec-04.jsonl:1` 463062e159a5 (raise, 20:51:37.365Z), `:2` f388be91aa75 (denied, 20:51:38.415Z, `of` the raise). Its `body.reasons` has two lines; the second names "permit 20261106-145032704__oracle-v2-master" as the lock holder "until 14:56". That permit: raise RPL `oracle-v2-master.jsonl:29` 5785439101b7, grant `:30` 10c4b8d01f5e (20:50:33.046Z), release `:32` 603e83fdaafe (20:51:56.961Z, 18.5 s after the denial, 4 minutes before the stated expiry) [Result E-18].

**Correct answer** (pointers) [Proposal]: the denial id; reason 2 (contract) and reason 5 (lock) as the two causes; the lock holder's grant and release ids; the observation that the lock ended 18.5 s after the denial while reason 2 would not have lapsed with it. The denial's only structured link is to its own raise, so the lock holder is reachable only through an id inside a text field.

**SQL** [Prior art]: needs a regex over a text column to find the holder. **KV** [Prior art]: the reason text is an opaque value.
**Grounds.** DEP (whether an id named in a body text is an edge), TIME (stated expiry versus actual release).

### RP-12. Who touched title music 000f8314
**Flags** GD 2G. **Situation.** The music lane asks whether another lane changed title clip `000f8314` between its own two passes.

**Data.** 16 entries name it as args.clipId, all by audio-mix (RPL `audio-mix.jsonl:292` to `:296`, `:412` to `:414`, `:528`, `:546`, `:547`, `:550`, `:551`, `:556`, `:605`, `:623`); 1 entry names it only inside script text: RPL `oracle-v2-master.jsonl:3837` d2742b71b263 (execute_extendscript, 2026-11-10T16:20:57Z), a script that lists the components of five named clips and, by its text, writes nothing [Result E-15]. BL:557 and BL:558 record a ripple that moved 736 clips and say the title music "straddle the cut and were left for the music lane"; BL:652 says the clip was "re-fit by another lane to 132.29-160.71". 926 of the 1,054 clip ids that appear in script text never appear in structured args [Result OUT/t5.txt]; 709 scripts exist, 499 with a mutator token and 210 without by the author's regex, 194 without by the reviewer's [Result OUT/t5.txt, OUT/review_T5.json].

**Correct answer.** Three answers: structured args only: audio-mix alone; any id in text: audio-mix plus oracle-v2-master; ids in text only when the script has a mutator token: audio-mix alone, with the heuristic's edge named. None of the three finds the re-fit that BL:652 reports [Open: the log may not hold it]. The answer lists the ground and the unresolved prose.

**SQL** [Prior art]: a LIKE over a script column, with false hits for reads. **KV** [Prior art]: only top-level args are keys.
**Grounds.** DEP (primary: what makes a script an entry about a clip), IDENT.

### RP-13. Did anyone change this since I last wrote
**Flags** PTR GD. **Situation.** editor-premiere-3 is about to write at the V3 head near 80 s of sequence `fe6d6e93-83a1-45cc-b151-59719dacbaef` at 2026-11-12T03:14:31Z. Its last write on the clip that held that slot, `000f4989`, was RPL `editor-premiere-3.jsonl:941` 949ce5cc2231 (01:09:39.107Z). The agent must receive pointers, not the log.

**Data.** Between the two times 44 writes exist anywhere; 25 of them are on the film sequence (by args.sequenceId or by the permit's sequence), 16 by editor-premiere-3 and 9 by oracle-v2-master; exactly 1 names `000f4989`: `oracle-v2-master.jsonl:5379` 63446d2b50aa (the lift) [Result E-07]. The same lane re-placed the slot with `:5380` b6382f7c25f2 and graded it with `:5381` to `:5383` (a9ce356581f8, b3c24cdce620, 2de269bb3c6e) on a new clip `000f4996` whose id appears in no earlier entry [Result E-07, E-03]. The replay's `seen` is replay order and says nothing about what the lane read; 0 reads are logged [Result OUT/t5.txt section D]. The cone of `000f4989` is 7 entries, 13 by `of`-closure, 12,502 bytes of 10,350,899 (0.12%) [Result E-04].

**Correct answer** (pointer reply) [Proposal]: by clip id: 1 entry after the frontier, `63446d2b50aa`; by sequence: 25 entries after the frontier, 9 by another lane, listed by id and counts; by track and time: not computable, because only 14% of writes carry sequence, track and time (CP section 10) and the new clip's id is unrecorded; censored: "created ids unknown". A correct reply says `read 13 of 10,244`, never "nothing changed", and returns no bodies.

**SQL** [Prior art]: easy if the region is a clip id (WHERE clip = X AND t > T), silently incomplete for a slot. **KV** [Prior art]: the key is the id, so the replacement clip is a different key.
**Grounds.** SUFF (what the frontier is: own last write, own last read, or the slot), DEP (region by id, sequence, or track and time), TIME (frontier ordering), ABS (unrecorded creations).

### RP-14. Which clips are at risk from replace_clip after grading
**Flags** GD. **Situation.** The project rule says never replace_clip or copy_effects on a graded clip (CLAUDE.md [Prior art]); a lane wants the clips where that has already happened.

**Data.** 59 replace_clip calls, 1 copy_effects_between_clips (RPL `editor-premiere-3.jsonl:791` b7cac4fbc37f, sourceClipId `000f864f`, targetClipId `000f869d`); 38 clips have an apply_effect of Lumetri Color; 0 of the 59 replace_clip calls target a clip with an earlier logged Lumetri apply by clipId [Result E-13]. The damaging replace_clip on `000f4438` is not in the log (RP-07), and BL:1359 states the corrupt Lumetri sat on `000f4989`.

**Correct answer.** "None found in the log, by clip id. The one known incident is not in the log." The answer is censored, not empty; replace_clip creates a new clip id that no entry records, so any later grade lands on an id the query cannot link back.

**SQL** [Prior art]: a join returning 0 rows. **KV** [Prior art]: no link from the new clip to the old.
**Grounds.** ABS, DEP.

### C. Writes

### RP-15. Record a lane's action with its before-state
**Flags** W. **Situation.** The ducking write at RP-05 is made again, this time so that "what did it replace" has an answer later.

**Data.** The existing entry RPL `oracle-v2-master.jsonl:5424` 8f2acdafbe66 has `addr`, `of` (the permit grant 8f865ef34e59), `seen` (the replay predecessor), `body.args.keyframes` (21 keys) and no before-state, no created ids, no outcome [Result E-04 pattern; RPL `editor-premiere-3.jsonl:937` shows the same fields]. The pre-state is in BL:1363 as six linear-scale keys.

**The write** [Proposal]: an entry with the lane's byline, the call and args, `of` = the permit grant, `seen` = the frontier of the lane's last ask (not the replay predecessor), a before-state value with a pointer to where it came from or the explicit word "not read", the ids it created or "none", and the outcome.

**Correct answer after the write.** RP-05 returns the six keys with their source rather than "not recorded"; RP-13 can answer "since I looked" from `seen`. A write that omits the before-state field is refused or marked "not read", never stored as empty. Writing a cell label is allowed only as a DECLARED reading (the replay maps add_audio_keyframes to `DEF·Figure` by declaration [Result OUT/report.json tool_to_cell]).

**SQL** [Prior art]: an INSERT with nullable columns, so absent and unread collapse into NULL. **KV** [Prior art]: overwrite loses the prior.
**Grounds.** DEP (`of`, `seen`), ABS ("not read" versus none), TIME (frontier at write).

### RP-16. Declare the attribution ground of the Ellison ledger
**Flags** W. **Situation.** The rule that a name cue must come before a run lives in `revision.json` and in the build script, applied by name to four statements. It should be an event with a byline that a reader can adopt or reject.

**Data.** The four withheld by this rule only, each passed by the verifier: V02-02 (EPH `extractor.jsonl:84` c125b41d56a7, withheld `verifier.jsonl:237` 4321b4f7651d), P03-04 (`extractor.jsonl:169` c023259f6c15, `verifier.jsonl:249` 7640f175315d), P04 S01 (`extractor.jsonl:171` 1d32a342155a, `verifier.jsonl:250` 0fb14fe7dc96), P04 S05 (`extractor.jsonl:175` 2d13e2045972, `verifier.jsonl:251` c48faee3dc74). For three of the four the withhold basis says "ruled by the experimenter, reversible"; the entries are filed under the byline `verifier`, and the frame says gate decisions are filed under the role that applied them [Result EPH `verifier.jsonl:250`; frame entries in `scout.jsonl` and `extractor.jsonl`]. The attributed entries record that "no script tests every other statement for this rule" [Result EPH `extractor.jsonl:448`, field basis.gate].

**The write** [Proposal]: one entry by the experimenter's byline that states the six decisions in the words of the ledger: IDENT a speaker is the person a cue names; DEP the cue edges followed are a leading introduction, a hand-over, a single-speaker run after one; a trailing cue is not followed; ABS a run without a leading cue is "not established", distinct from "not his"; SUFF a T2 leading cue, or a single-speaker run after one with no speaker-change cue; T3 provenance alone is never sufficient; BASE none stated [Open: the ledger states no baseline]. With a testable claim: the four statements above are withheld by this rule alone.

**Correct answer after the write.** Every gate decision cites the ground entry id; a query "who withheld this and under what rule" returns the experimenter's entry, not the verifier's. The claim is checkable: 4 of the 49 withheld are withheld by this rule alone [Result E-09].

**SQL** [Prior art]: a rule lives in application code or a CHECK constraint, not as an attributed row. **KV** [Prior art]: config value without a byline or history.
**Grounds.** All six: IDENT, DEP, ABS, SUFF and BASE are stated; TIME is the "before" in "cue before run".

### RP-17. Adopt a clip-identity ground and re-ask
**Flags** W 2G. **Situation.** The T4 reviewer decides that a clip id quiet for 12 h starts a new clip and wants RP-01 answered under that choice, with the choice recorded as theirs.

**Data.** The 12 h split is one of the sensitivity runs in OUT/t4.json (236 multi-lane of 1,929 keys); the id-only count is 258 of 1,864 [Result OUT/t4.json C_gap_split, A_strict]. The ground's author byline is the T4 script author; the files name no session [Open].

**The write** [Proposal]: a ground entry (identity: an id plus an incarnation counter that increments at a quiet gap of 12 h) by its author, and a separate adoption entry by the reader (the reviewer) naming that ground at that version.

**Correct answer after the writes.** RP-01 returns 236 of 1,929 citing the adopted ground, and 258 of 1,864 for any reader who adopted nothing, in the same log without rewriting it. A cached fold is keyed by head set plus ground id (OLM) [Prior art: the note's claim].

**SQL** [Prior art]: a new view per ground. **KV** [Prior art]: re-key the whole store.
**Grounds.** IDENT, TIME (the gap), BASE (12 h is not earned [Open]).

### RP-18. Record a stop, then revise it when a late entry arrives
**Flags** W. **Situation.** A fold answering "what is the state of `000f4989`" walks back from its heads and stops at its first write; later the unlogged 18:00 replace_clip is backfilled and the stop proves wrong.

**Data.** The cone of `000f4989`: 7 entries in 3 permits, 12,502 bytes [Result E-04]. Its second Lumetri came from a replace_clip on `000f4438` (BL:1354, BL:1359) that is absent from the log [Result OUT/review_T4.json]. CP section 8 says 249 allowed writes (3.7%) never reached the log, from a guard log outside the data [Result CP section 8, not re-checked]. If those were backfilled they would arrive with timestamps in the past.

**The write** [Proposal]: the answer is stored with its stop as an entry (the frontier ids, the ground, the baseline that made the rest negligible). A later entry that contradicts it is an ordinary assertion, and the memoized fold is no longer served.

**Correct answer.** Before the backfill the answer reads "stopped at 5 entries; nothing earlier recorded". After it, a query for the same head returns the new answer and cites the contradicting entry, and the first answer remains readable as of its cut. Test of per-branch sufficiency [Prior art: the note's open problem]: a stop must not occur before a declared sufficient root.

**SQL** [Prior art]: a materialized view recomputed or left stale. **KV** [Prior art]: the cached value is overwritten.
**Grounds.** SUFF (primary), TIME (late arrival), ABS (a stop is "no more found", not "no more exists").

### D. The Ellison statements ledger

### RP-19. What did he say at p04 1207.8 to 1209.2, and on what basis
**Flags** PTR. **Situation.** A film agent wants the statement at `p04-qwnvn9mcox4-oracle-health-summit-fireside-ellison-bell-33b5a3bb#1207.8-1209.2` and the basis for calling it his, for use in a cut. It must not read the transcript or the ledger.

**Data.** Utterance EPH `extractor.jsonl:176` 1f39a696e57e (label S06a, text "[20:07.8] - We all hate passwords.", t 1207.8 to 1209.2); attributed `extractor.jsonl:448` e07d1a17d4c4 (tier T2, with_caveat true, caveat "alternation on dash markers alone"); verified `verifier.jsonl:176` a2325eaddbf0 (result pass, `[name] holo verify` problems empty). Snap: in 1207.585 is safe; out has no safe point [Result EPH `extractor.jsonl:176`].

**Correct answer** (pointer reply) [Proposal]: the three entry ids; tier T2 with caveat true; the ref `.fold/contents/p04-qwnvn9mcox4-oracle-health-summit-fireside-ellison-bell-33b5a3bb/plate.utf8#16510-16534`; the recorded command `[name] window p04-qwnvn9mcox4-oracle-health-summit-fireside-ellison-bell-33b5a3bb 1207.85 1209.15` (from the utterance's `window_cmd`) and `[name] holo verify` for the proof; the cut-safety line (in safe, out not). The agent gets words only when it follows a pointer. This matches QA H01 and QSET family EQ-BASIS [Proposal: mapping by me, QSET questions not read].

**SQL** [Prior art]: three joins across tables, easy on the pharos-sqlite projection where the chain is stored [Result QA README: the projection's tables equal the fold on both real logs]; the difficulty is not the join but returning pointers rather than rows. **KV** [Prior art]: the utterance key returns the text, which is the content the agent must not take.
**Grounds.** DEP (utterance, gate and verification are separate entries linked by `of`), ABS (a safe out point is missing, said, not guessed).

### RP-20. Why is v01 1285 to 1287 not shown as his
**Flags** PTR GD. **Situation.** The statement `v01-o501x3ei10y-oracle-financial-analyst-meeting-qa-5503eab4#1285-1287` ("It's really not one winner.") is not in the attributed list; the film wants to know why and whether it could be.

**Data.** Utterance EPH `extractor.jsonl:139` 819bf3b4672a (label V01-54); verified `verifier.jsonl:139` 0a3524d98ec7 (result fail-attribution); withheld `verifier.jsonl:238` 2034cecef6b7 (class fail-attribution, claimed tier T2 run R2). The verifier reads the cue 'Hey, Larry Jackson, AIDER at KeyBank Capital Markets.' as a different Larry introducing himself and notes the only cue naming him is after the run ('Thanks, Larry.', 25:06) [Result EPH `verifier.jsonl:238`]. The ledger notes the 10 withheld lines of R2 and R7 "may be false negatives" if the recogniser fused 'Hey, Larry.' with the analyst's name [Result revision.json ne_notes, LED].

**Correct answer** (pointer reply) [Proposal]: the withholding entry id and its class; the three ids of the chain; "withheld on the verifier's reading of one cue; the reading is disputed in the ledger's own note"; counts: not attributed, not shown as not his; the two pointers `[name] window` for 20:36 and for 25:06. A ground that accepts a trailing cue finds one for this run ('Thanks, Larry.', 25:06), while the verifier's other reason (the leading cue names a different Larry) stays a dispute about one reading; the other reading is a different ground, not an error [Open: how many of the 44 verifier failures flip is not computed].

**SQL** [Prior art]: easy to list the withholding; the distinction between a withhold by rule and a withhold by reading is a column the schema would need. **KV** [Prior art]: one status string.
**Grounds.** DEP, ABS (not attributed versus not his versus not established), IDENT (which Larry).

### RP-21. How many statements are attributed to him
**Flags** GD 2G. **Situation.** A script writer asks how many statements the ledger attributes to Ellison and how much speaking time that is.

**Data.** Current ledger: 202 extracted, 153 attributed (133 plus 20 with caveat), 49 not established, covering about 2,165 s of 24,594.5 s (8.8%) [Result LED counts and coverage]. Before patch 1 the ledger held 156 attributed and 46 not established [Result `ledgers/ellison-statements/out/pre_patch/LEDGER.md`]. The 4 statements in RP-16 are withheld by the trailing-cue rule alone [Result EPH `verifier.jsonl:237, 249, 250, 251`].

**Correct answer.** 153 under the current rule; 156 as of revision 1 before patch 1; 157 under a ground that drops the trailing-cue rule and keeps every other gate (153 plus the 4) [Result E-09]. Seconds under the third ground: about 2,165 plus 644.6 = 2,809.6, 11.4% of the source time (the four runs span 132.6, 49.9, 0.8 and 461.3 s as addressed; an upper bound as the ledger's own seconds are) [Result E-19]. The 44 verifier failures are not recounted under the third ground [Open].

**SQL** [Prior art]: COUNT(*) over a status column that already folded the rule; a different rule is a different table. **KV** [Prior art]: the status is a final string with no "as of".
**Grounds.** BASE (what evidence is enough), TIME (the ground as it stood at revision 1 versus patch 1: ground evolution as ordinary history, OLM), DEP (which cues count).

### RP-22. May the cancer-vaccine soundbite be used as his words
**Flags** GD 2G. **Situation.** The operator's hand note marks V03 641.0 to 668.5 as "Ellison explains cancer vaccine" (soundbite 641.0 to 649.8). The film wants to put it on screen as his.

**Data.** Source EPH `scout.jsonl:14` 7778d1dd7247 (`v03-x5gmidnyeds-whitehouse-stargate-remarks-73e4886b`, 2,784.7 s); its provenance quotes the README hand note. Covering run EPH `extractor.jsonl:311` d7b4ddf7c52c (address `#622.5-726.9`, class unattributed-or-unproven, "CANDIDATE, NOT PROMOTED"): content and the hand note point to him; nothing before the run names him; a retrospective cue exists at [12:24.4] ("I was shocked with Larry because I don't even think Larry does this stuff.") [Result EPH `extractor.jsonl:311`]. No utterance entry exists in this run [Result E-10].

**Correct answer.** Under the leading-cue ground (RP-16): not established. Under a ground that accepts a trailing or retrospective cue: a candidate that still needs extraction first, because no statement was extracted from the run. Under a ground that accepts the operator's note as evidence: a candidate; the ledger's own tier rule says provenance alone is never enough (T3). No ground makes "attributed" a present fact, because no utterance entry exists. The reply is pointer-shaped: the run entry id, the scout entry id, the `[name] window` command for 641 to 650, and "not extracted".

**SQL** [Prior art]: returns no row, which reads as "no statement". **KV** [Prior art]: no key for a range with no entry.
**Grounds.** SUFF (primary: what counts as enough evidence), ABS (not extracted versus not his), IDENT (who the speaker is).

### RP-23. What did he say between 100 and 200 s of the White House source
**Flags** PTR GD. **Situation.** An agent asks what Ellison said in `v03-x5gmidnyeds-whitehouse-stargate-remarks-73e4886b` between 100 and 200 s.

**Data.** No statement entry exists in that range. The range is covered by EPH `extractor.jsonl:306` 6315d52dab2b (run `#0-268.1`, kind not-his, class not-his: "Host's own remarks (self-identifies as the President)"). Elsewhere in the same source: `extractor.jsonl:309` 7cbe4c70af48 (`#372.2-536.1`, class unattributed-or-unproven, whose reason text ends "Not his."), `:311` d7b4ddf7c52c (RP-22). Seconds by class over the source: not-his 2,406.1; unattributed-or-unproven 284.0; attributed 90.9; withheld 2.0; no entry 1.7 of 2,784.7 [Result E-10]. Entries of kind `not-his` carry four classes: not-his 61, unattributed-or-unproven 51, non-speech-or-gap 5 (extractor) and negative-control 8 (scout) [Result E-17].

**Correct answer** (pointer reply) [Proposal]: "0 attributed statements; 100 of 100 s examined; the range lies inside a run recorded as the host's own remarks (entry `6315d52dab2b`)", plus the counts of seconds, not text. A reply of "nothing" or "none recorded" is wrong: the log says the range was examined and is another speaker's. For `#372.2-536.1` the reply must say the class and the reason text disagree [Result EPH `extractor.jsonl:309`].

**SQL** [Prior art]: `WHERE kind = 'not-his'` folds four meanings into one set; a coverage question needs an interval union. **KV** [Prior art]: a missing key means unexamined, excluded and unproven at once.
**Grounds.** ABS (primary: three recorded kinds of absence plus a fourth, no entry).

### RP-24. What does the extractor lane know when it decides
**Flags** GD. **Situation.** A reviewer wants the ledger as the extractor lane could see it, to judge its decisions without hindsight.

**Data.** Full log: 202 utterances, 153 attributed (all written by the extractor), 49 withheld (all written by the verifier), 0 undecided; attributed and withheld do not overlap [Result E-11]. A perceiver holding only the extractor's entries sees 153 attributed, 0 withheld, 49 undecided [Result E-11].

**Correct answer.** Two answer triples for the same question, labelled by the ground: (153, 49, 0) for the whole log and (153, 0, 49) for the extractor window. This is the real-log form of QA E13.

**SQL** [Prior art]: filter by writer, then recompute the status; easy on a stored writer column, and the definition of "undecided" has to be re-derived. **KV** [Prior art]: the key's value is already the all-writers fold.
**Grounds.** TIME (a perceiver's frontier), DEP (hidden writers' entries are not followed), ABS (undecided is not withheld).

### E. The positions

### RP-25. Which of the 27 positions do the real logs occupy
**Flags** GD. **Situation.** The design must hold all 27 positions; a reader wants to know which the two real logs actually use and which of those are declared.

**Data.** The Premiere replay uses 10 distinct cell values, the Ellison log 6, the union 11 of 27; no entry occupies a Pattern position or SIG [Result E-12]. Every entry's cell is a writer's declared mapping (`cell_status: declared`; the replay's header says "cells are a declared mapping (theory)") [Result OUT/report.json; RPL `pharos-import.jsonl:1`]. 978 write entries (709 execute_extendscript, 269 save_project) carry the placeholder `NUL·Ground` because their tools are unmapped [Result E-12; OUT/report.json plan.unmapped_tools]. One declared kind (holon) names `DEF·Pattern` in its body while its entry sits at `DEF·Figure` [Result RPL `pharos-import.jsonl:4`].

**Correct answer.** A table of occupied positions with count per log, each marked DECLARED, and the 16 unoccupied positions listed as unoccupied, not as zero activity [Result E-12 for the 11; the claim that nothing real fills the rest is limited to these two logs]. No operator meaning is asserted.

**SQL** [Prior art]: GROUP BY cell is trivial; whether a cell label is earned or typed is not a column. **KV** [Prior art]: the cell is a string.
**Grounds.** IDENT (what a label names), ABS (unoccupied versus unmapped).

### F. Same versus Other

### RP-26. A control file that is a cut of a source: same or other
**Flags** SO GD. **Situation.** The ledger lists 22 sources, 8 of them negative controls. One control is a 9 s file whose name says it is a cut of an interview source the ledger also lists. A counter asks how many distinct recordings there are.

**Data.** Source EPH `scout.jsonl:21` 553f9794232f (`p2-p39-cbs-n08-third-richest-man-0-0-9-0-b18e7728`, 9 s, role news-about; "the file is itself a time-cut of P39 0.0-9.0 (filename)"; lineage inferred from the filename only), its control `scout.jsonl:35` ef1091f615c9. The parent EPH `scout.jsonl:13` 09089506a75e (`p39-iq41o0ysnte-cbs-ellison-google-apple-nsa-af4ec13a`, 428 s, no statement extracted). The scout records that the same sentence appears in P39's first 100 s as reporter voiceover [Result EPH `scout.jsonl:21`].

**Correct answer** (verdicts DECLARED, not findings) [Proposal]: respect "recording lineage": Same (a cut of P39 0.0 to 9.0, inferred from the filename [Open: no recorded intake]); respect "library item, file bytes": Other (two items; hashes not compared here [Open]); respect "words said": Same for the overlapping 9 s; respect "source of record for a quote": the parent, as a selection, not the cut (CLAUDE.md Rule one). With no respect named the answer is Gap and a refusal. Counts depend on the respect: among the 22 listed sources the number of distinct recordings is one fewer if the cut counts as its parent (arithmetic only; the other sources were not checked for further cuts [Open]).

**SQL** [Prior art]: equality on a source id, which says Other. **KV** [Prior art]: two keys.
**Grounds.** IDENT (primary: Same is always for a respect, SOM section 1).

### RP-27. One recording, four files, one ledger source: same or other
**Flags** SO GD. **Situation.** The film puts a White House clip on V3. A reviewer asks which Ellison statements in the ledger that clip shows.

**Data.** Four files name one YouTube id, `X5gMiDnYEds`: `X5gMiDnYEds_sec.mp4` (RPL `oracle-v2-master.jsonl:3027` f8a77ed4aa3d, import_media, 2026-11-09T23:38:54Z); `X5gMiDnYEds_full_1080p.mp4` (`:5295` 15e998dd3cae, 2026-11-11T22:55:47Z); `X5gMiDnYEds_hq_stream_copy.mp4` (`:5314` 7b510ea258e5, TL 6431, 2026-11-11T23:59:40Z); and the ledger's source file `V03_X5gMiDnYEds_whitehouse-stargate-remarks.mp4` (EPH `scout.jsonl:14` 7778d1dd7247, 2,784.7 s, 18 statements attributed [Result E-10]). BL:1354 says the hq copy is 40 s, offset "hq = sec + 10.968" from the `_sec` clip, and that the full 46-minute source was not in the project. The scout notes "re-encodes x5gmidnyeds-full-1080p-425baa14 and trims exist in IMPORT_BATCH". The film's V3 clip uses the hq file at in 22.208333 to out 26.583333 (RPL `oracle-v2-master.jsonl:5380`) [Result E-03].

**Correct answer** (verdicts DECLARED) [Proposal]: respect "recording" (same YouTube id in four filenames, provenance inferred from filenames): Same; respect "file bytes": Other (four paths; no hash for the hq file in either log [Open]); respect "words at a time": Gap, because the map from hq time to V03 time is declared in neither log, and a prose offset between hq and `_sec` is not the map to V03 [Open]. So the reply to "which statements does the clip show" is Gap with the three pointers named, not a list of statements.

**SQL** [Prior art]: a join on filename, which returns nothing across `X5gMiDnYEds_hq_stream_copy` and `V03_X5gMiDnYEds_whitehouse-stargate-remarks`. **KV** [Prior art]: four keys.
**Grounds.** IDENT (which sameness), TIME (the offset between media clocks).

---

## 3. Coverage and the grounds

By ground (a problem is counted under each ground it leans on, from the index):

| Ground | Problems | Count |
|---|---|---|
| IDENT | 01 02 03 04 08 10 12 16 17 20 22 25 26 27 | 14 |
| DEP | 01 02 03 04 05 06 07 09 11 12 13 14 15 16 19 20 21 24 | 18 |
| TIME | 01 06 09 10 11 13 15 17 18 21 24 27 | 12 |
| ABS | 02 03 04 05 07 09 13 14 15 16 18 19 20 22 23 24 25 | 17 |
| SUFF | 07 13 16 18 22 | 5 |
| BASE | 01 06 08 16 17 21 | 6 |

Reading the table [Proposal]: SUFF and BASE are the thinnest. SUFF has five problems because only RP-13, 18 and 22 have a real stop-rule question in this data; RP-07 and RP-16 touch it. The real logs hold no question whose answer needs a count or sum over a long dependency chain (the whole-corpus case in OLM), so the wave fold's cost advantage cannot be tested on these problems [Open: the synthetic logs in `qa/data` carry the planted structure].

Mapping to the intelligence-test question families (QSET section 3) [Proposal; mapping by me, QSET question files not read]: RP-03 PQ-CREATOR; RP-13 PQ-LAST and PQ-LANES; RP-07 PQ-INFLIGHT; RP-01 and RP-06 PQ-HELD (the held-set reading depends on identity and time); RP-19 EQ-BASIS; RP-20 EQ-SAY and EQ-BASIS; RP-21 EQ-COUNT and EQ-ASOF; RP-23 EQ-COUNT; RP-26 EQ-CONTROL.

## 4. What the problems ask of a design

Read off the problems, for the designers to accept or reject [Proposal]. None says a construct exists or works.
1. Identity is a choice, not a given: five problems (RP-01, 03, 04, 17, 26) change their answer with it. A construct must let a reader name the identity rule and have the answer cite it; a key-equality default would fail RP-01, 03, 04 and 10.
2. Absence has at least four recorded meanings in the Ellison log alone (not his, unproven, no entry, not extracted) and an unrecorded fifth in the Premiere log (calls made, not logged). RP-07, 14, 22 and 23 return a wrong "none" if absence is one value.
3. A retraction needs an answer to "do dependents follow" (RP-09), and the real logs carry no retraction, so the first retractions will be synthetic or new [Result E-16].
4. Time has three real forms here: clock with ties (RP-06), causal order that the importer manufactured (RP-06, 13), and the as-of of a ground (RP-21). A "latest" or "as of" with no declared regime would answer RP-06 with an artifact.
5. An agent's reply is pointers, counts and named censors (RP-07, 13, 19, 20, 23). The answer shape is part of the language, not a formatting step.
6. A dependency can sit in a text field (RP-11) or in script text (RP-12); a design that follows only declared edges misses both, one that follows text finds false edges (RP-12's read-only script).
7. Same and Other need a respect (RP-02, 10, 26, 27); refusing without one is a result the real data demands (RP-27 ends in Gap).
8. Writes must keep "not read" distinct from empty (RP-15) and must be able to record a ground and an adoption (RP-16, 17).
9. A stop is a stored, revisable claim (RP-18), and the real log has a known hole that would test it (the unlogged 18:00 replace_clip).

## 5. Open and limits

- Every E-nn number has one reader. The pre-existing Results (OUT/t3, t4, t5 and their reviews) were each re-derived by an independent reviewer; mine were not, and a second reader should recompute Appendix A before any problem becomes a test [Open].
- The expected answers here are what a correct answer would contain, not sealed truth. Truth for the later tests comes from fresh blind authors (PREREG-A4, last paragraph).
- Verdicts in RP-02, 10, 26 and 27 are DECLARED readings by me, kept as readings. None is a finding.
- Not checked: BOARD/state/pre.jsonl (off limits; its numbers are quoted from CP section 8), the pharos-sqlite database (cited only through the QA README), the media files themselves, the YouTube provenance beyond filenames and scout notes, and the hq-to-V03 time map.
- The Premiere log was never written for these questions: it holds no reads, no created ids and no before-states (OUT/t5.txt), so several problems (RP-03, 05, 13) end in a pointer plus a named censor. That is the honest answer on this data and is itself the finding the later forward capture (CP) is meant to change.
- The design-round constraint on this file: it was written only inside `design/`; no file outside it was written, nothing was installed, no network or model call was made, and no stamp (`.sha256`, `.time`) was made for it.

---

## Appendix A. Evidence made in this round (E-nn), with methods

Common loader (read only, no files written): `python3 -I -` reading every `*.jsonl` in `ledgers/pharos-lazy/data/replay`, adding file name and 1-based line, sorted by (`at`, file, line). Ellison: the three files in `ledgers/ellison-statements/pharos`. TOOLLOG: `phasepost-labels/pharos-premiere/data/TOOLLOG.jsonl`.

- **E-01** The first 12 hex of every entry id are unique: 10,244 replay ids, 764 Ellison ids, maximum count per prefix 1 in both.
- **E-02** Group TOOLLOG rows by `session`: 23 sessions, 16 with more than one `who` value (a null counts as a value). Session 443896f2: 139 rows over 9 values. Session b810d6b6: 2,162 rows (oracle-v2-master 2,147, audio-mix 7, editor-premiere-3 7, null 1). Two rows have null `who`: TL 23 and TL 5156. TL 23 repeats the tool and args of TL 11 (same session, 40 s earlier, TL 11 under permit `20261106-144112536__oracle-v2-master`).
- **E-03** Entries at `000f4996`, `000f4997`, `000f4998` and the 11-12 placement entries `oracle-v2-master.jsonl:5379` to `5388`. The 11-06 keyframe writes by v2-sec-10, v2-sec-07, v2-sec-04 end at 23:14:07Z; the next entries on those ids start at 03:11:39Z on 11-12, 123.96 h later.
- **E-04** Closure over `of` from the 7 entries at `000f4989` gives 13 entries (3 raises, 3 grants, 2 trim_clip, 2 apply_effect, 1 remove_from_timeline, 1 set_clip_properties, 1 move_clip) and 12,502 bytes; the replay file bytes total 10,350,899 (0.12%). For `000f4996`: 9 seeds, 19 closure entries, 18,103 bytes.
- **E-05** Entries between `oracle-v2-master.jsonl:5315` and `:5325`: the raises, grants and releases of three permits and no write entry from 23:59:58.649Z to 01:06:55.013Z; `:5318` and `:5319` are adjacent.
- **E-06** Grants with `at` between 21:20:03.610Z and 21:20:03.614Z on 2026-11-06: ten, listed in RP-06. Writes by those ten lanes between 21:20:03.7Z and 21:40:00Z: 105 across v2-sec-04, 09, 12, 10; adjacent entries from different lanes 3 times in 104 pairs. Raise-to-grant waits over 600 s ending at 21:20:03: 3.
- **E-07** Writes (excluding permit and request entries) with `at` strictly between 01:09:39.107Z and 03:14:31.806Z on 2026-11-12: 44; with `args.sequenceId` or the permit's raise `sequence` equal to `fe6d6e93-83a1-45cc-b151-59719dacbaef`: 25 (10 by args.sequenceId alone); by lane 16 editor-premiere-3 and 9 oracle-v2-master; entries at address `000f4989`: 1.
- **E-08** TOOLLOG rows with `permit` = `20261110-155554179__oracle-v2-master`: 31 (rows 5125 to 5155); rows with local time after 15:58:30.707 (the suffix-less release): 26; rows after the release of the same exact id (+1 s): 0 over all permits. The grant's `expires` 1794348657.996 is 22:10:57.996Z; TL 5156 is at 22:10:58.622Z. Time zone is UTC-6 (verified in OUT/report.json).
- **E-09** Ellison: 153 attributed entries, 49 withheld, no utterance in both and none in neither (153 + 49 = 202). 4 withheld entries have class `pass-trailing-cue-only`. Pre-patch folder: 156 attributed, 46 withheld.
- **E-10** V03 utterances 20 (18 attributed, 2 withheld: V03-01 582d5b1c57b0 `extractor.jsonl:185` and V03-18 1379d6286192 `:202`); seconds by class summed from `not-his` runs and utterances: not-his 2,406.1, unattributed-or-unproven 284.0, attributed 90.9, withheld 2.0; coverage 0 to 2,783 with no gap; source duration 2,784.7 s. No utterance has an interval inside 622.5 to 726.9.
- **E-11** Extractor-only view: attributed entries written by extractor 153; not-established entries written by verifier 49 (hidden to the extractor window); utterances 202.
- **E-12** Distinct `cell` values: replay 10, Ellison 6, union 11 (CON·Figure, DEF·Figure, DEF·Ground, EVA·Figure, INS·Figure, INS·Ground, NUL·Figure, NUL·Ground, REC·Figure, SEG·Figure, SYN·Figure). Entries at `NUL·Ground`: 979 (978 write entries for execute_extendscript and save_project plus the frame header).
- **E-13** replace_clip entries 59; apply_effect entries whose args.effectName contains "Lumetri": clips 38; replace_clip entries whose args.clipId has an earlier Lumetri apply (by `at`): 0.
- **E-14** Raise-to-grant waits by `addr` between raise and grant `at`: 1,132 pairs; over 600 s 28, over 300 s 74, over 240 s 88, over 60 s 182 (equal to OUT/review_T3.json). 10 of the 28 are `v2-sec-03`. Denied entries with a later grant of the same `body.request`: 75; with a later raise of it, granted or not: 76. No TOOLLOG row carries permit `20261111-230838172__oracle-v2-master`.
- **E-15** Entries whose args name `000f8314`: 16 with `args.clipId` (audio-mix) and 1 with the id only in script text (`oracle-v2-master.jsonl:3837`); `000f8348`: 1 structured (audio-mix, `audio-mix.jsonl:411`) and the same script.
- **E-16** Kinds present in the replay and the Ellison log: no `retract` entry in either (the replay's `kind:retract` appears only as a declared header kind).
- **E-17** Ellison `not-his` kind entries by `body.class`: extractor not-his 61, unattributed-or-unproven 51, non-speech-or-gap 5; scout negative-control 8.
- **E-18** Permit 20261106-145032704__oracle-v2-master timing from `oracle-v2-master.jsonl:29` to `:32`; the denial at `v2-sec-04.jsonl:2`; and the request pair at `v2-sec-04.jsonl:5` to `:9`: raise a081ff6595db (20:57:49.030Z, plan.json), released d4c441c1e2c7 (20:57:58.471Z), raise 27760a3e6b83 (20:57:58.662Z, plan_a.json, same request name), the old raise denied d330cb141600 and the new one granted 7270a3bd73be within 1 ms at 21:03:48.347Z and .348Z.
- **E-19** Seconds of the four gate-withheld runs from their addresses: 804.2 to 936.8 (132.6), 3703.3 to 3753.2 (49.9), 53 to 53.8 (0.8), 738.9 to 1200.2 (461.3): total 644.6; 2,165 + 644.6 = 2,809.6; 2,809.6 / 24,594.5 = 11.4%; 2,165 / 24,594.5 = 8.8% (LED).
