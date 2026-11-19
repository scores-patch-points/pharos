# PROPOSAL (draft, not adopted): who may write which phasepost
Written 2026-11-19 from a session in penelope, on the owner's rulings of the same day. Nothing here is a pharos rule yet; `lib/writers.mjs` carries it as data and an audit.

## The rule
Observing is not defining. "There is a period here" is an observation (Existence or Structure). "This is a sentence" is a DEFINITION, and defining, judging and revising (the Interpretation domain: DEF, EVA, REC) is Penelope's act. Khora reads and janus researches: they write Existence (NUL SIG INS) and Structure (SEG CON SYN) and leave EVIDENCE. Penelope convicts. The protocol's own kinds (`frame`, `kind`, `holon`, `retract`) are exempt: declaring the vocabulary of what you write is pharos law, not an interpretation of a text.
The full loop at every level (a character, a token, a sentence, a claim, a document, a standing) uses all 27 phaseposts: at each level someone observes (INS, SEG), someone relates (CON, SYN), and Penelope defines, judges and revises (DEF, EVA, REC). The table below is the 27, with what writes there today.

| phasepost | terrain / stance | domain | may be written by | written there today (or proposed) |
|---|---|---|---|---|
| NUL·Ground | Void / Clearing | Existence | khora, janus, penelope | frame (protocol) |
| NUL·Figure | Entity / Dissecting | Existence | khora, janus, penelope | retract (protocol); a refusal or a typed gap about one thing |
| NUL·Pattern | Kind / Unraveling | Existence | khora, janus, penelope | a typed gap about a whole kind of thing (none written yet) |
| SIG·Ground | Void / Tending | Existence | khora, janus, penelope | (marks store, derived: complete-to-position claims) |
| SIG·Figure | Entity / Binding | Existence | khora, janus, penelope | (marks store: pointers to the entries that answered a question) |
| SIG·Pattern | Kind / Tracing | Existence | khora, janus, penelope | (marks store: a trail by kind) |
| INS·Ground | Void / Cultivating | Existence | khora, janus, penelope | text, the whole text as read (khora) |
| INS·Figure | Entity / Making | Existence | khora, janus, penelope | being; text-reading (the rows); text-referents (referents and the held pronoun spectrum); probe-answer |
| INS·Pattern | Kind / Composing | Existence | khora, janus, penelope | (none yet) |
| SEG·Ground | Field / Clearing | Structure | khora, janus, penelope | ground (where and when a claim holds, janus); text-cuts (the sentence cut offsets, khora, to write) |
| SEG·Figure | Link / Dissecting | Structure | khora, janus, penelope | pair-diff (a cut of two readings into anchors, substitutions, orphans, janus) |
| SEG·Pattern | Network / Unraveling | Structure | khora, janus, penelope | claim (the relation with its polarity, janus; MOVED here from DEF·Pattern) |
| CON·Ground | Field / Tending | Structure | khora, janus, penelope | (none yet) |
| CON·Figure | Link / Binding | Structure | khora, janus, penelope | bond, within, holds_in (janus); pair-witness; unit-news; the candidate bond of an anaphor (janus, proposed) |
| CON·Pattern | Network / Tracing | Structure | khora, janus, penelope | (none yet) |
| SYN·Ground | Field / Cultivating | Structure | khora, janus, penelope | (a desert in khora: no cell fires here) |
| SYN·Figure | Link / Making | Structure | khora, janus, penelope | (none yet) |
| SYN·Pattern | Network / Composing | Structure | khora, janus, penelope | merged-world (the candidate world, janus) |
| DEF·Ground | Atmosphere / Clearing | Interpretation | penelope only | perspective (penelope) |
| DEF·Figure | Lens / Dissecting | Interpretation | penelope only | pair-question, witness-request, anaphor-definition (penelope); kind (protocol) |
| DEF·Pattern | Paradigm / Unraveling | Interpretation | penelope only | holon (protocol); a standing definition (penelope) |
| EVA·Ground | Atmosphere / Tending | Interpretation | penelope only | (none yet) |
| EVA·Figure | Lens / Binding | Interpretation | penelope only | equivalence-verdict (penelope) |
| EVA·Pattern | Paradigm / Tracing | Interpretation | penelope only | (none yet) |
| REC·Ground | Atmosphere / Cultivating | Interpretation | penelope only | (none yet) |
| REC·Figure | Lens / Making | Interpretation | penelope only | a revision of a verdict (penelope) |
| REC·Pattern | Paradigm / Composing | Interpretation | penelope only | a revision of a perspective (penelope) |

## Consequences found when the nexus was checked against it (2026-11-19)
- Janus gate-evidence writes `difference`, `agreement`, `hole`, `change` at DEF·Figure: Interpretation, so Penelope's. The reading that fits is: the hole is a SEG, the candidate bond and the difference are CON·Figure, the merged world is SYN·Pattern, and Penelope does the DEF and EVA over them. Helix order then reverses: findings first, the world composed from them citing them, Penelope's definitions reading the world. The Janus session raised this with its own user and changes nothing until they rule.
- Janus's `claim` entry (the relation with its polarity) was at DEF·Pattern: moved to SEG·Pattern (a cut of the reading's structure into a relation pattern), so Penelope's DEF over it is the interpretation.
- Khora's `text-reading` rows carry a sentence index and part-of-speech and relation labels: those are NOMINATIONS by the UD parser prior, not definitions. The reading now says so in its basis, and the observation "there is a cut here" is its own `text-cuts` entry (SEG·Figure). Penelope's `sentence` DEF over the cuts is the assertion.
- Penelope's `anaphor-definition` (this pronoun refers to X) is a DEF·Figure: hers by this rule.

## What is not decided
Whether this becomes a rule in `rules/rules.json` (every repo then re-acknowledges the new rules hash). Whether Penelope may ever write at Existence or Structure for her own work (she does today: `text`, `pair-question`). Whether khora ever writes a nomination at DEF (the parser's labels) or only records them in basis.
