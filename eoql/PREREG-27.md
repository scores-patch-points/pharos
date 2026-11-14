# PREREG-27: can the universal integration be done with only 27 commands?

Written 2026-11-14 before any session answers. Asked for by the project owner ("reactivate all the agents from today that are relevant to falsify that we can do this").

## The claim under attack
Everything the universal integration needs (pharos installed through any door; every data model, SQL included, a projection of the log; data flowing any way; agents asking for pointers, not reading the log) can be written with only:
- 27 commands: the 9 operators NUL SIG INS SEG CON SYN DEF EVA REC, each as `OP-` (Ground), `OP` (Figure) or `OP+` (Pattern);
- prefix notation: a command followed by its arguments, commands nesting;
- arguments that are only addresses, entry ids, literal values, or nested commands.

Nothing else: no clause keywords (`where:`, `grain:`, `asof:`), no frame arguments, no function library, no separate predicate language, no 10th operator, no 4th grain, no CLI verbs beyond the 27.

## What falsifies it (any one, with a real case)
F1. A needed operation that cannot be written in this form at all.
F2. A needed operation that can only be written by adding something outside the list above (a keyword, a function, a predicate syntax, a frame setting). Report the smallest addition.
F3. Two different needed operations that must be written identically, with nothing in the form to tell them apart.
F4. A form whose meaning depends on a default that is not written anywhere in the form or in the log.
F5. A conversion (into SQL, CSV, JSON, Obsidian notes, a model's context, anything) that loses information which no 27-command form can carry back.

Each counterexample must name the real problem it comes from (a file, a log, a session's actual task), not an invented one.

## What does not count
A case that fits only by a stretched reading is reported as a fit WITH the stretch named, and counted separately ("fits with stretch"). The tally is three numbers: fits, fits with stretch, counterexamples.

## Outcome rule
Zero counterexamples after every relevant session has tried: the claim survives this round (not proven). Any counterexample: the claim as stated is false, and the report lists the smallest additions that would repair it. Nothing is built from either result until the project owner decides.
