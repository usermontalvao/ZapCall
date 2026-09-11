# Errores

Todo error es JSON: `{ "error": "<código>", "message": "<texto>" }`, a veces con campos extra (`call` en `channel_busy`, `motivo` en `numero_invalido`).

| HTTP | `error` | Significado | Qué hacer |
|---|---|---|---|
| 400 | `missing_to`, `missing_callId`, `missing_action`, `invalid_name`, `invalid_webhook` | Cuerpo incompleto o inválido. | Corrige la petición; `message` lo explica. |
| 400 | `numero_invalido` | El número no se pudo normalizar. `motivo` dice por qué (p. ej. sin `DEFAULT_COUNTRY_CODE` para un número nacional). | Envía el número completo con código de país, o define `DEFAULT_COUNTRY_CODE`. |
| 401 | `unauthorized` | Sin credencial, credencial errónea, clave global en una URL, o token usado en otra instancia. | Consulta [Autenticación](#authentication). |
| 403 | `origin_not_allowed` | El `Origin` del navegador no está en `ALLOWED_ORIGINS`. | Añade el origen o llama desde un backend. |
| 404 | `instance_not_found`, `call_not_found`, `not_found` | Nombre de instancia, `callId` o ruta desconocidos. | — |
| 405 | `method_not_allowed` | Método HTTP incorrecto en una ruta de mensaje/chat. | — |
| 409 | `channel_busy` | La instancia ya está en una llamada. `call` trae el call row actual. | Espera el `call_ended`, o usa otra instancia. |
| 409 | `not_paired` | Sin sesión de WhatsApp. | Vincula por QR. |
| 409 | `already_exists` | Nombre de instancia repetido. | — |
| 413 | `payload_too_large` | Cuerpo por encima de 64 KB (o 64 MB para media de mensaje). | — |
| 429 | `too_many_attempts` | 20+ fallos de autenticación desde esta IP en un minuto. Bloquea **toda** petición de la IP durante el resto de la ventana. | Deja de reintentar con credenciales erróneas; espera un minuto. |
| 500 | `falha` | Error inesperado; `message` tiene la causa. | Abre un issue con las líneas de log. |
| 501 | `video_upgrade_nao_implementado` | Activar video en una llamada de voz ya iniciada. | Ofrece/contesta la llamada con `isVideo: true`. |
| 502 | `sem_chamada` | WhatsApp Web aceptó la oferta pero no apareció ninguna llamada; `motivo` trae la razón de la página (número sin WhatsApp, bloqueado, etc.). | Lee `motivo`. |
| 502 | `wa_error` | WhatsApp Web rechazó una acción de mensaje/chat. | `message` tiene la razón. |
| 502 | `instance_unreachable` | El proceso de la instancia no respondió al gestor. | Probablemente se está reiniciando; reintenta en unos segundos. |
| 503 | `instance_stopped` | Instancia desactivada o proceso caído. | Actívala / espera el reinicio automático. |
| 503 | `browser_not_ready` | Chrome todavía está arrancando. | Reintenta. |
| 504 | `timeout` | La página de WhatsApp no respondió a la acción a tiempo (20 s marcar, 15 s contestar, 10 s rechazar/colgar, 60 s mensajes). | Reintenta; si persiste, reinicia la instancia. |

## Fallos silenciosos que conviene conocer

- **Llamada conectada pero muda** con `nativeMedia.ready = false` en `/api/diag`: una actualización de WhatsApp Web cambió los nombres de los módulos privados de los que depende el adaptador. `faltando` lista lo que no se encontró. Reinicia la instancia primero; si persiste, abre un issue con esa lista.
- **Video congelado en el teléfono**: mira `servidor.descartes.midiaDeOutroSocket` — dos clientes alimentaban la misma llamada. Usa un `clientId` por pestaña/proceso.
- **Instancia atascada en "Esperando QR" para siempre**: el teléfono debe estar en línea y el número puede tener ya cuatro dispositivos vinculados. Desvincula un dispositivo antiguo en el teléfono.
- **Instancia listada como en marcha tras un reinicio pero sin responder**: el perfil de Chrome puede estar retenido por un Chrome huérfano. El gestor mata a los huérfanos antes de arrancar uno nuevo; busca `orfao` en la pestaña Logs.
