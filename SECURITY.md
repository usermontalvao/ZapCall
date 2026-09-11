# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (*Security › Report a vulnerability*) or contact the maintainers through the address listed on the repository profile.

Include the version (`package.json` or the panel's Settings page), minimal reproduction steps and the impact. **Never** attach instance tokens, the global key, pairing QR codes, `DATA_DIR` contents or WhatsApp session data — a Chrome profile *is* a live WhatsApp session.

You will get an acknowledgement within a few days. Fixes are released as patch versions; credit is given unless you prefer otherwise.

## Supported versions

Only the latest release on the default branch receives security fixes.

## Threat model

An **instance token** grants full control of one WhatsApp number: dial, answer, listen, read and send messages. The **global key** grants that for every number plus creating, deleting and re-keying instances. Both must be treated as production secrets and kept in backends, never in end-user browsers.

## Built-in controls

| Control | Detail |
|---|---|
| Loopback by default | `HOST=127.0.0.1`. With Docker host networking, binding `0.0.0.0` would expose the API to the internet. |
| Global key never accepted in URLs | `401` when passed as `?token=`. Instance tokens are accepted in URLs only where browsers cannot send headers (WebSocket, dialer, pairing page); those pages remove the token from the address bar on load. |
| `Referrer-Policy: no-referrer` on every response | A token in a page URL never leaks through a link. |
| Constant-time credential comparison | `crypto.timingSafeEqual` over SHA-256 digests. |
| Brute-force limiter | 20 authentication failures per IP per minute → `429` for that IP until the window passes. |
| Origin allow-list | `ALLOWED_ORIGINS` restricts CORS and WebSocket upgrades. |
| Content Security Policy | Panel, docs, dialer and pairing pages are self-contained (no CDN), `frame-ancestors 'none'`, no `unsafe-eval`. `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`. |
| Body and frame limits | 64 KB per request (64 MB for message media), 2 MB per WebSocket frame. |
| Secrets masked | The global key is never logged in full; `/manager/config` returns it masked; `manager.json` is created with mode `0600`. |
| One media source per call | A second client cannot inject audio/video into a call it does not own. |
| Debug eval disabled | `POST /api/debug/eval` exists only with `DEBUG_EVAL=1` and only from the loopback. |
| Process hygiene | Crashed instances restart with back-off; orphaned Chrome processes are killed before a profile is reused; instances exit if the manager disappears. |

## Operator responsibilities

- Keep instance tokens in your backend; authenticate your own users there.
- Protect `DATA_DIR` (registry, keys, paired sessions): restrictive permissions, encrypted backups, never committed.
- Terminate TLS in a reverse proxy in front of `127.0.0.1:18475`; keep administration behind an authenticated tunnel or IP allow-list.
- Rotate on suspicion: `POST /instance/token/:name` for a token, `ZAPCALL_API_KEY` + restart for the global key.
- Rebuild the Docker image regularly to pick up Chrome and dependency updates; run `npm audit` on local installs.

## Known limitations

- Call ownership is declarative (`x-client-id`): any client with the instance token can act on any `callId` of that instance.
- No per-route rate limiting beyond authentication failures.
- Chrome runs without its sandbox inside the container and with host networking — run on a dedicated host or VM.
- Return media depends on private WhatsApp Web internals; an update can break calls silently (`nativeMedia.ready = false` in `/api/diag`).
