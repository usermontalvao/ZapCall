# Authentication

ZapCall has two credentials with two scopes. Both are sent in a header — `apikey: …` or `Authorization: Bearer …`.

| Credential | Scope | Where it lives |
|---|---|---|
| **Global key** | Everything: create, delete, list instances, read tokens, the panel, `/manager/*`, `/instance/*`. | `ZAPCALL_API_KEY`, or generated on first boot into `DATA_DIR/manager.json`. |
| **Instance token** | One instance only: calls, messages, events, its QR and its state. | Created with the instance; shown in the panel (API tab); rotated with `POST /instance/token/:name`. |

## Rules

- The **global key is never accepted in a URL**. It would end up in browser history, proxy logs and `Referer` headers. Requests with `?token=<global key>` get `401`.
- The **instance token may go in the URL** only where a browser cannot send a header: the WebSocket (`/instances/:name/ws?token=…`), the dialer and the pairing page. Those pages remove the token from the address bar immediately and every response carries `Referrer-Policy: no-referrer`.
- Comparison is **constant-time**. Twenty failed attempts from the same IP within a minute return `429 too_many_attempts` for every request from that IP (even valid ones) until the window passes.
- The panel keeps the global key in the browser's `localStorage` and always sends it as a header. Signing out forgets it.

## Examples

```bash
# Global key (administration)
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: YOUR_GLOBAL_KEY"

# Instance token (integration)
curl http://127.0.0.1:18475/instance/connectionState/sales -H "apikey: INSTANCE_TOKEN"
curl http://127.0.0.1:18475/instance/connectionState/sales -H "Authorization: Bearer INSTANCE_TOKEN"
```

## Which one should my integration use?

The **instance token**. Keep it in your backend and authenticate your own users there. The token is all-or-nothing for that instance (dial, answer, listen, read and send messages), so it must never be shipped to the end user's browser. If you need a browser client, proxy the WebSocket through your backend or open a short-lived session on your side.

## Restricting origins

If a browser client will connect directly, set `ALLOWED_ORIGINS` to a comma-separated list of origins. With the list set, `Origin` headers outside it are rejected (`403`) on HTTP and on the WebSocket upgrade, and the open `Access-Control-Allow-Origin: *` is dropped. Requests without `Origin` (curl, backends) are unaffected.
