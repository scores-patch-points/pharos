# Public readiness checklist

What to check before this repository, or any change to it, is made public. It is a procedure, not a report: results belong in the release notes of the person who ran it, not in this file.

## 1. Know what ships

The release is the set of files git tracks. List it and read the list:

```
git ls-files --cached --others --exclude-standard
```

Anything git ignores is not part of the release. Do not publish by copying the folder or by pointing a tool at the folder: publish from git, so ignored files cannot travel with it.

## 2. Run the scan

```
node tools/public-scan.mjs . --require-names
node tools/public-scan.mjs --selftest
```

The scan reads the same release set. It looks for secret shapes (keys, tokens, private-key headers), home-directory paths, the account name of whoever runs it, email addresses, hosts and IP addresses outside `allowlists/public-scan.json`, and the names on a private-names list.

The private-names list is yours and is never written in this repository. Put one name per line in `.git/info/private-names` (that folder is per clone and is never pushed), or pass `--names-file`. Without a list the private-name check does not run and the scan says so; `--require-names` makes that an error. The self-test plants one item of each kind in a temporary folder and must find all of them.

Expected: exit 0, no findings, and a line saying how many names were checked. Every allowlisted hit is still printed; read them.

## 3. Read what a scanner cannot

A scanner finds shapes. It does not find prose that describes private work, an opinion you would not sign, or a claim that has not been earned. Read every file in the release list once before the first publication, and every changed file after that.

## 4. Licences

- `LICENSE` is present and is the licence you intend.
- `THIRD-PARTY.md` names every project whose code or behaviour was reused, its licence and the exact version, and reproduces the notice that licence requires.
- No third-party file is copied into the tree unless its licence allows it and the notice is in place. Files that are only referenced are pinned by commit and hash (`doors/reader-stack/upstream/SOURCE.json`).

## 5. Tests

```
npm test
```

Green, on a clean clone, before publishing.

## 6. History

Once pushed, a commit is public for good: assume every clone and cache keeps it. Check the scan on the first commit, not only on the tip, and check the author name and email git will record (`git config user.name`, `git config user.email`).

## 7. After publishing

Install from the public copy on a clean machine or in a sandbox by following only the README. If the README is not enough, fix the README.
