# Estado

Tres niveles de "¿funciona?": el gestor, cada instancia y cada llamada.

## Gestor

| Ruta | Auth | Resultado |
|---|---|---|
| `GET /healthz` | ninguna | `200 { ok: true, instances, healthy, uptime }` cuando toda instancia **activada** responde; `503` en caso contrario. Es lo que consulta el healthcheck de Docker. |
| `GET /manager/system` | global | CPUs, carga de 1/5/15 minutos, memoria libre, disco libre, RAM del gestor y, por instancia: RAM de Node, número de procesos de Chrome, RAM y CPU de Chrome. |
| `GET /manager/config` | global | Configuración efectiva: puerto, directorio de datos, base de puertos, origen de la clave (env o archivo) y la clave **enmascarada**, ruta de Chrome, orígenes permitidos, código de país por defecto. |

## Instancia

`GET /instance/connectionState/:nombre` (token) o `GET /manager/instances/:nombre/status` (global):

| Campo | Significado |
|---|---|
| `state` | `open` vinculada · `connecting` en marcha pero sin sesión (QR) o aún arrancando · `close` proceso detenido |
| `running` / `pid` / `uptime` | El proceso de la instancia. Un hijo muerto por señal cuenta como **no** en marcha. |
| `healthy` | La API de la instancia respondió `/api/status`. |
| `connected` / `phone` / `pushName` | La sesión de WhatsApp. |
| `busy` / `activeCalls` / `call` | Si hay una llamada en curso y su call row. `maxCalls` siempre es `1`. |

Máquina de estados de una instancia, tal como la muestra el panel:

```
Desactivada  →  (activar)  →  Iniciando  →  Esperando QR  →  (escanear)  →  Libre  ⇄  En llamada
     ↑                                                                         │
     └──────────────────────── (desactivar / proceso murió) ───────────────────┘
```

## Llamada

`GET /call/status/:nombre` devuelve todos los call rows que la instancia recuerda. Los cambios en vivo llegan como [eventos](#events). Las transiciones decisivas:

- `ringing → active`: contestada. `acceptedAt` lo fija **el propio estado de WhatsApp Web**, nunca el inicio del flujo de media.
- `→ ended`: `endReason` te dice si alguien contestó: `terminate` (colgó tras hablar), `rejected`, `missed`, `busy`, `accepted_elsewhere` (contestada en otro dispositivo), `connection_lost`, `relay_failed`.

## Diagnóstico de media

`GET /instances/:nombre/api/diag` (token) vuelca el estado de la página inyectada:

- `diag.zapcall.ganchos` — los tres ganchos de API del navegador (`getUserMedia`, `enumerateDevices`, `rtcPeerConnection`) deben ser `true`.
- `diag.zapcall.ponte` — el puente página↔servidor: `aberta`, tramas enviadas/recibidas, audio/video descartado.
- `diag.zapcall.nativeMedia` — el adaptador que captura la voz/video de retorno: `ready`, `faltando` (módulos no encontrados tras una actualización de WhatsApp Web), `error`.
- `diag.zapcall.worklets` — `ok` o `ausente`: los worklets de audio fueron inyectados.
- `diag.zapcall.mic` / `cam` / `remoto` — contadores de tramas, picos, fps, errores del decodificador.
- `servidor.fonteMidia` / `servidor.descartes` — qué cliente alimenta la llamada y cuántas tramas de otros sockets se descartaron.

El **Diagnóstico › Autotest** del panel (o `POST /manager/instances/:nombre/selftest`) comprueba todo esto de una vez e informa cada punto como pasó/falló con un detalle.

## Logs

El gestor conserva las últimas 200 líneas de stdout/stderr de cada instancia: `GET /manager/instances/:nombre/logs`, o la pestaña **Logs** del panel (en vivo, filtrable). Con `VERBOSE=1` (por defecto en Docker) las mismas líneas se imprimen en el stdout del gestor con el prefijo `[<instancia>]`.
