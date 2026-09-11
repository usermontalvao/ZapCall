# Variables de entorno

Todas son opcionales. El gestor las lee al arrancar y pasa las relevantes a cada proceso de instancia.

## Gestor

| Variable | Por defecto | Propósito |
|---|---|---|
| `PORT` | `18475` | Puerto del gestor (API + panel). |
| `HOST` | `127.0.0.1` | Dirección de escucha. Mantenla en loopback con red de host en Docker. |
| `ZAPCALL_API_KEY` | *(generada)* | Clave global. Vacía = se genera en el primer arranque y se guarda en `DATA_DIR/manager.json` (permiso `0600`). |
| `DATA_DIR` | `./data` (`/data` en Docker) | Registro, clave y sesiones vinculadas. El volumen a preservar. |
| `INSTANCE_PORT_BASE` | `18500` | Primer puerto del loopback para las instancias; cada una toma el siguiente libre. |
| `ALLOWED_ORIGINS` | *(cualquiera)* | Orígenes de navegador permitidos en CORS y WebSocket, separados por comas (`https://crm.ejemplo.com`). Vacío = cualquier origen. |
| `DEFAULT_COUNTRY_CODE` | *(ninguno)* | Código de país que se antepone a números de 10–11 dígitos (`55`, `1`, `34`…). Vacío = los números nacionales se rechazan. |
| `VERBOSE` | `1` | Imprime los logs de las instancias en el stdout del gestor (siempre están disponibles en el panel). |
| `CHROME_PATH` | *(autodetectado)* | Binario de Chrome. Debe ser Chrome (H.264), no Chromium. |
| `CHROME_NO_SANDBOX` | `0` (`1` en Docker) | Añade `--no-sandbox` para contenedores sin user namespaces. |
| `ZAPCALL_VIDEO_PROFILE` | `realtime` | `realtime` = 640×360/24 fps/650 kbps (hosting); `balanced` = 960×540/24; `hd` = 1280×720/30. |
| `ZAPCALL_VIDEO_WIDTH`, `ZAPCALL_VIDEO_HEIGHT`, `ZAPCALL_VIDEO_FPS`, `ZAPCALL_VIDEO_BITRATE` | *(perfil)* | Overrides opcionales. Úsalos solo después de medir CPU, subida y `GET /api/diag`. |
| `CHROME_DISABLE_DEV_SHM_USAGE` | `0` | `1` hace que Chrome use `/tmp`; déjalo en `0` con el `shm_size: 1gb` recomendado. |

## Instancia (las define el gestor; relevantes con `npm run start:single`)

| Variable | Por defecto | Propósito |
|---|---|---|
| `ZAPCALL_TOKEN` | *(token de instancia)* | Bearer token de la API de la instancia. Vacío = API abierta (solo en modo individual; nunca en producción). |
| `PROFILE_DIR` | `./data/profile` | Directorio de perfil de Chrome = la sesión vinculada. |
| `HEADFUL` | `0` | `1` muestra la ventana de Chrome (desarrollo en escritorio). |
| `QR_TERMINAL` | `1` (`0` bajo el gestor) | Imprime los QR de vinculación en stdout. |
| `QR_MAX` | `30` | Deja de imprimir tras tantos QR sin escanear. |
| `QR_STALE_MS` | `180000` | Red de seguridad: recarga la página si no apareció un QR nuevo en este tiempo. |
| `DEBUG_EVAL` | `0` | `1` activa `POST /api/debug/eval` (ejecución de código en la sesión) solo desde el loopback. Nunca en producción. |
| `ZAPCALL_PARENT_PID` | *(la define el gestor)* | La instancia se cierra si este proceso desaparece, para que ningún Chrome huérfano sobreviva a un gestor caído. |

## Solo Docker

| Variable | Por defecto | Propósito |
|---|---|---|
| `DISPLAY` | `:99` | Display de Xvfb. |
| `VNC` | `0` | `1` arranca `x11vnc` en `127.0.0.1:5900`. |

## Ejemplo de `.env`

```bash
PORT=18475
HOST=127.0.0.1
ZAPCALL_API_KEY=sustituye-por-una-cadena-larga-y-aleatoria
DATA_DIR=/data
INSTANCE_PORT_BASE=18500
DEFAULT_COUNTRY_CODE=34
ALLOWED_ORIGINS=https://crm.ejemplo.com
VERBOSE=1
ZAPCALL_VIDEO_PROFILE=realtime
```

Generar una clave: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
