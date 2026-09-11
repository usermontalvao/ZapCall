# Videollamadas

El video viaja por el mismo WebSocket que el audio, como tramas binarias con `kind = 2`.

## Ofrecer y contestar con video

```bash
curl -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: agente-42" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","isVideo":true}'
```

Contestar una invitación de **video** entrante: `POST /call/accept/:nombre` `{ "callId", "video": true }`. Acéptala *con* video desde el principio — subir una llamada de voz a video después suele ser rechazado por WhatsApp (`501 video_upgrade_nao_implementado` de nuestro lado).

Una llamada de voz que el **contacto** convierte en video sí funciona: la primera trama de video llega con `kind = 2` y tu cliente debe crear su decodificador bajo demanda (el marcador de referencia lo hace).

## Enviar video

- Códec: H.264 Baseline, byte stream **Annex-B**, SPS/PPS dentro de cada keyframe.
- Elige el *nivel* de H.264 según la resolución: `avc1.42E01E` (3.0) solo cubre hasta 720×576; usa `avc1.42E01F` (3.1) para 720p y `avc1.42E028` (4.0) para 1080p. Un nivel equivocado hace que `VideoEncoder.configure` lance una excepción y no envíes nada.
- El marcador de referencia usa por defecto el perfil `realtime`: 640×360 @ 24 fps, 650 kbps, keyframe cada 1 s y `latencyMode: 'realtime'`. `balanced` y `hd` son opciones explícitas de entorno.
- Mantén las colas del codificador y decodificador en 2 tramas como máximo. Tras descartar cualquier trama, fuerza un keyframe; una petición `media-control` lo hace de inmediato.

La página de WhatsApp Web decodifica el stream, cadencia solo la trama más reciente en una cámara virtual limitada por el perfil y WhatsApp lo recodifica. El límite evita dos transcodificaciones 720p/30 simultáneas en una VPS.

## Recibir video

- Las tramas llegan en H.264 Annex-B, hasta 1280×720 a ~15 fps.
- El byte 2 de la cabecera es la **orientación** (0–3 × 90° horario): el teléfono gira sin cambiar el tamaño de la trama, así que aplica la rotación al dibujar, según la cabecera de la trama más reciente.
- Tras crear (o recrear) tu decodificador, espera un keyframe (`flags & 1`) e ignora los deltas hasta entonces. Un error fatal de `VideoDecoder` lo cierra definitivamente: crea uno nuevo.

## Diagnóstico

| Síntoma | Dónde mirar |
|---|---|
| El contacto ve negro | `GET /api/diag` → `cam.quadros` debe crecer; `cam.erros` y `cam.descartadosSemKeyframe` no. |
| El contacto ve video entrecortado | Revisa `cam.fps`, `cam.descartadosDecoder`, `servidor.descartes.videoPorFila` y `videoSemKeyframe`. Se descarta el pasado en vez de acumular retraso. |
| La CPU sigue alta después | `cam.ativa` debe volver a `false`; streams, decoder, frame y timer se cierran al terminar. |
| No ves nada | `remoto.video` true y `remoto.quadrosCodificados` creciendo significan que las tramas salen de la página; revisa tu decodificador/keyframes. |
| Video de lado | Aplica el byte 2 de la cabecera al dibujar. |

## Ancho de banda

Con `realtime`, reserva unos 650 kbps de subida para la cámara y 0,5–1,5 Mbps de bajada para el contacto, más ~256 kbps de audio PCM en cada sentido. `hd` usa hasta 1,8 Mbps de subida.
