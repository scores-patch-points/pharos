# pharos

The one shared log (weave, watch, fold) and the install doors that wire a repo to it. Zero dependencies, Node 20 or later, Node built-ins only.

If you were asked "install the fold here", follow **Do this** and nothing else.

## Do this

`<dir>` is the directory the human gave you. `<pharos>` is this repo. Keep the double quotes: either path may contain spaces.

```
node "<pharos>/bin/pharos.mjs" install all --target "<dir>"            # read the plan; nothing changes
node "<pharos>/bin/pharos.mjs" install all --target "<dir>" --apply    # do it
node "<pharos>/bin/pharos.mjs" verify all --target "<dir>"             # expect exit 0 and: verified: agents-md, pharos-core
```

`install all` means `pharos-core` and `agents-md` only. It never runs anything heavier. Output is JSON when piped. The two names after `verified:` come in alphabetical order, whichever order they were applied in. `node "<pharos>/bin/pharos.mjs" --help` lists every command.

If any of the three commands does not end as described, go to **Repair** below.

## Rules for agents

- Pass `--target "<dir>"` with a directory the human named. Never pass `--yes-real-home`.
- Do not pass any `--with-*` flag unless the human named that flag.
- Never edit anything under `.pharos/` (the installer's journal and backups).
- Exit 3 means refused (a `..` segment, a symlink that leaves its directory, a protected place such as the real home, `.ssh`, `.aws`, `.gnupg` or any other dot-folder of the real home, in any letter case, or a forged journal). Say why and stop. Do not try another path.
- Exit 2 means a usage error: fix the command. Exit 1 means a step or a verify failed: report it, run `undo-door all --target "<dir>"` only if the human asks.
- Do not ask the human anything for the steps above; they need no input.

## Doors

`node "<pharos>/bin/pharos.mjs" doors` lists them.

| door | kind | highest effect | what it touches | needs a flag |
|---|---|---|---|---|
| `pharos-core` | installable | writes files | `pharos.json`, `holon.json` in the target | no (safe) |
| `agents-md` | installable | writes files | one marked block in `AGENTS.md` (or `CLAUDE.md` with `--file CLAUDE.md`) | no (safe) |
| `reader-stack` | installable | starts services | the khora install steps, one flag each (below) | every step |

A detect-only door (none ships in v1) exits non-zero on `install` by design; use `detect <door>` and `verify <door>`.

## reader-stack (heavier: show the human the plan and wait)

Plan first: `install reader-stack --khora-dir "<dir>"` plus the flags you are considering. Apply does nothing for a step whose flag is absent, and says which flags were missing.

| flag | effect | level |
|---|---|---|
| `--with-verify-source` | fetch each khora install file read-only at the pinned commit (`gh api`) and check its sha256 against `doors/reader-stack/upstream/SOURCE.json`; writes nothing | none |
| `--with-clone` | clone khora and check out the pinned commit (never main) | installs software |
| `--with-update` | fast-forward an existing checkout to the pinned commit | installs software |
| `--with-node-install` | `brew install node` when node is missing | installs software |
| `--with-npm-deps` | `npm ci --omit=dev --ignore-scripts` in the checkout (add `--npm-scripts` to let package install scripts run) | installs software |
| `--with-ollama` | `brew install ollama` when missing | installs software |
| `--with-ollama-vendor-script` | download the vendor script for review and print its sha256; it is not run | writes files |
| `--with-launchctl` | four `launchctl setenv` calls; prior values are journaled | starts services |
| `--with-models[=a,b]` | `ollama pull` the list (default: four small models); a tag must start with a letter or digit | installs software |
| `--with-npm-link` | `npm link --ignore-scripts` in the checkout's cli folder; this writes under the global npm prefix | installs software |
| `--with-services` | start the fleet and proxy with node (ports 11438, 11436); refuses on a port conflict | starts services |
| `--with-opencode --opencode-config <path>` | add the fold provider to that opencode config (repeatable); created if absent | edits host config |
| `--with-opencode-plugin` | copy the session plugin into the opencode plugin folder | edits host config |
| `--with-claude-plugin --plugin-source <owner/repo@commit>` | add the plugin at that full 40-character commit; it forwards Claude Code hook events to `ER7_URL`, and the step is blocked if `ER7_URL` points off this machine | edits host config |

macOS only in v1. khora's install scripts are not copied into this repo (khora is MIT, see [THIRD-PARTY.md](THIRD-PARTY.md)): `doors/reader-stack/upstream/SOURCE.json` pins the commit and the sha256 of each file, and `--with-verify-source` fetches and checks them. The refactor is `doors/reader-stack/steps/` and is mapped against the originals in `doors/reader-stack/DIFF.md`.

The pin covers what runs. `--with-npm-deps`, `--with-npm-link`, `--with-services` and `--with-opencode-plugin` run or copy code from the checkout, so each refuses unless the checkout is at the pinned commit, the listed files hash to `SOURCE.json`, and `git status` shows no change to a tracked file. `--with-verify-source` needs the GitHub CLI (`gh`); the plan warns when it is missing, and there is no other fetch path. The scripts in `doors/reader-stack/bin/` are optional run-time wrappers; no step runs or installs them.

## Other verbs

```
detect <door|all> [--target "<dir>"]       what is present and what is missing; changes nothing
install <door|all> --plan                  the plan (also the default without --apply); changes nothing
install <door|all> --apply                 apply the plan
verify <door|all> [--target "<dir>"]       exit 0 only if every check passes
status <door|all> [--target "<dir>"]       not-installed | installed | drifted | partial | journal-invalid, from the journal
undo-door <door|all> [--target "<dir>"]    restore byte for byte from the journal; twice is a no-op
install <door|all> --explain               print what the door is allowed to touch
```

Dry run is the default. `--apply` runs only the steps the plan lists as `run`. Applying twice changes nothing the second time.

## Undo

`undo-door all --target "<dir>"` removes exactly what was written, restoring prior bytes from `.pharos/backups`. A file edited since apply is reported as kept, left alone, and the command exits 1 with the state kept (for `agents-md`, only the pharos block is removed and that counts as success). Software installed by a package manager is never uninstalled; a note says the command. When everything is undone the journal, its backups and plan files are removed by name (anything else that was in the state folder stays) and the report carries the journal's final hash and entry count.

## Repair

Run `status all --target "<dir>"` and act on what it says. Never edit anything under `.pharos/`.

| status | meaning | what to do |
|---|---|---|
| `not-installed` | nothing journaled | run the install |
| `installed` | all steps done, files match | nothing |
| `partial` | a run was interrupted (the report lists each file as `original intact` or `new content in place`) | `undo-door all --target "<dir>"` restores it, then install again |
| `drifted` | a file written by the installer was edited afterwards | keep your edit and leave it, or put the file back by hand, then run `undo-door` again; it exits 1 and keeps the state until the file is either restored or removed by you |
| `journal-invalid` (exit 3 from `undo-door`) | the journal fails its hash chain: it was edited or forged | stop and tell the human; nothing is trusted. The human may move `.pharos` aside and check the files by hand |
| exit 1, `LOCKED` | another run holds the lock | wait; a lock whose process is gone is taken over automatically |

A second `install --apply` after an interrupted run also works: it re-plans under the lock and finishes what is missing.

## Where things are recorded

`<dir>/.pharos/journal.jsonl` (hash-chained, one line per intent and outcome; the chain is verified before every undo), `.pharos/backups/<sha256>` (original bytes), `.pharos/runs/<id>-<door>.json` (the plan that ran), `.pharos/lock` (present only while a run is active). Host-scoped doors keep the same layout under `$HOME/.pharos`. `PHAROS_STATE` or `--state` moves it. Ask with `status`; do not read the files. Files are written by temp file, fsync and rename, so a killed run leaves the old file or the new one, never half of one. `pharos.json` records the library path relative to the target, never an absolute home path.

## Errors

Failures print `{"error":{"code":"...","message":"..."}}` on stderr: `USAGE` (2), `REFUSED` (3), `FAILED` or a step code (1).

## Trust

A door is code. `door.mjs` is loaded and run as ordinary Node code, so the declared-touches checks protect against a mistake in a door, not against a hostile one. Only the doors in this repository are trusted. Read a door before you add its folder to `doors/`: adding it is the same as running it.

The journal is tamper-evident, not tamper-proof. Undo re-checks every entry against the door's manifest (declared paths, declared environment names, exact reverse-command shapes, and a process is signalled only if it is still the one the run started), but do not run `undo-door` on a state folder that someone else could have written.

## Not in this repo

Nothing private ships here: doors for tools that are not public are kept out of the tree, and a door can only reach a tool by its command name.

## The library

```
node bin/pharos.mjs init --dir /tmp/p --writer me
node bin/pharos.mjs weave --dir /tmp/p --writer me --cell INS·Figure --kind kind --addr x --body '{}'   # see SPEC.md
node bin/pharos.mjs fold --dir /tmp/p
node tools/ignorance.mjs <repo> --roster a,b,c          # log-only; add --enforce to fail; --exempt doors for this repo
node tools/public-scan.mjs .                            # public-readiness scan of the files git would track (see docs/PUBLIC-READINESS.md)
npm test
```

- `lib/pharos.mjs`: the whole API (open, weave, ground, watch, fold, merge, frame, status, install, undo).
- `bin/pharos.mjs`: CLI over the API and the door verbs. The legacy `install <repoDir>` and `undo <repoDir>` still work (they act at once, with no dry run, and their pointer records the library's absolute path; they pass the same protected-place guard as a door target); `install <door|all>` is the door command when the argument is a door id or `all` (a directory literally named like a door needs `./`).
- `install/`: the installer core (guard, journal, runner). `doors/`: one folder per door, each with `door.json` (what it touches) and `door.mjs`.
- `tools/ignorance.mjs`: finds reaches into rostered siblings; the roster is always supplied by the caller.
- `tools/public-scan.mjs` and `allowlists/public-scan.json`: the scan and what it is told to ignore (every allowlisted hit is still counted and printed). The scan holds no private names: it reads your own list from an untracked file.

The contract is [SPEC.md](SPEC.md); the 27 cells are data in [cells.json](cells.json). Notes beyond the spec: re-weaving identical content by the same writer returns the existing entry; a kind's entries must use the cell it was declared at; a pharos opened with `{frame:false}` is a merge target only until a frame arrives.

## Licence

MIT, see [LICENSE](LICENSE). Notices for reused work are in [THIRD-PARTY.md](THIRD-PARTY.md).
