# Changes: amendment A2 (builder), 2026-11-13

Nothing committed, pushed or published. Tests under `test/install/` were not edited. `lib/pharos.mjs` was not edited.

## 1. Nothing private in the tree
- `tools/public-scan.mjs` no longer carries a list of private names or a username in any form. The account name and home path are read from the account running the scan. The private-names list is read from an untracked file (`--names-file`, env `PHAROS_PRIVATE_NAMES_FILE`, or `.git/info/private-names`); without one the private-name check does not run, the output says so, and `--require-names` exits 2.
- The scan reads the release set: when the folder is a git work tree, the files git tracks plus untracked files it does not ignore. Ignored files are not opened. A folder that is not a git work tree is walked as before.
- `install/guard.mjs` names no private folder. Protected places are generic: the real home itself, every dot-folder of the real home except `.pharos`, its `Library`, the system folders and `/Volumes`. Extra protected names or paths come from env `PHAROS_PROTECT` or the untracked `.git/info/pharos-protect`.
- `docs/PUBLIC-READINESS.md` is now a generic checklist. `allowlists/`: the short-link host is gone (nothing in the tree uses it).
- `LICENSE` added (MIT). `package.json` has `"license": "MIT"`. `THIRD-PARTY.md` says which upstream licence statement governs.

## 2. Tests (changes outside `test/install/`)
- `test/ignorance.test.mjs`: TEST CHANGE. The assertion "pharos itself is ignorant of its siblings" now passes `exempt: ['doors', 'log']` (ruling: a door by definition names the repo it installs into; `log/` is not part of the release and is not entered). One new test checks that the exemption is exact. `tools/ignorance.mjs` gained `--exempt` / `exempt`, reported in its output; exempt folders are not listed or read.
- The core no longer names a sibling: the default checkout folder name moved from `install/runner.mjs` to the door (`checkoutDir` in `doors/reader-stack/door.mjs`).
- `npm test`: 34 of 34.

## 3. Installer hardening (review A, second pass)
- Case and Unicode form: every refusal comparison folds case and NFC, and paths are resolved with the filesystem's own spelling. A target spelled in another case resolves to the stored spelling, so its journal is found.
- Legacy `install <dir>` and `undo <dir>` pass the target guard; a target that is a symlink is refused. They are still not dry and the legacy pointer still records an absolute library path (both pinned by the unchanged-behaviour test).
- Undo refuses to work through a symlinked state dir, `backups`, `runs`, `journal.jsonl` or `lock`, or a state dir that resolves outside its root.
- Lock: the wait is bounded on every path; a lock path that is a directory or symlink is refused at once; a pid that is not an integer above 1 is judged by age.
- Residue: A new state dir appears under its own name in one step, already holding its first journal line (built beside its place as `<state>.new-<pid>-<hex>`, then renamed), and a state dir this installer created leaves in one step too (renamed to `<state>.gone-<pid>-<hex>`, then emptied). A killed run leaves only such a side folder; the next apply or undo removes it by that exact name shape, when the pid in the name is gone and the folder holds only the installer's own state files. A state dir that exists without a journal is never treated as ours and is never removed; only a dead run's `lock` file in it is. Undo journals the temp name of every restore write (`undo-tmp`) before making it and removes such a leftover on the next undo. (The first design of this round, adopting an empty state dir, broke two registered tests and was withdrawn: see the ledger note to amendment A2.)
- A file is hashed again right before the rename; a change since the backup refuses the write.
- A file that changed between a door's read and the plan, or between the plan and the write, refuses the write (exit 3, run again) instead of dropping the change. What remains is the instant inside the rename itself.
- A target that contains the real home (a parent of it) is refused.
- A block refresh journals the block it replaced; undo of an edited file puts the older block back.
- Option values that begin with `-` are a usage error; model tags and plugin sources must begin with a letter or digit.
- The plan lists the directories a write will create (`creates_dirs`).

## 4. Undo treats the journal as data (review C)
- `setenv` names must be in the door's `touches.env`.
- Reverse commands must match exact argv shapes and a declared working directory. `launchctl` is no longer a reverse tool.
- A journaled pid is signalled only if `/bin/ps` shows the same start time (journaled at spawn), tool and script.

## 5. reader-stack
- Steps that run or copy code from the checkout (`npm-deps`, `npm-link`, `services`, `opencode-plugin`) refuse unless HEAD is the pinned commit, the listed files hash to `SOURCE.json`, and `git status` shows no changed tracked file. `update-khora` checks the same after the merge. HEAD is resolved through branch refs.
- `npm ci` and `npm link` run with `--ignore-scripts`; `--npm-scripts` turns lifecycle scripts back on.
- `--plugin-source` must be `owner/repo@<40-hex commit>`. A non-loopback `ER7_URL` blocks the plugin step.
- The plan warns when `gh` is missing.

## 6. Not done
- `test/install/b_lib.mjs` still spells the private names as split strings, and `test/install/` still hard-codes a workspace layout; that folder belongs to the test author.
- No fetch path other than `gh`.
- Legacy install is not dry by default and writes an absolute library path.
- A lock whose pid was reused by a live unrelated process blocks until that process ends.
- A forged journal can still ask undo to signal a process of a declared tool whose start time and command line the forger knows.
- `npm link` writes under the global npm prefix.

---

