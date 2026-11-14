# Amendment A5 to the erase test: three more leaks, and what a tombstone may keep

Written 2026-11-14 BEFORE any erase design or result exists. Stamped with `.sha256` and `.time`. `PREREG-A4.md` stands; this adds to it. The three leaks and the E3 caution come from the text-finder session (`local_ebda598a`), who had them from the main pharos session and its own work; they are not my findings.

## Three more mutants (each MUST be caught)
- **M-E7 the old aggregate kept beside the new one.** A derived aggregate (a mean, a count, a sum) is recomputed after the void but the pre-void aggregate stays. The erased value is recoverable from the pair (for a mean over n entries, x = n times the old mean minus (n-1) times the new mean). Caught by E2, not E1: the check is extended so that "confirmable" means confirmable from ANY surviving artifact, not only the id; the candidate-guess list is tested against every surviving aggregate pair and cache entry as well as against the recomputed id.
- **M-E8 a cache keyed by a hash of the content.** Real examples exist (the main session's `embcache.jsonl`, the finder's `draws.jsonl`). The key alone confirms a guessed body, and no ripple down `of` reaches the file. New row in the per-place table: "content-hash-keyed caches"; the mutant leaves one in place. The guess check hashes every candidate the way the cache does and looks up the key.
- **M-E9 (key-destroy designs only) a replica that unwrapped or received the body key before the void arrived.** A replica never receives the void entry (or receives it late): the test measures whether "erased" is being claimed before propagation is known. The per-place table gets a column: propagation known or unknown; `ask` must not return "erased" for an entry whose void has not reached the replica it reads (E4 refined: "erased" requires the void entry; otherwise the answer is the replica's honest state).

## E3 caution (a tombstone may keep its place)
The tombstone must keep the entry's id, `of` and `seen` so that later causal positions, heads and as-of cuts do not shift. A design is NOT failed for a tombstone that still carries them. It is failed only if the body can be recovered or confirmed from it (E1, E2). The test therefore checks, separately, that causal positions of all other entries are unchanged after the void (a hash of the position order of the non-voided entries before and after must be equal).

## Frontier table, rows added
content-hash-keyed caches; derived aggregates (old and new); replicas by propagation state.
