# Third-party notices

## khora (MIT)

The `reader-stack` door is a refactor of the install tools of the khora repository
(`scores-patch-points/khora`, MIT licence), pinned at commit
`d3ce14a714adc6dbbf373695a414e79555a11187`.

The khora files themselves (`install.sh`, `setup-proxy.sh`, `local-up.sh`, `integrations/claude-code.sh`,
`integrations/curl.sh`, `integrations/ollama.sh`, `claude-code/scripts/run.sh`) are **not copied into this tree**.
`doors/reader-stack/upstream/SOURCE.json` lists each path with its sha256. The door fetches the files read-only from
the public repository at that commit and compares the hashes (`install reader-stack --with-verify-source --apply`);
a mismatch fails the step. The door's own code (`doors/reader-stack/steps/`, `bin/`) re-implements their behaviour
and is mapped against them in `doors/reader-stack/DIFF.md`.

The licence text of khora at the pinned commit, as required by its terms:

```
MIT License

Copyright (c) 2026 Michael Lacy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

khora's `LICENSE` file at that commit is the MIT text above and is what governs; the `license` field of its `package.json` names a different identifier and is treated as a stale metadata value, not as the grant.

pharos itself is MIT: see [LICENSE](LICENSE).
