# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Dark-mode screenshots, roadmap, support section and `SUPPORTERS.md`; `Sponsor` button (`.github/FUNDING.yml`).
- Release workflow: pushing a `v*` tag publishes the Docker image to GHCR and a GitHub Release with the notes from this file.

## [0.1.0] - 2026-09-11

### Added
- Built-in, searchable documentation at `/docs` in Portuguese, English and Spanish, served from `docs/<lang>/*.md`.
- Panel redesign: table and card views, state filters, live logs with filtering, typed-name deletion, danger zone, QR pairing with countdown, PT/EN/ES, system/light/dark theme.
- `src/security.mjs`: constant-time credential comparison, per-IP brute-force limiter, security headers (CSP without CDN, `Referrer-Policy: no-referrer`, `nosniff`, `frame-ancestors 'none'`), origin allow-list (`ALLOWED_ORIGINS`).
- `DEFAULT_COUNTRY_CODE`: the country code prepended to national numbers is configuration, no longer a hard-coded `55`.
- Token in header for the WebSocket (`Authorization: Bearer`), in addition to `?token=`.
- Public `/favicon.ico` and `/static/favicon.svg`; `/static/worklets.js` also on the manager.
- Ended calls are pruned (last 100, one hour); orphaned Chrome processes are killed before a profile is reused; instances exit if the manager disappears (`ZAPCALL_PARENT_PID`).
- Tests: security primitives, hardening routes, lifecycle with signal-killed children, headless-Chrome dialer end-to-end (including the worklet-failure regression).

### Fixed
- Dialer: `Cannot read properties of undefined (reading 'reproducao')` when `static/worklets.js` failed to load — the dialer now re-fetches the worklets and reports a clear error; the injected page reads worklets lazily and reports `worklets: 'ausente'` instead of dying.
- Manager: an instance killed by a signal (`SIGTERM`/`SIGKILL`) was reported as running forever and could not be restarted or re-enabled.
- Instance: `SIGTERM` during boot left a Node process alive without server or browser.
- Instance log said "session dropped" on first boot without a session.
- Panel kept polling with a revoked key and tripped the brute-force limiter.
- Short keys were fully revealed by the "masked" display.

### Security
- The global key is no longer printed in full in the manager log; `manager.json` is created with mode `0600`.
- Dialer and pairing pages remove the instance token from the URL as soon as they load.
- No `unsafe-eval` in any page.

### Changed
- Project renamed to **ZapCall** (package `zapcall`, env `ZAPCALL_*`, globals `window.__zapcall*`).
- READMEs in three languages; `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/ARCHITECTURE.md`, issue and PR templates.

[Unreleased]: https://github.com/usermontalvao/ZapCall/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/usermontalvao/ZapCall/releases/tag/v0.1.0
