# ZapCall

**Llamadas de voz y video por WhatsApp, como API.**

ZapCall convierte un número de WhatsApp en una línea telefónica programable. Ejecuta el WhatsApp Web oficial dentro de un Chrome controlado y expone una interfaz HTTP + WebSocket para llamar, contestar, rechazar y colgar — con el audio y el video crudos de la llamada fluyendo por el mismo socket, para que tu sistema lo reproduzca a un agente, lo grabe, lo transcriba o lo reenvíe — además de mensajes, contactos y webhooks en el formato de la Evolution API. Muchos números, un solo servicio, sin contrato de WhatsApp Business API.

Pensado para CRMs, help desks y centros de atención que ya hablan con sus clientes por WhatsApp y quieren que las llamadas vivan en el mismo lugar que la conversación: clic para llamar desde la ficha del cliente, llamadas entrantes sonando en el agente correcto, grabaciones adjuntas al ticket.

[![CI](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml/badge.svg)](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933)](package.json)
[![Docs](https://img.shields.io/badge/docs-PT%20%C2%B7%20EN%20%C2%B7%20ES-0969da)](docs/)

[![Invítanos a un café](https://img.shields.io/badge/%E2%98%95_Inv%C3%ADtanos_a_un_caf%C3%A9-R%24_50-ffdd00?labelColor=1f2328)](https://mpago.la/1sba1dw)
[![Patrocinadores](https://img.shields.io/badge/patrocinadores-ver_el_muro-8250df?labelColor=1f2328)](SUPPORTERS.md)

[English](README.md) · [Português](README.pt-BR.md)

> ☕ **ZapCall es gratuito e independiente.** No hay empresa detrás ni plan de pago. Si sustituyó un contrato de llamadas por minuto o te ahorró una semana de ingeniería inversa, [invita al equipo a un café](#apoya-el-proyecto) — cada café paga los números de prueba y las llamadas reales que se ejecutan cada noche para que siga funcionando tras cada actualización de WhatsApp. Quien apoya aparece en [SUPPORTERS.md](SUPPORTERS.md).

> **Estado: experimental.** Las llamadas reales de voz y video funcionan hoy. La media de retorno depende de interfaces privadas de WhatsApp Web que Meta puede cambiar sin aviso, y automatizar WhatsApp Web va contra sus términos de servicio. Usa un número que puedas perder y lee [Limitaciones](#limitaciones) antes de depender de esto en producción.

## Resumen

| | |
|---|---|
| **Instancias** | Un número de WhatsApp vinculado por instancia, cada una en su propio proceso de Chrome, perfil y puerto. Un único gestor las supervisa a todas. |
| **Llamadas** | `POST /call/offer` → `callId` → eventos (`incoming_call`, `call_active`, `call_ended`…) y media en un solo WebSocket. Una llamada por instancia, impuesta con `409 channel_busy`. |
| **Media** | Formato abierto: PCM 16 kHz mono (tramas de 60 ms) y H.264 Annex-B con cabecera de 4 bytes. Reprodúcela, grábala, transcríbela, reenvíala. |
| **Mensajes** | `/message/*`, `/chat/*`, `/webhook/*` con cuerpos Evolution / Baileys — las integraciones existentes reutilizan sus handlers. |
| **Panel** | UI de administración integrada: instancias, vinculación por QR, estado de llamada en vivo, webhooks, logs, diagnóstico, autotests. PT / EN / ES, claro / oscuro. |
| **Docs** | Manual completo servido por el propio servicio en `/docs`, en tres idiomas, sin sitio externo. |

## Inicio rápido

Requisitos: Node.js ≥ 22.12 y Google Chrome (no el Chromium de la distribución — el video necesita su códec H.264).

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

1. Abre `http://127.0.0.1:18475/` y entra con la clave global (`ZAPCALL_API_KEY`, o la generada en `data/manager.json` en el primer arranque — el log solo muestra una versión enmascarada).
2. **Nueva instancia** → ponle nombre → **Vincular** → escanea el QR con el teléfono (*WhatsApp › Dispositivos vinculados › Vincular un dispositivo*).
3. Abre la pestaña **API** de la instancia: muestra el token y comandos `curl` listos.

## Docker

```bash
cp .env.example .env      # define ZAPCALL_API_KEY, DEFAULT_COUNTRY_CODE, ALLOWED_ORIGINS según necesites
docker compose up -d
docker compose logs -f zapcall
```

La imagen es solo `linux/amd64` y usa red de host con el servicio atado a `127.0.0.1`. Las sesiones vinculadas viven en el volumen `zapcall_data`. Consulta [docs/es/docker.md](docs/es/docker.md) para proxy inverso y TLS.

## La API en un minuto

```bash
# crear una instancia (clave global) → su token es hash.apikey
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: CLAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"ventas","webhook":"https://ejemplo.com/zapcall"}'

# QR de vinculación (PNG base64 + arte de terminal)
curl http://127.0.0.1:18475/instance/connect/ventas -H "apikey: TOKEN_DE_INSTANCIA"

# llamar
curl -X POST http://127.0.0.1:18475/call/offer/ventas \
  -H "apikey: TOKEN_DE_INSTANCIA" -H "x-client-id: mi-backend" -H "Content-Type: application/json" \
  -d '{"number":"34612345678","isVideo":false}'
# → {"callId":"…"}   o   409 {"error":"channel_busy","call":{…}}

# eventos + media
ws://127.0.0.1:18475/instances/ventas/ws?clientId=mi-backend&token=TOKEN_DE_INSTANCIA
```

## Documentación

Servida por el servicio en **`/docs`** (PT / EN / ES, con búsqueda) y mantenida en Markdown en [`docs/`](docs/): instalación, instancias, autenticación, API REST, WebSocket, eventos, estado, errores, llamadas de audio, videollamadas, ejemplos con curl y JavaScript, integración con CRM, seguridad, Docker, variables de entorno.

## Capturas

El panel sigue el tema del sistema (claro / oscuro) y habla portugués, inglés y español.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-instances.png" alt="Instancias (claro)" width="420"><br><sub>Instancias — claro</sub></td>
    <td align="center"><img src="docs/screenshots/panel-instances-dark.png" alt="Instancias (oscuro)" width="420"><br><sub>Instancias — oscuro</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-pairing.png" alt="Vinculación por QR" width="420"><br><sub>Vinculación por QR</sub></td>
    <td align="center"><img src="docs/screenshots/panel-cards-dark.png" alt="Tarjetas (oscuro)" width="420"><br><sub>Tarjetas — oscuro</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-logs-dark.png" alt="Logs en vivo (oscuro)" width="420"><br><sub>Logs en vivo — oscuro</sub></td>
    <td align="center"><img src="docs/screenshots/docs-dark.png" alt="Documentación integrada (oscuro)" width="420"><br><sub>Documentación integrada — oscuro</sub></td>
  </tr>
</table>

## Seguridad

Lee [SECURITY.md](SECURITY.md): modelo de amenaza, controles incorporados, tus responsabilidades y cómo reportar una vulnerabilidad. En resumen: los tokens de instancia se quedan en el backend, `DATA_DIR` es privado, el TLS termina delante y el servicio nunca sale del loopback sin un proxy autenticado.

## Desarrollo

```bash
npm run check   # verificación de sintaxis de todos los módulos
npm test        # pruebas unitarias y de integración; la prueba extremo a extremo del marcador necesita Chrome y se omite sin él
npm run probe   # autotest de media en un Chrome real, sin sesión de WhatsApp
```

Arquitectura y organización de archivos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Contribuciones: [CONTRIBUTING.md](CONTRIBUTING.md).

## Hoja de ruta

Planificado, más o menos en este orden. Abre un issue para votar o proponer otra cosa.

- [ ] **Grabación integrada** — `record: true` en la llamada escribe un WAV (estéreo: agente / contacto) en `DATA_DIR` y lo anuncia en `call_ended`.
- [ ] **Ganchos de transcripción** — enviar el audio de la llamada a un servicio de transcripción y entregar el texto como evento.
- [ ] **Tokens con alcance** — credenciales por agente con permisos (marcar, contestar, escuchar, mensajes), para que los navegadores se conecten sin el token de la instancia.
- [ ] **Subir a video a mitad de llamada** — sin colgar (hoy `501`).
- [ ] **Transferencia de llamada** entre instancias y transferencia asistida entre dos agentes.
- [ ] **Especificación OpenAPI** y SDKs oficiales (Node.js, Python).
- [ ] **Endpoint de métricas** (`/metrics`, Prometheus) — llamadas, duraciones, tasa de tramas, memoria de Chrome.
- [ ] **Usuarios y roles en el panel** — varios administradores, registro de auditoría, lectores.
- [ ] **Plantillas de mensaje y respuestas rápidas** en el panel.
- [ ] **Más idiomas** en el panel y la documentación (contribuciones bienvenidas — ver [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language)).
- [ ] **Helm chart** e imagen ARM64 (depende de un Chrome con H.264 para Linux arm64).

## Apoya el proyecto

ZapCall es gratuito y seguirá siéndolo — MIT, sin plan de pago, sin empresa detrás. Lo que *sí* cuesta es real: WhatsApp cambia su cliente web cada pocas semanas y cada cambio puede dejar mudas todas las llamadas; mantener ZapCall funcionando exige números de prueba, un servidor que hace llamadas reales cada noche y horas leyendo código minificado. Una API comercial de llamadas por WhatsApp cobra por minuto; aquí pagas lo que creas justo, una vez, y todos se benefician.

**Lo que paga tu café**

| | Importe | Financia |
|:---:|:---:|---|
| ☕ | [**R$ 50 — un café**](https://mpago.la/1sba1dw) | Un número de prueba durante un mes, para verificar vinculación y llamadas en un teléfono real. |
| ☕☕ | [**R$ 200 — café grande**](https://mpago.la/1Lkup75) | Un mes del servidor que hace las llamadas reales de voz y video cada noche y detecta las actualizaciones de WhatsApp antes que tú. |
| ☕☕☕ | [**R$ 1.000 — un mes de café**](https://mpago.la/22kZeoS) | Una semana completa de trabajo en la [hoja de ruta](#hoja-de-ruta) — grabación, tokens con alcance, transcripción — con tu nombre en las notas de la versión. |

El pago es a través de Mercado Pago (tarjeta, Pix o boleto; funciona desde fuera de Brasil con tarjeta). Todo patrocinador, con cualquier importe, entra en el [muro de patrocinadores](SUPPORTERS.md) — abre un pull request con tu nombre o usuario, o indícalo en la nota del pago.

**Formas de ayudar que no cuestan nada:** dar una estrella al repositorio (así lo encuentran otros desarrolladores), reportar un bug con los logs de la instancia, traducir una página de la documentación, o contárselo a alguien que todavía paga por llamada.

## Limitaciones

- **Una llamada por instancia** — regla de WhatsApp Web. Paralelismo = más instancias (cada una usa uno de los cuatro espacios de dispositivo vinculado del número).
- **El teléfono también suena** en las llamadas entrantes; quien contesta primero se queda con la llamada (`accepted_elsewhere` en los demás).
- **La media de retorno depende de módulos privados de WhatsApp Web.** Una actualización puede romperla; el síntoma es una llamada conectada y muda con `nativeMedia.ready = false` en `/api/diag`.
- **No es una API multiusuario.** Un token de instancia lo da todo en esa instancia; la autorización por usuario corresponde a tu backend.
- **Términos de servicio.** Automatizar WhatsApp Web viola los términos de Meta; los números pueden ser bloqueados.

## Licencia

[MIT](LICENSE). ZapCall no está afiliado, respaldado ni conectado con WhatsApp LLC ni con Meta Platforms, Inc.
