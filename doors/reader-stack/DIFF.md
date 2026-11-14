# reader-stack: what changed against khora's install tools

The khora files are not in this tree (see ../../THIRD-PARTY.md). `upstream/SOURCE.json` pins the commit and each file's sha256; `--with-verify-source` fetches each file read-only at that commit and checks the hash, and `--with-clone` re-checks the same hashes against the checkout. The behaviour lives in `steps/index.mjs`, rewritten as declarative steps that the runner gates, journals and backs up. A shell wrapper could not enforce a flag (the original sets launchd variables unconditionally), so the originals are not run by the door.

| original | line(s) | becomes | change |
|---|---|---|---|
| install.sh | clone / pull | `clone-khora`, `update-khora` | pinned to the SOURCE.json commit, never main; refuses a non-empty non-git directory; the pull is fast-forward to the pinned commit only |
| install.sh | `brew install node` | `node` | own flag; undo is a printed note |
| install.sh | `npm ci` | `npm-deps` | own flag; no hidden failure; lockfile checked first; `--ignore-scripts` unless `--npm-scripts`; refuses a checkout that is not at the pinned commit or has changed tracked files |
| install.sh, setup-proxy.sh | `brew install ollama` | `ollama` | own flag |
| install.sh, setup-proxy.sh | `curl ... \| sh` | `ollama-vendor-script` | download for review, sha256 printed, never executed |
| install.sh | `brew services start ollama`, `open -a Ollama` | dropped | contradicts setup-proxy.sh: the proxy owns the daemon |
| install.sh | `claude plugin marketplace add ...`, `claude plugin install ...` | `claude-plugin` | own flag; no default source (the original names a third-party repo); the source must carry a full commit id; the plan says it forwards every hook event to `ER7_URL` and the step is blocked when that points off the machine; reverse commands journaled |
| setup-proxy.sh | `launchctl setenv` x4 | `daemon-env` | own flag; prior values journaled; undo restores or unsets |
| setup-proxy.sh | `ollama pull` x4 | `models` | own flag; list overridable; present tags skipped and not removed on undo |
| setup-proxy.sh | `npm link` | `npm-link` | own flag; reverse is `npm unlink -g`; `--ignore-scripts` unless `--npm-scripts`; same pin check |
| setup-proxy.sh | start fleet and proxy, `sleep 1`, `lsof` | `services` | own flag; port conflict refuses; `/health` polled with a bound; pids and logs journaled, logs in the state dir not the checkout |
| setup-proxy.sh | opencode config rewrite, incl. a hard-coded personal workspace path | `opencode-config` | explicit `--opencode-config` paths only, no directory scan, no baked path; created when absent (the original aborted on a fresh machine); non-strict JSON skipped and not counted; byte backup first; the heimdall bridge provider is not written because nothing here starts it |
| setup-proxy.sh | copy `er7-session.mjs` | `opencode-plugin` | own flag; byte backup of any file it replaces |
| local-up.sh | `ps eww` credential scrape | dropped | moves a secret across a process boundary unasked |
| local-up.sh | start proxy | covered by `services` | |
| integrations/*.sh | run-time wrappers | `bin/*.sh` | same behaviour, ports overridable by environment; `curl.sh` runs real inference; optional, no step runs or installs them |
| claude-code/scripts/run.sh | hook shim | not installed by the door | it ships with the plugin; the door only adds the plugin |
| (new) | | `verify-source` | fetch each listed original at the pinned commit with `gh api` and compare sha256; writes nothing |
| all | short-link lines | dropped | the short link is changed only by the owner |