# Changes: amendment A1 (builder), 2026-11-12

Nothing committed, pushed or published. Tests under `test/install/` were not edited.

## 1. khora files out of the tree (I7 replaced)
- Removed `doors/reader-stack/upstream/*` (the seven khora files). `doors/reader-stack/upstream/SOURCE.json` now holds repo, pinned sha, each path and its sha256 (moved from `doors/reader-stack/SOURCE.json`).
- New step `verify-source` (flag `--with-verify-source`, level none, declares tool `gh`): at apply it runs `gh api repos/<repo>/contents/<path>?ref=<sha>` for each listed file, hashes the bytes in memory and fails on any difference from SOURCE.json. It writes nothing. Plan stays pure (it only lists the calls); fetching happens at apply. A failed check is journaled as failed, so a later plan never calls it satisfied.
- `clone-khora` also hashes the seven files in the fresh checkout against SOURCE.json and fails the step on a mismatch.
- `THIRD-PARTY.md`: khora, MIT, the pinned sha and the licence text as at that commit (it carries the copyright line from khora's LICENSE).
- `DIFF.md`, `door.json` (summary, provenance, license_note, network `api.github.com` added to the public-scan host allowlist) updated.

## 2. Installer defects D1 to D7 (install/, new install/fsx.mjs)
- D1 atomic write: temp file (same dir, O_EXCL|O_NOFOLLOW), fsync, rename, directory fsync, for file writes, undo restores, backups and run-plan files. The temp name is journaled in the intent; undo removes it. A torn last journal line is dropped on the next append. `status` reports `partial` with, per file, `original intact` or `new content in place`.
- D2 undo exactness and honest status: a file edited since apply is kept, its entry stays active, undo exits 1 (`drifted` in the report), `status` keeps saying `drifted`. Backup bytes are hash-checked before a restore. Entries naming a directory or file that is no longer a regular file are kept, not removed.
- D3 undo deletes only journal-created paths: backups by recorded hash, plan files by recorded run id, directories only with rmdir and only if they did not pre-exist (the init entry now records whether `backups/` and `runs/` pre-existed), `creates` only when the entry says `existed:false` and the path is declared. The old recursive removal of `backups/` and `runs/` is gone.
- D4 hash chain verified on every journal read (prev, seq, JSON object); a broken chain throws `JOURNAL_FORGED` (exit 3) before anything is touched, and `status` reports `journal-invalid`. Undo also re-validates each entry: declared paths for write and mkdir, `init` directories must be the state dir or a parent of it, temp names must match the pattern, reverse commands are limited to ollama rm, npm unlink, claude plugin remove/uninstall, launchctl setenv/unsetenv, setenv names are checked, pids must be integers above 1.
- D5 no-follow: temp files and the journal are opened with O_NOFOLLOW; rename replaces a symlink at the target instead of following it; a fifo or device at a target is refused (it used to be read and could block); `command-ok` checks the declared tool before running it. Limit: Node has no openat, so a parent directory swapped for a symlink between the last check and the rename is narrowed (the check is repeated right before the rename), not closed.
- D6 targets: the real home itself, `.ssh .aws .gnupg .kube .docker .azure` inside it, and `/etc /usr /bin /sbin /System /Library /Applications /private/etc` are refused (exit 3) for target, state dir and khora dir whatever the flags. A project folder inside the real home is still allowed (the test sandboxes live there).
- D7 lock: `$STATE/lock` (O_EXCL, owner pid, stale owners taken over, reentrant in a process, 20 s wait then `LOCKED` exit 1) held for the whole apply and the whole undo; apply re-plans under the lock; state-dir creation records only directories this process created. Six parallel `install all --apply` produced one verified install and one block (builder check, not a registered test).

Also (review A findings outside D1 to D7): spawned tools and the in-process PATH lookup ignore empty and relative PATH entries (a tool planted in the current directory); `undo-door --plan` is a usage error instead of undoing; `--help` prints a longer text while no-args and unknown commands keep the original short usage byte for byte (I9 compares them).

## 3. README and CLI
Quoted `"<pharos>"` and `"<dir>"` paths; verify order corrected to `verified: agents-md, pharos-core`; a Repair section keyed on `status`; `--help` (also `-h`, `help`) prints on stdout and lists detect, install --plan/--apply, verify, status, undo-door, doors; the safe-word clause and every private name removed; two door rows removed (item 4); `pharos.json` records `lib` relative to the target in the door path.
`test/install-core-parity.test.mjs` (not under test/install/) was changed to expect exactly that one difference from the legacy command. The legacy `install <repoDir>` still writes an absolute `lib`: changing `lib/pharos.mjs` would change its sha256 and break the byte-identical baseline of I9.
`test/ignorance.test.mjs`: the roster fixture naming a private tool became `sibling-a`. That test still fails on the same assertion as before (pre-existing, 4 of 5): it finds khora and eoreader7 named in the reader-stack door.

## 4. Held out
`KINDS.md`, `kinds.json`, the two private-tool doors moved to `ledgers/pharos-public/held-out/` (README there says what and why). `allowlists/public-names.txt` is empty; `allowlists/public-scan.json` keeps only its own entry.

## 5. Not done
`a_rig.validate` free-port assertion lives in `test/install/` (a_rig.validate.test.mjs, a_rig.mjs) and was left for the independent author.
