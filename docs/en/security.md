# Security

What the service does to protect the WhatsApp sessions it holds, what it expects from you, and what it does **not** do.

## Threat model

An instance token gives full control of a WhatsApp number: dial, answer, listen, read and send messages. The global key gives that for every number plus the power to create and delete instances. Treat both as production secrets.

## Built in

| Control | Detail |
|---|---|
| Loopback by default | `HOST=127.0.0.1`. With Docker host networking, `0.0.0.0` would expose the API to the internet. |
| Global key never in URLs | Rejected with `401` when passed as `?token=`. Instance tokens may be in URLs only for the WebSocket, the dialer and the pairing page, and those pages remove it from the address bar on load. |
| `Referrer-Policy: no-referrer` | On every response, so a token in a page URL never leaks through a link. |
| Constant-time comparison | Keys and tokens are compared with `crypto.timingSafeEqual` over SHA-256 digests. |
| Brute-force limit | 20 authentication failures per IP per minute → `429` for the rest of the window. |
| Origin allow-list | `ALLOWED_ORIGINS` restricts CORS and WebSocket upgrades to your front-ends. |
| CSP, `nosniff`, `frame-ancestors 'none'` | Panel, docs, dialer and pairing pages are self-contained (no CDN) and cannot be embedded. No `unsafe-eval`. |
| Body limits | 64 KB per request (64 MB for message media), 2 MB per WebSocket frame. |
| Secrets masked in logs and UI | The manager never prints the full global key; `/manager/config` returns it masked; the panel hides tokens until you click *Show*. `manager.json` is written with mode `0600`. |
| One media source per call | Prevents a second client from injecting audio/video into a call it does not own. |
| Orphan cleanup | Chrome processes left behind by a crash are killed before a profile is reused. |
| Debug eval off | `POST /api/debug/eval` exists only with `DEBUG_EVAL=1` and only from the loopback. Never enable it in production. |

## Your responsibilities

- **Keep tokens in the backend.** Never ship an instance token to an end user's browser. If agents need direct WebSocket access, put your own short-lived credential and a proxy in front.
- **Protect `DATA_DIR`.** `instances/<name>/profile` **is** the WhatsApp session; `manager.json` and `instances.json` hold the key and the tokens. Back it up encrypted; never commit it; restrict file permissions.
- **Terminate TLS in front.** ZapCall speaks plain HTTP/WS on the loopback. Use a reverse proxy (Caddy, nginx, Traefik) for HTTPS/WSS and, ideally, an authenticated tunnel or VPN for administration.
- **Rotate on suspicion.** `POST /instance/token/:name` invalidates a token instantly; changing `ZAPCALL_API_KEY` and restarting rotates the global key.
- **Update Chrome.** The Docker image pulls Chrome stable at build time; rebuild regularly.

## Known limitations

- **Call ownership is declarative.** `owner` is the `x-client-id` the client sends. Any client holding the instance token may act on any `callId`. Per-agent authorization belongs in your backend.
- **No per-route rate limit** beyond authentication failures.
- **Chrome runs without sandbox inside the container** (`CHROME_NO_SANDBOX=1`) and with host networking. Run it on a dedicated host or VM with a restrictive firewall.
- **Depends on WhatsApp Web internals** for return media. A WhatsApp update can break calls; the failure mode is a connected but silent call with `nativeMedia.ready = false` in `/api/diag`.

## Reporting a vulnerability

See `SECURITY.md` in the repository. Please do not open public issues for security problems; include version, reproduction steps and impact, and never attach tokens, QR codes or session data.
