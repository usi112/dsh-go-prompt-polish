# local-prompt-polish

![version](https://img.shields.io/badge/version-1.3.0-4d6bfe)
![platform](https://img.shields.io/badge/platform-dsh--go%20%C2%B7%20Android-3ddc84)
![license](https://img.shields.io/badge/license-MIT-blue)

A capsule above the composer in the **dsh-go** Android app: tap it, and the draft you are writing is rewritten by **the model of the current session** into a sharper prompt, shown in a confirmation sheet before anything reaches the input box.

No message is sent · your conversation is not modified · no extra network calls (only the model you already configured).

![confirm sheet](docs/preview/confirm.png)

## What it does

```
tap capsule → start job (≤3 s) → confirmation sheet opens
   · Polishing…
   · ready: draft + polished prompt + three buttons
        [Copy polished]  [Append to composer]  [Cancel]
```

| Button | Effect | Composer |
|---|---|---|
| **Copy polished** | clipboard only | untouched; long-press → Select all → Paste replaces it wholesale |
| Append to composer | `insert` | the app merges into the draft, so the original stays in front |
| Cancel | toast only | nothing changes |

## Why there is no one-tap replace

The dsh-go plugin effect whitelist is `insert` / `copy` / `toast` / `command` / `open` / `link` / `refresh` / `patch` — **there is no replace or clear**. The app implements `insert` as a merge into the draft (`insertIntoComposer`). A plugin therefore cannot delete what the user already typed; replacing is a user gesture (select all + paste).

A `replace` effect has been proposed upstream: [ccch1mneyyy/dsh-Go#1148](https://github.com/ccch1mneyyy/dsh-Go/issues/1148).

## Rewriting, not continuing

The draft is framed as *the object being rewritten*: never execute it, never answer it, never continue it; never open with its own sentences; no "Original/Rewritten" labels. It may only improve goal, context, requirements, deliverable shape and disambiguation, and stays under 3× the draft and 600 words.

Post-processing strips a leading restatement of the draft; a pure echo is treated as failure and retried once with a stricter system prompt; if that fails too, a local tightening pass (strip filler openers, collapse repeated punctuation, bullets for three or more clauses) is used instead.

## Context and routing

- Context: the last 8 user/assistant messages of the same session, 320 chars each, ≤ 1600 chars total.
- Route: current session model → last logged `request/header` → deployment default. If none, the local pass runs with no network call.

## Install

```sh
mkdir -p "$DSH_HOME/dsh-go/plugins"
curl -L -o /tmp/p.tgz \
  https://github.com/usi112/dsh-go-prompt-polish/releases/download/v1.3.0/local-prompt-polish-1.3.0.tgz
tar xzf /tmp/p.tgz -C "$DSH_HOME/dsh-go/plugins/"
dsh plugin --profile web add "$DSH_HOME/dsh-go/plugins/local-prompt-polish"
```

Requires dsh ≥ 0.2.1-rc.2 and app ≥ 1.0.11 (native plugin protocol v1). Code changes under `lib/` need an engine restart from the app.

## Tests

```sh
node --check lib/index.js && node --check lib/polish.js
node test/selftest.mjs          # 47 assertions
node "$DSH_HOME/skills/dsh-go-plugin/kit/bin/check.mjs" . --load   # 1 capsule · 1 panel
```

## License

[MIT](LICENSE) · 中文说明见 [README.md](README.md)
