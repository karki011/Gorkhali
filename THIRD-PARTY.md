# Third-Party Attributions

This project adapts work from the following third-party sources.
All are used under the MIT License; the full license text appears once at the end.

## firstmate

- Source: https://github.com/kunchenguid/firstmate
- License: MIT
- Copyright: © 2026 Kun Chen
- Adaptation: bash → Node port of the durable wake queue and wake classifier.

| Ported file | Adapted from |
| --- | --- |
| `scripts/lib/wake-queue.js` | `bin/fm-wake-lib.sh` |
| `hooks/wake-classifier.js` | `bin/fm-classify-lib.sh` |

The symlink-based multi-watcher lock of `fm-wake-lib.sh` is simplified to a plain
`wx`-open lockfile with token release (Phantom runs a single Apex driver, so there
is no multi-watcher steal race). The classifier ports the triage policy from
free-text status-verb matching to the typed execution record
(`reference/schemas/execution.md`).

## lavish-axi

- Source: https://github.com/kunchenguid/lavish-axi
- License: MIT
- Copyright: © 2026 Kun Chen
- Adaptation: prose / discipline adaptation of the HTML annotate review-loop
  conventions (`commands/annotate.md`, `reference/output-contract.md`), plus a
  Node port of the browser-side layout auditor from `artifact-sdk.js`. The
  annotate conventions vendor no code — that CLI is invoked on demand via
  `npx -y lavish-axi` — but the layout auditor below is ported directly.

| Ported file | Adapted from |
| --- | --- |
| `scripts/layout-audit.js` | `artifact-sdk.js` |

## tasks-axi

- Source: https://github.com/kunchenguid/tasks-axi
- License: MIT
- Copyright: © 2026 Kun Chen
- Adaptation: TypeScript → Node port of the atomic file write and advisory
  lock. Made synchronous and fail-open for the phantom hooks, which cannot
  await.

| Ported file | Adapted from |
| --- | --- |
| `scripts/lib/atomic.js` | `lock.ts` |

## gh-axi

- Source: https://github.com/kunchenguid/gh-axi
- License: MIT
- Copyright: © 2026 Kun Chen
- Adaptation: TypeScript → Node port of the log-capture summary/truncation
  logic. Adds a head slice alongside the original's tail, and resolves the
  full-log directory through `phantom-paths.js` instead of `os.tmpdir()`.

| Ported file | Adapted from |
| --- | --- |
| `scripts/lib/log-capture.js` | `run.ts` |

## chrome-devtools-axi

- Source: https://github.com/kunchenguid/chrome-devtools-axi
- License: MIT
- Copyright: © 2026 Kun Chen
- Adaptation: prose / discipline adaptation of the visual-verification protocol
  (`agents/lens.md`). Prose only — no code vendored.

---

## MIT License

```
MIT License

Copyright (c) 2026 Kun Chen

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
