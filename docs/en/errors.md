# Errors

Every error is JSON: `{ "error": "<code>", "message": "<human text>" }`, sometimes with extra fields (`call` on `channel_busy`, `motivo` on `numero_invalido`).

| HTTP | `error` | Meaning | What to do |
|---|---|---|---|
| 400 | `missing_to`, `missing_callId`, `missing_action`, `invalid_name`, `invalid_webhook` | Body incomplete or invalid. | Fix the request; `message` explains. |
| 400 | `numero_invalido` | The number cannot be normalized. `motivo` says why (e.g. no `DEFAULT_COUNTRY_CODE` for a national number). | Send the full number with country code, or set `DEFAULT_COUNTRY_CODE`. |
| 401 | `unauthorized` | No credential, wrong credential, global key in a URL, or a token used on another instance. | Check [Authentication](#authentication). |
| 403 | `origin_not_allowed` | The browser `Origin` is not in `ALLOWED_ORIGINS`. | Add the origin or call from a backend. |
| 404 | `instance_not_found`, `call_not_found`, `not_found` | Unknown instance name, `callId` or route. | — |
| 405 | `method_not_allowed` | Wrong HTTP method on a message/chat route. | — |
| 409 | `channel_busy` | The instance is already on a call. `call` carries the current call row. | Wait for `call_ended`, or use another instance. |
| 409 | `not_paired` | No WhatsApp session. | Pair by QR. |
| 409 | `already_exists` | Instance name taken. | — |
| 413 | `payload_too_large` | Body over 64 KB (or 64 MB for message media). | — |
| 429 | `too_many_attempts` | 20+ authentication failures from this IP in a minute. Blocks **every** request from the IP for the rest of the window. | Stop retrying with wrong credentials; wait a minute. |
| 500 | `falha` | Unexpected error; `message` has the reason. | Open an issue with the log lines. |
| 501 | `video_upgrade_nao_implementado` | Enabling video on a voice call after it started. | Offer/accept the call with `isVideo: true`. |
| 502 | `sem_chamada` | WhatsApp Web accepted the offer but no call appeared; `motivo` has the page's reason (number not on WhatsApp, blocked, etc.). | Check `motivo`. |
| 502 | `wa_error` | WhatsApp Web refused a message/chat action. | `message` has the reason. |
| 502 | `instance_unreachable` | The instance process did not answer the manager. | It is probably restarting; retry in a few seconds. |
| 503 | `instance_stopped` | Instance disabled or its process is down. | Enable it / wait for the automatic restart. |
| 503 | `browser_not_ready` | Chrome is still starting. | Retry. |
| 504 | `timeout` | The WhatsApp page did not answer the action in time (20 s dial, 15 s accept, 10 s reject/hangup, 60 s messages). | Retry; if it persists, restart the instance. |

## Silent failures worth knowing

- **Connected but mute call** with `nativeMedia.ready = false` in `/api/diag`: a WhatsApp Web update changed the private module names the adapter relies on. `faltando` lists what was not found. Restart the instance first; if it persists, open an issue including that list.
- **Video freezing on the phone**: check `servidor.descartes.midiaDeOutroSocket` — two clients were feeding the same call. Use one `clientId` per tab/process.
- **Instance stuck in "Waiting for QR" forever**: the phone must be online and the number may already have four linked devices. Unpair an old device on the phone.
- **Instance listed as running after a restart but not answering**: the Chrome profile may be held by an orphaned Chrome. The manager kills orphans before starting a new one; check the Logs tab for `orfao`.
