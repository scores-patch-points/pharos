// pharos-lazy-adapter.skeleton.mjs: SKELETON ONLY. Not imported by anything, not run, not tested.
// It records how the stage-1 placed reader (ledgers/pharos-lazy, not touched by this folder) would be wrapped to satisfy the
// engine contract in README.md, and what stage 2 must supply. Nothing here reaches into ledgers/pharos-lazy.
//
// contract method        stage-1 reader call (API.md)                         status
// --------------------------------------------------------------------------------------------------------------
// tools()                static list; `schema` only when features.G            to write
// call('ask', a)         r.ask(a.addr, { kind, rule, window, conflicts })     EXISTS: values, held, value (only with causal-latest),
//                                                                               conflicts, retractions, violations, coverage
//   H on                 rule 'none' (the whole superposition) and `held`     EXISTS: held = values.length is the survivor count
//                        shown as `survivors`; retractions as marks
//   H off                rule 'effective-latest' -> single `value`            EXISTS
//   G on                 ground first: r.schemaVersions(kind) / r.chooseSchema   EXISTS (schema read); the ground-first BACKWARD fold and
//                        as of the question's cut; `status` values              the statuses no-ground / ruled-out / incomplete are
//                        determined | held | no-ground | ruled-out | incomplete  A4/A5/A6 (STAGE 2)
//   T on                 verified hints, `next_look`, cheaper repeat reads    NOT BUILT: A7/A8 (STAGE 2)
// call('lane', a)        r.lane(kind, writer, { from, to })                    EXISTS
// call('range', a)       r.range(kind, from, to)                               EXISTS
// call('read', a)        read one entry by id prefix                           to write (page-table lookup; A7 item A)
// stats()                r.stats: bytesRead, entriesParsed, filesOpened        EXISTS (map to bytes_read, entries_parsed, files_opened)
// dump()                 flatten the slice (P.flatten) to compact JSONL        EXISTS (P.flatten), size check by the harness
// reset()                new Reader(root); trails cleared                      to write
// ids()                  the set of entry ids of the slice                     to write (from P.manifest)
// slice loader           build a placed log from {source, from_at, to_at}      NOT BUILT (STAGE 2): ingest a time slice into a temp root
//
// Constraints the real adapter must honour (README.md "response contract"): results bounded by the engine's own page size and below
// CAP_CHARS (page by bytes, not by count: the first stub self-test showed that a feature adding fields can push a page over the cap and
// break the JSON); feature flags change the SHAPE of the response, never the correctness of what is held; no field carries the answer
// of a question (a trail is a hint, never an answer; mutant H11).
export default function open() {
  throw new Error('stage 2 has not delivered the engine adapter (see PREREG section 16)');
}
