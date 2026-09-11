# Creación de instancias

Una **instancia** es una sesión de WhatsApp Web: su propio Chrome, su propio directorio de perfil, su propio token y **una llamada a la vez** (regla de WhatsApp Web, no una decisión de ZapCall). Varios números = varias instancias, todas detrás del mismo gestor.

## Desde el panel

**Instancias › Nueva instancia**. Campos:

| Campo | Reglas |
|---|---|
| Nombre | Va en la URL y en el directorio de datos: `a-z`, `0-9`, `-`, `_`, hasta 32 caracteres, empezando por letra o dígito. |
| Etiqueta | Texto libre mostrado en el panel (`Equipo comercial`). Opcional. |
| Webhook | URL que recibe los eventos por `POST`. Opcional; se puede definir después. |

Después de crearla, el diálogo de vinculación se abre solo.

## Desde la API

Ruta estilo Evolution (requiere la clave global):

```bash
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: TU_CLAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"ventas","channel":"Equipo comercial","webhook":"https://ejemplo.com/zapcall"}'
```

```json
{ "instance": { "instanceName": "ventas", "state": "connecting", "connected": false, "busy": false, "port": 18500, "…": "…" },
  "hash": { "apikey": "TOKEN_DE_INSTANCIA" } }
```

`hash.apikey` es el **token de la instancia**: la única credencial que tu integración necesita. Guárdalo en tu backend.

El equivalente estilo gestor es `POST /manager/instances` con `{ "name", "channel" }` y devuelve `{ "instance": { …, "token" } }`.

## Vinculación

Vincular asocia la instancia a un número de teléfono. El QR cambia cada ~20 s.

- **Panel**: *Vincular* en la fila de la instancia o en su panel de detalles.
- **API**: `GET /instance/connect/:nombre` devuelve `{ code, base64, ansi }` — `base64` sirve directamente en un `<img src>`, `ansi` dibuja el QR en una terminal.
- **Página de vinculación**: `/instances/:nombre/pair?token=TOKEN_DE_INSTANCIA` (el token sale de la URL en cuanto carga la página).

Una vez vinculada, la sesión sobrevive a los reinicios: vive en `DATA_DIR/instances/<nombre>/profile`.

## Ciclo de vida

| Acción | Panel | API |
|---|---|---|
| Reiniciar el Chrome (mantiene la sesión) | *Reiniciar* | `POST /instance/restart/:nombre` |
| Desactivar / activar (detener el proceso) | Zona de peligro | `POST /instance/update/:nombre` `{ "enabled": false }` |
| Desvincular (borra la sesión, vuelve al QR) | Zona de peligro › *Desvincular* | `DELETE /instance/logout/:nombre` |
| Rotar el token | Zona de peligro › *Generar otro token* | `POST /instance/token/:nombre` |
| Eliminar | Zona de peligro › *Eliminar* (escribe el nombre) | `DELETE /instance/delete/:nombre` (`?purge=1` borra también la sesión) |

Si el Chrome de una instancia muere, el gestor lo reinicia con retroceso exponencial (2 s … 60 s). Los procesos de Chrome huérfanos que aún retengan el perfil se cierran antes de arrancar uno nuevo.

## Capacidad

Cada instancia ocupa uno de los espacios de dispositivo vinculado del número (WhatsApp permite cuatro) y ~1 GB de RAM. La pestaña **Diagnóstico** muestra el peso de cada Chrome; por encima de ~1,5 GB por instancia, o con menos del 15 % de memoria libre, no añadas instancias en esa máquina.
