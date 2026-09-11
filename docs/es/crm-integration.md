# Integración con CRM

ZapCall se diseñó para vivir detrás de un CRM: el CRM es dueño de los usuarios, los permisos y el historial de conversaciones; ZapCall es dueño de la sesión de WhatsApp y de la media. Esta página es la forma recomendada de esa integración.

## Topología

```
Navegador (agente) ──HTTPS/WSS──▶ tu backend ──HTTP/WS (loopback o red privada)──▶ gestor ZapCall ──▶ instancias
```

- El **token de instancia** vive solo en tu backend. Los agentes se autentican en tu sistema; tu backend decide quién puede marcar desde qué instancia.
- Una **instancia por línea/canal** (soporte, ventas, facturación…). `channel` es una etiqueta libre que puedes mapear a tus propios ids.
- Deja ZapCall en el loopback o en una red privada. Si debe cruzar internet, usa un proxy inverso con TLS delante de `127.0.0.1:18475` y mantén `HOST=127.0.0.1`.

## Mapear estados a tu interfaz

| ZapCall | CRM |
|---|---|
| `connectionState.state = open` | línea disponible |
| `busy = true` / `409 channel_busy` | línea en uso — muestra *quién* (`call.phone`, `call.direction`) y desde cuándo (`call.acceptedAt`) |
| `incoming_call` | haz sonar a los agentes con derecho a esa línea; el primer `accept` gana |
| `call_active` | arranca el cronómetro (nunca con la media) |
| `call_ended` + `endReason` | `terminate` = habló; `missed`/`rejected`/`busy` = no contestada; `accepted_elsewhere` = contestada en el teléfono |
| `messages.upsert` | añade a la conversación; la media ≤ 2 MB viene inline en `base64` |

## Flujo recomendado para una llamada saliente

1. El backend comprueba que el agente puede usar la línea y consulta `GET /instance/connectionState/:nombre`. Si `busy`, le dice al agente quién está en la línea.
2. El backend hace `POST /call/offer/:nombre` con `x-client-id: <id de sesión del agente>`.
3. El backend abre (o ya tiene) un WebSocket con `clientId = <id de sesión del agente>` y reenvía la media al navegador del agente (o el navegador se conecta directamente a través de tu proxy con una credencial de corta duración tuya).
4. Al `call_ended`, persiste `startedAt`, `acceptedAt`, `endedAt`, `endReason` y, si grabaste, el audio.

## Grabación y transcripción

La media llega como PCM crudo 16 kHz mono en tramas de 60 ms — trivial de escribir en un WAV (16 bits little-endian, 16000 Hz, 1 canal) o de enviar en streaming a un servicio de transcripción. Mantén las dos direcciones en buffers separados si quieres grabaciones estéreo (agente a la izquierda, contacto a la derecha).

## Webhooks o WebSocket

- Los **webhooks** bastan para estado y mensajes: un `POST` por evento, con tres intentos, en el formato Evolution que tus handlers quizá ya entienden.
- El **WebSocket** es obligatorio para la **media** y entrega los mismos eventos con menos latencia. Los backends suelen usar ambos: webhook para estado duradero, socket para llamadas en vivo.

## Varias instancias

`GET /instance/fetchInstances` (clave global) devuelve todas las líneas con `state`, `busy` y `call`. Consúltalo cada pocos segundos para un panel de "líneas", o suscríbete al socket de cada instancia y mantén el estado en memoria.

## Viniendo de la Evolution API

Los nombres de ruta, cuerpos y formatos de webhook (`messages.upsert`, `connection.update`, `key`, `pushName`, `message.conversation`…) coinciden con la Evolution API, así que los handlers existentes se reutilizan cambiando la URL base. Lo nuevo: `/call/*`, la media binaria en el WebSocket y `busy`/`call` en `connectionState`.

## Lo que el CRM debe manejar

- **Una llamada por instancia.** Encola o enruta a otra instancia.
- **Un LID no es un teléfono.** `remoteJidAlt` (mensajes) y `phone` (llamadas) vienen rellenos cuando WhatsApp expone el número; si no, identifica al contacto por su LID.
- **El teléfono también suena.** Decide qué muestra tu interfaz cuando llega `accepted_elsewhere`.
- **Las sesiones se caen.** Observa `status` / `connection.update` y avisa a un administrador de que "la línea necesita vincularse".
