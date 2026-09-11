# curl examples

Replace `GLOBAL_KEY`, `INSTANCE_TOKEN` and `sales` with yours. The base URL is the manager (`http://127.0.0.1:18475`).

## Administration (global key)

```bash
# Create an instance
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: GLOBAL_KEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"sales","channel":"Sales team"}'

# List instances with live state
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: GLOBAL_KEY"

# Rename the label, disable, set a webhook — any subset
curl -X POST http://127.0.0.1:18475/instance/update/sales \
  -H "apikey: GLOBAL_KEY" -H "Content-Type: application/json" \
  -d '{"channel":"Billing","webhook":{"url":"https://example.com/zapcall","events":["incoming_call","call_ended"]}}'

# Rotate the token (the old one stops working; the instance restarts)
curl -X POST http://127.0.0.1:18475/instance/token/sales -H "apikey: GLOBAL_KEY"

# Delete, wiping the paired session too
curl -X DELETE "http://127.0.0.1:18475/instance/delete/sales?purge=1" -H "apikey: GLOBAL_KEY"
```

## Pairing

```bash
# QR as base64 PNG + terminal art
curl http://127.0.0.1:18475/instance/connect/sales -H "apikey: INSTANCE_TOKEN"

# Draw it in the terminal (needs jq)
curl -s http://127.0.0.1:18475/instance/connect/sales -H "apikey: INSTANCE_TOKEN" | jq -r .ansi

# State
curl http://127.0.0.1:18475/instance/connectionState/sales -H "apikey: INSTANCE_TOKEN"
```

## Calls (instance token)

```bash
# Voice call
curl -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "x-client-id: my-backend" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","isVideo":false}'

# Video call
curl -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "x-client-id: my-backend" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","isVideo":true}'

# Second call while busy → 409 channel_busy
curl -i -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" -d '{"number":"15557654321"}'

# Accept / reject / mute / hang up
curl -X POST http://127.0.0.1:18475/call/accept/sales -H "apikey: INSTANCE_TOKEN" -H "x-client-id: my-backend" -H "Content-Type: application/json" -d '{"callId":"3EB0…","video":false}'
curl -X POST http://127.0.0.1:18475/call/reject/sales -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'
curl -X POST http://127.0.0.1:18475/call/mute/sales   -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" -d '{"callId":"3EB0…","muted":true}'
curl -X POST http://127.0.0.1:18475/call/hangup/sales -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'

# Known calls
curl http://127.0.0.1:18475/call/status/sales -H "apikey: INSTANCE_TOKEN"
```

## Messages

```bash
curl -X POST http://127.0.0.1:18475/message/sendText/sales \
  -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","text":"Hello! May I call you?"}'

curl -X POST http://127.0.0.1:18475/message/sendMedia/sales \
  -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"number\":\"15551234567\",\"mediatype\":\"image\",\"mimetype\":\"image/jpeg\",\"caption\":\"Invoice\",\"fileName\":\"invoice.jpg\",\"media\":\"$(base64 -i invoice.jpg)\"}"

curl -X POST http://127.0.0.1:18475/chat/whatsappNumbers/sales \
  -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" \
  -d '{"numbers":["15551234567"]}'
```

## Webhook

```bash
curl -X POST http://127.0.0.1:18475/webhook/set/sales \
  -H "apikey: INSTANCE_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/zapcall","enabled":true,"events":[]}'

curl http://127.0.0.1:18475/webhook/find/sales -H "apikey: INSTANCE_TOKEN"
```

## Health and diagnostics

```bash
curl -i http://127.0.0.1:18475/healthz
curl http://127.0.0.1:18475/manager/system -H "apikey: GLOBAL_KEY"
curl -X POST http://127.0.0.1:18475/manager/instances/sales/selftest -H "apikey: GLOBAL_KEY"
curl http://127.0.0.1:18475/instances/sales/api/diag -H "Authorization: Bearer INSTANCE_TOKEN"

# A fake incoming call, to exercise your client's UI without ringing anyone
curl -X POST http://127.0.0.1:18475/instances/sales/api/debug/fake-incoming \
  -H "Authorization: Bearer INSTANCE_TOKEN" -H "Content-Type: application/json" -d '{"video":false}'
```

## WebSocket from the shell

With [websocat](https://github.com/vi/websocat):

```bash
websocat "ws://127.0.0.1:18475/instances/sales/ws?clientId=shell&token=INSTANCE_TOKEN"
```

Text lines are events; binary frames are media (websocat prints them as raw bytes — use a real client for audio).
