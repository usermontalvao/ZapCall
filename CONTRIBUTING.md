# Contributing to ZapCall

Thank you for considering a contribution. This document explains how the project is organised and what a good pull request looks like.

## Ground rules

- Be respectful; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Never post tokens, global keys, QR codes, phone numbers or session data in issues, PRs or logs. Redact before pasting.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Getting started

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm run check      # syntax check
npm test           # unit + integration; the dialer end-to-end test needs Google Chrome
npm start          # manager + panel at http://127.0.0.1:18475
```

For UI work without pairing a real number, create instances in the panel: they stay in *Waiting for QR* and still exercise the whole lifecycle (logs, restart, self-test). `POST /instances/:name/api/debug/fake-incoming` rings a fake call to test client UIs.

## Project layout

| Path | What lives there |
|---|---|
| `src/manager.mjs` | The manager: registry, child processes, proxy, webhooks, panel and docs routes. |
| `src/app.mjs` | One instance: wires the server and the browser, watches pairing and the parent process. |
| `src/server.mjs` | Instance HTTP/WS API, call state, media routing. |
| `src/browser.mjs` | Chrome lifecycle (puppeteer-core) and script injection. |
| `src/security.mjs` | Shared security primitives (constant-time compare, limiter, headers, origins). |
| `src/instances.mjs` | The registry file (`instances.json`). |
| `src/page/inject.js` | Runs inside WhatsApp Web: virtual microphone/camera, media bridge. |
| `src/page/control.js` | Runs inside WhatsApp Web: call control through WA-JS. |
| `src/page/native-media.js` | Runs inside WhatsApp Web: captures return voice/video from private modules. |
| `src/page/messaging.js` | Runs inside WhatsApp Web: messages, chats, contacts (Evolution format). |
| `src/page/zc-ui.js` | Shared shell for every page: theme tokens, navigation, i18n helpers. |
| `src/page/manager.html`, `docs.html`, `dialer.html` | Panel, documentation shell, reference dialer. |
| `docs/<lang>/*.md`, `docs/index.json` | Documentation content, one folder per language. |
| `test/` | `node:test` suites. |

## Conventions

- Plain Node.js ≥ 22, ES modules, no build step, no runtime dependencies beyond `puppeteer-core`, `ws`, `qrcode` and `@wppconnect/wa-js`.
- Comments explain **why** (a measurement, a failure that was seen, a constraint of WhatsApp Web), not what the code obviously does. Keep that style.
- Pages are self-contained: no CDN, no external fonts; everything is served by the service and must work offline inside the container.
- Every string shown in the UI exists in **PT, EN and ES** (`I18N` dictionaries in each page, `UI` in `zc-ui.js`). Missing keys fall back to English, then Portuguese — but do not rely on that.
- Documentation changes are made in all three `docs/<lang>/` folders. Adding a page = one Markdown file per language + an entry in `docs/index.json`.
- Security-relevant behaviour (auth, headers, limits) has a test in `test/security.test.mjs` or `test/hardening.test.mjs`.

## Tests

- `npm test` must pass. Add a test for every bug fix (a regression test that fails before the fix).
- Tests must not need a paired WhatsApp session. Use `semProcessos` (manager without child processes), the `comando` option (a stub child process) or the fake-incoming route.
- End-to-end tests that need Chrome must skip cleanly when Chrome is absent (`{ skip: !chrome && '…' }`).

## Pull requests

1. One topic per PR; keep diffs focused.
2. Describe the behaviour before and after, and how you verified it (which tests, which manual checks).
3. Update the docs (three languages) and the changelog when behaviour changes.
4. CI must be green.

## Releases (maintainers)

Versions follow [SemVer](https://semver.org/): `patch` for fixes, `minor` for features, `major` for breaking changes to the API or the media contract. The version lives in `package.json` and is shown in the panel (Settings and Diagnostics) and in `GET /manager/config`.

1. Move the entries under `## [Unreleased]` in `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section (the `version` script refuses to continue if the section is missing).
2. `npm version minor` (or `patch` / `major`) — bumps `package.json`, commits and creates the tag `vx.y.z`.
3. `git push --follow-tags`. The **Release** workflow builds the Docker image (`ghcr.io/usermontalvao/zapcall:x.y.z`, `:x.y`, `:latest`) and publishes a GitHub Release with that changelog section as notes.

## Adding a language

1. Add the language to `LANGS` in `src/page/zc-ui.js` and to `languages` in `docs/index.json`.
2. Copy `docs/en/` to `docs/<lang>/` and translate.
3. Add the dictionary in `I18N` of `manager.html`, `dialer.html`, the pairing page (`src/server.mjs`) and `UI` in `docs.html` / `zc-ui.js`.
4. `npm test` checks that every documented page exists for every language.
