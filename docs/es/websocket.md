# WebSocket

Un socket por cliente entrega los **eventos** (tramas de texto JSON) y la **media de la llamada** (tramas binarias) de una instancia.

```
ws://127.0.0.1:18475/instances/:nombre/ws?clientId=<tu id>&token=<token de instancia>
```

- `clientId` identifica a tu cliente. Usa un id por pestaña del navegador o por proceso de backend — dos sockets con el mismo id enviando media a la misma llamada es la causa clásica de video congelado.
- Credenciales: `token` en la query string, o `Authorization: Bearer <token>` en header cuando el cliente puede enviar headers (backends, `ws` en Node).
- Con `ALLOWED_ORIGINS` definido, los navegadores de otros orígenes se rechazan con `403`.
- Límite por trama: 2 MB.

## Handshake

Justo después de conectar recibes un `hello`:

```json
{ "type": "hello",
  "status": { "connected": true, "jid": "34612345678@c.us", "pushName": "Ventas", "phone": "34612345678", "activeCalls": 0 },
  "calls": [ ] }
```

`calls` lista las llamadas que la instancia todavía recuerda, para que un cliente que reconecta a mitad de una llamada redibuje su interfaz.

## Tramas de texto (eventos)

Toda trama de texto es `{ "type": "<evento>", … }`. La lista completa, con los cuerpos, está en [Eventos](#events). Los eventos de llamada llevan `call` (un *call row*); `status` lleva `status`; los eventos de mensaje llevan `data`.

## Tramas binarias (media de la llamada)

Toda trama binaria tiene una cabecera de 4 bytes seguida del contenido:

| Byte | Campo | Valores |
|---|---|---|
| 0 | `kind` | `1` audio · `2` video |
| 1 | `flags` | bit 0 = keyframe (solo video) |
| 2 | `orientation` | 0–3 = rotación en múltiplos de 90° en sentido horario, a aplicar al dibujar (solo video) |
| 3 | reservado | `0` |

- **Audio**: PCM mono, **16 kHz**, Int16 little-endian, tramas de **exactamente 960 muestras** (60 ms, 1920 bytes). Cualquier otro tamaño se descarta en ambos extremos.
- **Video**: H.264 **Annex-B** (SPS/PPS dentro del keyframe). Del contacto recibes hasta 1280×720 a ~15 fps; lo que envías lo recodifica WhatsApp (el marcador de referencia envía 720p a 30 fps, ~2 Mbps).

La dirección es simétrica: las tramas que **envías** alimentan el micrófono/cámara virtual de la sesión de WhatsApp Web; las que **recibes** son la voz y el video del contacto.

## Dueño y varios clientes

- La media de retorno va a los sockets cuyo `clientId` es el **dueño** de la llamada (el `x-client-id` usado en `/call/offer` o `/call/accept`). Una llamada sin dueño (contestada en el teléfono) va a todos los sockets.
- La media de subida se acepta de **un socket por llamada**: el primer socket del dueño que envíe una trama se convierte en la fuente hasta que termina la llamada. Las tramas de otros sockets se cuentan en `GET /api/diag` (`servidor.descartes.midiaDeOutroSocket`) y se ignoran.

## Disciplina de keyframes

- Un decodificador recién creado (o recreado tras un error) debe esperar un keyframe e ignorar los deltas hasta entonces.
- Un emisor que tuvo que descartar un delta (cola llena) debe retener los deltas siguientes hasta el próximo keyframe, y debería pedir uno a su codificador.

## Reconexión

Los sockets son baratos: reconecta con retroceso, lee `hello.calls` y continúa. Las llamadas finalizadas siguen listadas hasta una hora para que un cliente tardío aún pueda mostrar qué pasó.

## Ejemplo en Node

```js
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:18475/instances/ventas/ws?clientId=mi-backend', { headers: { authorization: 'Bearer TOKEN_DE_INSTANCIA' } });
ws.binaryType = 'arraybuffer';
ws.on('message', (datos, binario) => {
  if (binario) { const kind = Buffer.from(datos)[0]; return; }      // 1 audio, 2 video
  const ev = JSON.parse(datos.toString());
  if (ev.type === 'call_active') console.log('contestada', ev.call.callId);
});
```
