# Environment variables

All variables are optional. The manager reads them at boot and passes the relevant ones to each instance process.

## Manager

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `18475` | Port of the manager (API + panel). |
| `HOST` | `127.0.0.1` | Bind address. Keep on loopback with Docker host networking. |
| `ZAPCALL_API_KEY` | *(generated)* | Global key. Empty = generated on first boot and stored in `DATA_DIR/manager.json` (mode `0600`). |
| `DATA_DIR` | `./data` (`/data` in Docker) | Registry, key and paired sessions. The volume to preserve. |
| `INSTANCE_PORT_BASE` | `18500` | First loopback port for instances; each instance takes the next free one. |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated browser origins allowed on CORS and WebSocket (`https://crm.example.com`). Empty = any origin. |
| `DEFAULT_COUNTRY_CODE` | *(none)* | Country code prepended to 10–11-digit numbers (`55`, `1`, `34`…). Empty = national numbers are rejected. |
| `VERBOSE` | `1` | Print instance logs on the manager's stdout (they are always available in the panel). |
| `CHROME_PATH` | *(autodetected)* | Chrome binary. Must be Chrome (H.264), not Chromium. |
| `CHROME_NO_SANDBOX` | `0` (`1` in Docker) | Adds `--no-sandbox` for containers without user namespaces. |
| `ZAPCALL_VIDEO_PROFILE` | `realtime` | `realtime` = 640×360/24 fps/650 kbps (hosting); `balanced` = 960×540/24; `hd` = 1280×720/30. |
| `ZAPCALL_VIDEO_WIDTH`, `ZAPCALL_VIDEO_HEIGHT`, `ZAPCALL_VIDEO_FPS`, `ZAPCALL_VIDEO_BITRATE` | *(profile)* | Optional overrides. Use only after measuring CPU, upload and `GET /api/diag`. |
| `CHROME_DISABLE_DEV_SHM_USAGE` | `0` | `1` makes Chrome use `/tmp`; leave `0` with the recommended `shm_size: 1gb`. |

## Instance (set by the manager; relevant with `npm run start:single`)

| Variable | Default | Purpose |
|---|---|---|
| `ZAPCALL_TOKEN` | *(instance token)* | Bearer token of the instance API. Empty = open API (single mode only; never in production). |
| `PROFILE_DIR` | `./data/profile` | Chrome profile directory = the paired session. |
| `HEADFUL` | `0` | `1` shows the Chrome window (development on a desktop). |
| `QR_TERMINAL` | `1` (`0` under the manager) | Print pairing QRs on stdout. |
| `QR_MAX` | `30` | Stop printing after this many unscanned QRs. |
| `QR_STALE_MS` | `180000` | Safety net: reload the page if no fresh QR appeared for this long. |
| `DEBUG_EVAL` | `0` | `1` enables `POST /api/debug/eval` (code execution in the session) from the loopback only. Never in production. |
| `ZAPCALL_PARENT_PID` | *(set by the manager)* | The instance exits if this process disappears, so no orphaned Chrome survives a crashed manager. |

## Docker-only

| Variable | Default | Purpose |
|---|---|---|
| `DISPLAY` | `:99` | Xvfb display. |
| `VNC` | `0` | `1` starts `x11vnc` on `127.0.0.1:5900`. |

## Example `.env`

```bash
PORT=18475
HOST=127.0.0.1
ZAPCALL_API_KEY=replace-with-a-long-random-string
DATA_DIR=/data
INSTANCE_PORT_BASE=18500
DEFAULT_COUNTRY_CODE=55
ALLOWED_ORIGINS=https://crm.example.com
VERBOSE=1
ZAPCALL_VIDEO_PROFILE=realtime
```

Generate a key: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
