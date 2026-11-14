# Amendment A1 to QSET-SPEC.md: an optional `params` field for scripted control policies

Written 2026-11-13 BEFORE any real question existed and before any result. Stamped with `.sha256` and `.time`. `QSET-SPEC.md` stands except for this addition.

Reason: PREREG controls P1 (expert ceiling), P3 (full-context ceiling) and the closed-form scripted copy policy `SC` need a scripted policy for each real question family. A scripted policy cannot parse natural-language wording reliably, and it must not be allowed to read the sealed truth. So the public question record gets one more optional field.

- `params` (optional object in `questions.jsonl`): the SUBJECT of the question as structured arguments, for example `{"addr": "000f4438"}`, `{"addr": "000f4438", "cut": "2026-11-11T18:00:00Z"}`, `{"source": "p03-...", "label": "f04"}`, `{"t": "2026-11-11T23:12:00Z"}`. It holds only what the question text already says (the clip, source, label, time or cut it names); never the answer, an entry id of the answer, the truth status or a stratum.
- The controller never sends `params` to a model: it sends `text` and `answer_format` only (the harness self-test scans for this, mutant H18). `params` is read only by the scripted control policies in `harness/models/`.
- The AUTHOR checks, as part of `REVIEW.md`, that every `params` value appears in the question's `text`.
- Scripted policies for the real families (`EX`, `SC`, and the scripted reader for `F`) are written by the harness side after the questions are sealed, from `params` and the engine's tool names; they are part of the stage 2 work listed in PREREG section 16, and no truth is read to write them.
