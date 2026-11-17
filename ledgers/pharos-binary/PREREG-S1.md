# PREREG S1: binary storage for pharos, with no change in what any reader sees

Written before any binary code exists. Stamped (`PREREG-S1.md.sha256`, `.time`) first.
Base: pharos 760fb40 (34 tests pass). Later stages: S2 backward fold with stop rules (the essay's A4/A5/A6), S3 attention
as the index (A7 trails, A8 evaporation). Their preregistrations come before their code.

## Format PHB1 (inside lib/pharos.mjs, so the pointer's sha256 pin still covers all running code)
One file per writer, `<writer>.phb`: magic `PHB1`, writer name (varint length + utf8), then records:
  record := kind(1) length(varint) payload(length) chain(8) size(4, big-endian, the byte length of the whole record)
  chain  := sha256(prevChain || kind || payload)[0:8];  genesis = sha256("PHB1\0" || writer)[0:8]
`size` lets a reader walk BACKWARD from the end of the file (needed by S2), and `prevChain` sits in the 12 bytes before
a record, so ONE record can be checked against its predecessor without reading the rest (needed by S3).
Kinds: 0x01 ENTRY (an entry, compactly coded: ids and seen/of ids as 32 raw bytes when 64-hex, `at` as milliseconds
when it is exactly the ISO form of those milliseconds, body/basis and any other fields as canonical JSON; the entry's
id is stored and RE-VERIFIED against sha256(canonical JSON) on decode); 0x02 BLOB (raw bytes, addressed by their
sha256); 0x10 RESYNC (after a torn tail: a new genesis so appends continue past damage, never over it).
The entry is still DEFINED by its canonical JSON and its id is still sha256 of that: binary is storage only.
Selection: `open(name, { format })` or `$PHAROS_FORMAT` (`jsonl` | `phb`); a directory may hold both kinds of file and
is read as one union. **The default stays `jsonl` in S1** (eoql's adapters and ui/serve.mjs read .jsonl files directly
and are not changed here); flipping the default is a decision after S1, recorded with its reason.

## Hypotheses
- **B1 identity.** decode(encode(e)) deep-equals e, with the same id, for every entry of every log built in the tests and
  of a generated 20,000-entry log (several writers, retractions, merges, odd values: `at: "x"`, non-hex ids). Every
  writer file converted JSONL -> PHB -> JSONL reproduces its valid lines byte for byte; `entries`, `fold` and `status`
  are identical on the JSONL directory and its PHB conversion.
- **B2 union and merge.** A directory mixing .jsonl and .phb writers folds identically to its all-JSONL form; the
  existing merge properties (commutative, associative, idempotent) hold across formats.
- **B3 integrity.** (a) A torn tail, cut at every byte of the last record: all earlier records read, the tear is
  reported, and a later append is read after a RESYNC. (b) One flipped byte inside record k: records before k read,
  record k and every later record of that file are reported corrupt, nothing is invented. (c) A record whose stored id
  does not match its content is reported corrupt.
- **B4 size.** On the generated log, PHB bytes <= 60% of JSONL bytes.
- **B5 speed.** Cold load of the generated log: PHB median time over 5 runs <= JSONL median.
- **B6 the existing suite.** `PHAROS_FORMAT=jsonl`: all 34 pass. `PHAROS_FORMAT=phb`: the 28 tests that do not read or
  write JSONL bytes pass unchanged; the 6 that do (duplicate weave, two writers, corrupt JSONL line, no-frame refusal,
  cached reads, CLI file name) are named here in advance and each gets a PHB equivalent that passes.
- **B7 blobs.** putBlob/getBlob round-trip; the same bytes stored twice are one blob; merge copies missing blobs; a
  damaged blob is detected.
- **B8 backward framing.** Walking a file backward by `size` visits exactly the records a forward walk visits, reversed.
- **Mutants (each must fail its hypothesis):** M1 chain not checked -> B3b; M2 stored id not re-verified -> B3c;
  M3 `size` off by one -> B8.

## Decision rule
All of B1–B8 hold and all three mutants are caught: S1 is done and S2 may begin. Any failure: fix nothing silently;
report it, and S2 waits.
