# Ejemplos con curl

Sustituye `CLAVE_GLOBAL`, `TOKEN_DE_INSTANCIA` y `ventas` por los tuyos. La URL base es el gestor (`http://127.0.0.1:18475`).

## Administración (clave global)

```bash
# Crear una instancia
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: CLAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"ventas","channel":"Equipo comercial"}'

# Listar instancias con estado en vivo
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: CLAVE_GLOBAL"

# Cambiar la etiqueta, desactivar, definir webhook — cualquier subconjunto
curl -X POST http://127.0.0.1:18475/instance/update/ventas \
  -H "apikey: CLAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"channel":"Facturación","webhook":{"url":"https://ejemplo.com/zapcall","events":["incoming_call","call_ended"]}}'

# Rotar el token (el antiguo deja de valer; la instancia se reinicia)
curl -X POST http://127.0.0.1:18475/instance/token/ventas -H "apikey: CLAVE_GLOBAL"

# Eliminar, borrando también la sesión vinculada
curl -X DELETE "http://127.0.0.1:18475/instance/delete/ventas?purge=1" -H "apikey: CLAVE_GLOBAL"
```

## Vinculación

```bash
# QR como PNG base64 + arte de terminal
curl http://127.0.0.1:18475/instance/connect/ventas -H "apikey: TOKEN_DE_INSTANCIA"

# Dibujarlo en la terminal (necesita jq)
curl -s http://127.0.0.1:18475/instance/connect/ventas -H "apikey: TOKEN_DE_INSTANCIA" | jq -r .ansi

# Estado
curl http://127.0.0.1:18475/instance/connectionState/ventas -H "apikey: TOKEN_DE_INSTANCIA"
```

## Llamadas (token de instancia)

```bash
# Llamada de voz
curl -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: mi-backend" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","isVideo":false}'

# Videollamada
curl -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: mi-backend" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","isVideo":true}'

# Segunda llamada con la línea ocupada → 409 channel_busy
curl -i -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" -d '{"number":"34698765432"}'

# Contestar / rechazar / silenciar / colgar
curl -X POST http://127.0.0.1:18475/call/accept/ventas -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: mi-backend" -H "Content-Type: application/json" -d '{"callId":"3EB0…","video":false}'
curl -X POST http://127.0.0.1:18475/call/reject/ventas -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'
curl -X POST http://127.0.0.1:18475/call/mute/ventas   -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…","muted":true}'
curl -X POST http://127.0.0.1:18475/call/hangup/ventas -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'

# Llamadas conocidas
curl http://127.0.0.1:18475/call/status/ventas -H "apikey: TOKEN_DE_INSTANCIA"
```

## Mensajes

```bash
curl -X POST http://127.0.0.1:18475/message/sendText/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","text":"¡Hola! ¿Puedo llamarte?"}'

curl -X POST http://127.0.0.1:18475/message/sendMedia/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" \
  -d "{\"number\":\"34612345678\",\"mediatype\":\"image\",\"mimetype\":\"image/jpeg\",\"caption\":\"Factura\",\"fileName\":\"factura.jpg\",\"media\":\"$(base64 -i factura.jpg)\"}"

curl -X POST http://127.0.0.1:18475/chat/whatsappNumbers/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"numbers":["34612345678"]}'
```

## Webhook

```bash
curl -X POST http://127.0.0.1:18475/webhook/set/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"url":"https://ejemplo.com/zapcall","enabled":true,"events":[]}'

curl http://127.0.0.1:18475/webhook/find/ventas -H "apikey: TOKEN_DE_INSTANCIA"
```

## Salud y diagnóstico

```bash
curl -i http://127.0.0.1:18475/healthz
curl http://127.0.0.1:18475/manager/system -H "apikey: CLAVE_GLOBAL"
curl -X POST http://127.0.0.1:18475/manager/instances/ventas/selftest -H "apikey: CLAVE_GLOBAL"
curl http://127.0.0.1:18475/instances/ventas/api/diag -H "Authorization: Bearer TOKEN_DE_INSTANCIA"

# Una llamada entrante FALSA, para ejercitar la UI de tu cliente sin llamar a nadie
curl -X POST http://127.0.0.1:18475/instances/ventas/api/debug/fake-incoming \
  -H "Authorization: Bearer TOKEN_DE_INSTANCIA" -H "Content-Type: application/json" -d '{"video":false}'
```

## WebSocket desde la terminal

Con [websocat](https://github.com/vi/websocat):

```bash
websocat "ws://127.0.0.1:18475/instances/ventas/ws?clientId=shell&token=TOKEN_DE_INSTANCIA"
```

Las líneas de texto son eventos; las tramas binarias son media (websocat las imprime como bytes crudos — usa un cliente real para el audio).
