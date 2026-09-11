# Creating instances

An **instance** is one WhatsApp Web session: its own Chrome, its own profile directory, its own token and **one call at a time** (a WhatsApp Web rule, not a ZapCall choice). Several numbers = several instances, all behind the same manager.

## From the panel

**Instances › New instance**. Fields:

| Field | Rules |
|---|---|
| Name | Goes in the URL and the data directory: `a-z`, `0-9`, `-`, `_`, up to 32 characters, starting with a letter or digit. |
| Label | Free text shown in the panel (`Sales team`). Optional. |
| Webhook | URL that receives events as `POST`. Optional; can be set later. |

After creating, the pairing dialog opens automatically.

## From the API

Evolution-style route (global key required):

```bash
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: YOUR_GLOBAL_KEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"sales","channel":"Sales team","webhook":"https://example.com/zapcall"}'
```

```json
{ "instance": { "instanceName": "sales", "state": "connecting", "connected": false, "busy": false, "port": 18500, "…": "…" },
  "hash": { "apikey": "INSTANCE_TOKEN" } }
```

`hash.apikey` is the **instance token**: the only credential your integration needs. Store it in your backend.

The manager-style equivalent is `POST /manager/instances` with `{ "name", "channel" }` and returns `{ "instance": { …, "token" } }`.

## Pairing

Pairing links the instance to a phone number. The QR rotates every ~20 s.

- **Panel**: *Pair* on the instance row or in its detail drawer.
- **API**: `GET /instance/connect/:name` returns `{ code, base64, ansi }` — `base64` is a ready `<img src>`, `ansi` draws the QR in a terminal.
- **Pairing page**: `/instances/:name/pair?token=INSTANCE_TOKEN` (the token is moved out of the URL as soon as the page loads).

Once paired, the session survives restarts: it lives in `DATA_DIR/instances/<name>/profile`.

## Lifecycle

| Action | Panel | API |
|---|---|---|
| Restart the Chrome (keeps the session) | *Restart* | `POST /instance/restart/:name` |
| Disable / enable (stop the process) | Danger zone | `POST /instance/update/:name` `{ "enabled": false }` |
| Unpair (wipe session, back to QR) | Danger zone › *Unpair* | `DELETE /instance/logout/:name` |
| Rotate the token | Danger zone › *Generate another token* | `POST /instance/token/:name` |
| Delete | Danger zone › *Delete* (type the name) | `DELETE /instance/delete/:name` (`?purge=1` also wipes the session) |

If an instance's Chrome dies, the manager restarts it with exponential back-off (2 s … 60 s). Orphaned Chrome processes still holding the profile are killed before a new one starts.

## Capacity

Each instance costs one of the phone's linked-device slots (WhatsApp allows four) and ~1 GB of RAM. The **Diagnostics** tab shows the footprint of each Chrome; above ~1.5 GB per instance or with less than 15 % free memory, do not add instances on that machine.
