# Autenticación

ZapCall tiene dos credenciales con dos alcances. Ambas viajan en un header — `apikey: …` o `Authorization: Bearer …`.

| Credencial | Alcance | Dónde vive |
|---|---|---|
| **Clave global** | Todo: crear, eliminar y listar instancias, leer tokens, el panel, `/manager/*`, `/instance/*`. | `ZAPCALL_API_KEY`, o generada en el primer arranque en `DATA_DIR/manager.json`. |
| **Token de instancia** | Solo esa instancia: llamadas, mensajes, eventos, su QR y su estado. | Creado con la instancia; visible en el panel (pestaña API); rotado con `POST /instance/token/:nombre`. |

## Reglas

- La **clave global nunca se acepta en una URL**. Acabaría en el historial del navegador, logs de proxy y cabeceras `Referer`. Las peticiones con `?token=<clave global>` reciben `401`.
- El **token de instancia puede ir en la URL** solo donde un navegador no puede enviar un header: el WebSocket (`/instances/:nombre/ws?token=…`), el marcador y la página de vinculación. Esas páginas quitan el token de la barra de direcciones de inmediato y toda respuesta lleva `Referrer-Policy: no-referrer`.
- La comparación es en **tiempo constante**. Veinte intentos fallidos desde la misma IP en un minuto devuelven `429 too_many_attempts` para toda petición de esa IP (incluso las válidas) hasta que pase la ventana.
- El panel guarda la clave global en el `localStorage` del navegador y siempre la envía como header. Salir la olvida.

## Ejemplos

```bash
# Clave global (administración)
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: TU_CLAVE_GLOBAL"

# Token de instancia (integración)
curl http://127.0.0.1:18475/instance/connectionState/ventas -H "apikey: TOKEN_DE_INSTANCIA"
curl http://127.0.0.1:18475/instance/connectionState/ventas -H "Authorization: Bearer TOKEN_DE_INSTANCIA"
```

## ¿Cuál debe usar mi integración?

El **token de instancia**. Guárdalo en tu backend y autentica a tus propios usuarios allí. El token es todo-o-nada para esa instancia (marcar, contestar, escuchar, leer y enviar mensajes), así que nunca debe llegar al navegador del usuario final. Si necesitas un cliente en el navegador, haz pasar el WebSocket por tu backend o abre una sesión de corta duración de tu lado.

## Restringir orígenes

Si un cliente de navegador va a conectarse directamente, define `ALLOWED_ORIGINS` con una lista de orígenes separados por comas. Con la lista definida, los `Origin` fuera de ella se rechazan (`403`) en HTTP y en el upgrade del WebSocket, y el `Access-Control-Allow-Origin: *` abierto desaparece. Las peticiones sin `Origin` (curl, backends) no se ven afectadas.
