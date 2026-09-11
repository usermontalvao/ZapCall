# Seguridad

Qué hace el servicio para proteger las sesiones de WhatsApp que guarda, qué espera de ti y qué **no** hace.

## Modelo de amenaza

Un token de instancia da control total de un número de WhatsApp: marcar, contestar, escuchar, leer y enviar mensajes. La clave global da eso para todos los números, más el poder de crear y eliminar instancias. Trata ambos como secretos de producción.

## Incorporado

| Control | Detalle |
|---|---|
| Loopback por defecto | `HOST=127.0.0.1`. Con red de host en Docker, `0.0.0.0` expondría la API a internet. |
| Clave global nunca en URLs | Rechazada con `401` cuando va en `?token=`. Los tokens de instancia pueden ir en la URL solo para el WebSocket, el marcador y la página de vinculación, y esas páginas lo quitan de la barra de direcciones al cargar. |
| `Referrer-Policy: no-referrer` | En toda respuesta, para que un token en la URL de una página nunca se filtre por un enlace. |
| Comparación en tiempo constante | Claves y tokens se comparan con `crypto.timingSafeEqual` sobre resúmenes SHA-256. |
| Límite de fuerza bruta | 20 fallos de autenticación por IP por minuto → `429` durante el resto de la ventana. |
| Lista de orígenes | `ALLOWED_ORIGINS` restringe CORS y los upgrades de WebSocket a tus front-ends. |
| CSP, `nosniff`, `frame-ancestors 'none'` | Panel, documentación, marcador y vinculación son autocontenidos (sin CDN) y no se pueden embeber. Sin `unsafe-eval`. |
| Límites de cuerpo | 64 KB por petición (64 MB para media de mensaje), 2 MB por trama WebSocket. |
| Secretos enmascarados en logs y UI | El gestor nunca imprime la clave global completa; `/manager/config` la devuelve enmascarada; el panel oculta los tokens hasta que pulsas *Mostrar*. `manager.json` se escribe con permiso `0600`. |
| Una fuente de media por llamada | Impide que un segundo cliente inyecte audio/video en una llamada que no es suya. |
| Limpieza de huérfanos | Los procesos de Chrome que deja una caída se cierran antes de reutilizar un perfil. |
| Eval de depuración apagado | `POST /api/debug/eval` solo existe con `DEBUG_EVAL=1` y solo desde el loopback. Nunca lo actives en producción. |

## Tus responsabilidades

- **Los tokens se quedan en el backend.** Nunca envíes un token de instancia al navegador del usuario final. Si los agentes necesitan WebSocket directo, pon una credencial de corta duración tuya y un proxy delante.
- **Protege `DATA_DIR`.** `instances/<nombre>/profile` **es** la sesión de WhatsApp; `manager.json` e `instances.json` guardan la clave y los tokens. Haz copias cifradas; nunca lo subas al repositorio; restringe permisos.
- **Termina el TLS delante.** ZapCall habla HTTP/WS plano en el loopback. Usa un proxy inverso (Caddy, nginx, Traefik) para HTTPS/WSS y, a ser posible, un túnel autenticado o VPN para la administración.
- **Rota ante la sospecha.** `POST /instance/token/:nombre` invalida un token al instante; cambiar `ZAPCALL_API_KEY` y reiniciar rota la clave global.
- **Actualiza Chrome.** La imagen Docker descarga Chrome estable al construirse; reconstrúyela con regularidad.

## Limitaciones conocidas

- **La propiedad de la llamada es declarativa.** `owner` es el `x-client-id` que envía el cliente. Cualquier cliente con el token de instancia puede actuar sobre cualquier `callId`. La autorización por agente corresponde a tu backend.
- **Sin límite de tasa por ruta** más allá de los fallos de autenticación.
- **Chrome corre sin sandbox dentro del contenedor** (`CHROME_NO_SANDBOX=1`) y con red de host. Ejecútalo en un host o VM dedicados con un cortafuegos restrictivo.
- **Depende de internos de WhatsApp Web** para la media de retorno. Una actualización de WhatsApp puede romper las llamadas; el síntoma es una llamada conectada pero muda con `nativeMedia.ready = false` en `/api/diag`.

## Reportar una vulnerabilidad

Consulta `SECURITY.md` en el repositorio. No abras issues públicos para problemas de seguridad; incluye versión, pasos de reproducción e impacto, y nunca adjuntes tokens, códigos QR ni datos de sesión.
