# Llamadas de audio

## Cómo fluye la voz

```
tu cliente ──PCM 16 kHz──▶ gestor ──▶ instancia ──▶ página de WhatsApp Web (micrófono virtual) ──▶ WhatsApp
tu cliente ◀──PCM 16 kHz── gestor ◀── instancia ◀── página de WhatsApp Web (adaptador de audio de retorno) ◀── WhatsApp
```

Dentro de la página de WhatsApp Web, ZapCall sustituye `getUserMedia` por un micrófono virtual alimentado por las tramas que envías, y captura la voz del contacto en la ruta de reproducción de audio de la página. Ambos lados usan el mismo formato de 16 kHz / 960 muestras descrito en [WebSocket](#websocket).

## Hacer una llamada

```bash
curl -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: agente-42" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","isVideo":false}'
# → {"callId":"3EB0…"}
```

Luego, en un WebSocket abierto con `clientId=agente-42`:

1. Espera el `call_active` (el contacto contestó). No arranques el cronómetro con `outgoing_call`.
2. Empieza a enviar tramas de audio (kind `1`) y a reproducir las que recibes.
3. `POST /call/hangup/:nombre` con el `callId` para terminar; `call_ended` lo confirma.

Envía audio en cuanto la llamada esté `active`; las tramas enviadas mientras suena se aceptan pero nadie las oye.

## Recibir una llamada

`incoming_call` llega con `direction: "inbound"`. Contesta con `POST /call/accept/:nombre` `{ "callId" }` usando el mismo `x-client-id` que tu socket, para que la media se enrute hacia ti. O rechaza con `/call/reject/:nombre`.

La llamada también suena en el teléfono: si alguien contesta allí primero recibes `call_ended` con `endReason: "accepted_elsewhere"`.

## Silencio

`POST /call/mute/:nombre` `{ "callId", "muted": true }` hace que la página deje de reenviar tus tramas (puedes seguir enviando; se descartan). `muted: false` reanuda. El call row lo refleja en `muted`.

## Notas de calidad

- Las tramas son de 60 ms: mantén el envío regular (una trama cada 60 ms). El receptor tiene un buffer de jitter con objetivo de 120 ms que se reduce por encima de 240 ms.
- La cola de subida es corta a propósito: si el socket acumula más de ~6 tramas de audio, las nuevas se descartan en lugar de retrasarse. Una trama tardía vale menos que una perdida.
- Activa la cancelación de eco en la captura (`echoCancellation: true` en `getUserMedia`); el marcador de referencia lo hace.
- Un pico (`estado.pico` en el marcador, `remoto.pico` en `/api/diag`) por encima de ~300 es voz; ~0 es silencio o una ruta rota.

## El marcador de referencia

`/instances/:nombre/dialer?token=TOKEN_DE_INSTANCIA` es un cliente completo de voz/video en un solo HTML (`src/page/dialer.html`): worklets de WebAudio para captura y reproducción, WebCodecs para video, sin dependencias. Habla exactamente la misma API que usará tu integración, por eso es el banco de pruebas: lo que funciona ahí funciona en tu cliente.

Ábrelo desde el panel (*Marcador* en una instancia vinculada). El token sale de la URL en cuanto carga la página.
