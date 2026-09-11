# Status

Three levels of "is it working?": the manager, each instance, and each call.

## Manager

| Route | Auth | Result |
|---|---|---|
| `GET /healthz` | none | `200 { ok: true, instances, healthy, uptime }` when every **enabled** instance answers; `503` otherwise. This is what the Docker healthcheck polls. |
| `GET /manager/system` | global | CPUs, 1/5/15-minute load, free memory, free disk, manager RAM, and per instance: Node RAM, number of Chrome processes, Chrome RAM and CPU. |
| `GET /manager/config` | global | Effective configuration: port, data dir, port base, key origin (env or file) and the key **masked**, Chrome path, allowed origins, default country code. |

## Instance

`GET /instance/connectionState/:name` (token) or `GET /manager/instances/:name/status` (global):

| Field | Meaning |
|---|---|
| `state` | `open` paired · `connecting` running but not paired (QR) or still booting · `close` process stopped |
| `running` / `pid` / `uptime` | The instance process. A child killed by a signal counts as **not** running. |
| `healthy` | The instance API answered `/api/status`. |
| `connected` / `phone` / `pushName` | The WhatsApp session. |
| `busy` / `activeCalls` / `call` | Whether a call is in progress and its call row. `maxCalls` is always `1`. |

State machine of an instance, as the panel shows it:

```
Disabled  →  (enable)  →  Starting  →  Waiting for QR  →  (scan)  →  Free  ⇄  On a call
    ↑                                                                    │
    └──────────────────────── (disable / process died) ──────────────────┘
```

## Call

`GET /call/status/:name` returns every call row the instance remembers. Live changes arrive as [events](#events). The decisive transitions:

- `ringing → active`: answered. `acceptedAt` is set **by WhatsApp Web's own state**, never by media starting to flow.
- `→ ended`: `endReason` tells you whether anyone answered: `terminate` (hung up after talking), `rejected`, `missed`, `busy`, `accepted_elsewhere` (answered on another device), `connection_lost`, `relay_failed`.

## Media diagnostics

`GET /instances/:name/api/diag` (token) dumps the state of the injected page:

- `diag.zapcall.ganchos` — the three browser-API hooks (`getUserMedia`, `enumerateDevices`, `rtcPeerConnection`) must be `true`.
- `diag.zapcall.ponte` — the page↔server bridge: `aberta`, frames sent/received, dropped audio/video.
- `diag.zapcall.nativeMedia` — the adapter that captures return voice/video: `ready`, `faltando` (missing modules after a WhatsApp Web update), `error`.
- `diag.zapcall.worklets` — `ok` or `ausente`: the audio worklets were injected.
- `diag.zapcall.mic` / `cam` / `remoto` — frame counters, peak levels, fps, decoder errors.
- `servidor.fonteMidia` / `servidor.descartes` — which client is feeding the call and how many frames from other sockets were dropped.

The **Diagnostics › Self-test** in the panel (or `POST /manager/instances/:name/selftest`) checks all of this in one shot and reports each item as pass/fail with a detail string.

## Logs

The manager keeps the last 200 lines of each instance's stdout/stderr: `GET /manager/instances/:name/logs`, or the **Logs** tab in the panel (live, filterable). With `VERBOSE=1` (the default in Docker) the same lines are printed to the manager's stdout prefixed with `[<instance>]`.
