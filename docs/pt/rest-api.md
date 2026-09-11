# API REST

URL base: o gerente (`http://127.0.0.1:18475` por padrão). Existem duas famílias de rotas que fazem as mesmas coisas:

- **Estilo Evolution** (`/instance/*`, `/call/*`, `/message/*`, `/chat/*`, `/webhook/*`): os nomes que quem já integrou a Evolution API conhece. Use estas.
- **Estilo gerente/instância** (`/manager/*`, `/instances/:nome/api/*`): o que o painel usa, com JSON mais completo.

Corpos e respostas são JSON. Erros são `{ "error": "<código>", "message": "…" }` — veja [Erros](#errors). Credenciais: [Autenticação](#authentication). Abaixo, *global* significa que a chave global é obrigatória; *token* significa que o token da instância (ou a chave global) basta.

## Instâncias

| Método | Rota | Auth | O que faz |
|---|---|---|---|
| `POST` | `/instance/create` | global | Corpo `{ instanceName, channel?, webhook? }`. Devolve a instância e `hash.apikey` (o token dela). |
| `GET` | `/instance/fetchInstances` | global | Todas as instâncias com estado ao vivo. |
| `GET` | `/instance/connect/:nome` | token | QR atual: `{ code, base64, ansi }`. Se já pareada: `{ instance: { state: "open", phone } }`. |
| `GET` | `/instance/connectionState/:nome` | token | `{ instance: { instanceName, state, phone, busy, call } }` — `state` é `open`, `connecting` ou `close`. |
| `POST` | `/instance/update/:nome` | global | Qualquer subconjunto de `{ channel, enabled, webhook }`. |
| `POST` | `/instance/token/:nome` | global | Gira o token; a instância reinicia. Devolve `hash.apikey`. |
| `POST` | `/instance/restart/:nome` | token | Reinicia o Chrome; a sessão é mantida. |
| `DELETE` | `/instance/logout/:nome` | token | Apaga a sessão; volta ao QR. |
| `DELETE` | `/instance/delete/:nome` | global | Remove do cadastro. `?purge=1` apaga a sessão também. |

## Chamadas

Mande `x-client-id: <id>` nas rotas de chamada: ele marca o **dono** da chamada, e a mídia de retorno vai só para os clientes WebSocket com aquele `clientId`.

| Método | Rota | Corpo / resultado |
|---|---|---|
| `POST` | `/call/offer/:nome` | `{ number, isVideo? }` → `{ callId }`. `409 channel_busy` se a instância já está em chamada; `409 not_paired` sem sessão. |
| `POST` | `/call/accept/:nome` | `{ callId, video? }`. Atenda um convite de vídeo com `video: true` — o upgrade depois costuma ser recusado pelo WhatsApp. |
| `POST` | `/call/reject/:nome` | `{ callId }` |
| `POST` | `/call/hangup/:nome` | `{ callId }` |
| `POST` | `/call/mute/:nome` | `{ callId, muted }` — para de enviar a sua voz. |
| `GET` | `/call/status/:nome` | `{ calls: [ call row… ] }` — chamadas ativas mais as últimas 100 encerradas (até uma hora). |

`number` aceita dígitos com código do país (`5511999999999`) ou um JID. Números com 10–11 dígitos ganham o `DEFAULT_COUNTRY_CODE` na frente se ele estiver definido; senão são recusados com `400 numero_invalido`.

## Mensagens

Corpos e respostas no formato da Evolution API. `number` aceita dígitos ou um JID (`…@s.whatsapp.net`, `…@lid`, `…@g.us`). Todo envio devolve `key` (`remoteJid`, `fromMe`, `id`).

| Rota | Corpo |
|---|---|
| `POST /message/sendText/:nome` | `{ number, text, quoted? }` |
| `POST /message/sendMedia/:nome` | `{ number, mediatype: "image"\|"video"\|"document", mimetype, caption?, fileName?, media: <base64 ou URL> }` |
| `POST /message/sendWhatsAppAudio/:nome` | `{ number, audio: <base64 ogg/opus ou URL> }` — sai como mensagem de voz |
| `POST /message/sendSticker/:nome` | `{ number, sticker: <base64 webp ou URL> }` |
| `POST /message/sendContact/:nome` | `{ number, contact: [{ fullName, phoneNumber }] }` |
| `POST /message/sendReaction/:nome` | `{ key, reaction }` — `""` remove |

## Conversas e contatos

| Rota | Corpo → resultado |
|---|---|
| `POST /chat/whatsappNumbers/:nome` | `{ numbers: [] }` → `[{ exists, jid, number }]` |
| `POST /chat/fetchProfilePictureUrl/:nome` | `{ number }` → `{ wuid, profilePictureUrl }` |
| `POST /chat/sendPresence/:nome` | `{ number, presence: "composing"\|"recording"\|"paused"\|"available", delay? }` |
| `POST /chat/markMessageAsRead/:nome` | `{ readMessages: [{ remoteJid, id }] }` |
| `POST /chat/updateBlockStatus/:nome` | `{ number, status: "block"\|"unblock" }` |
| `POST /chat/updateMessage/:nome` | `{ key, text }` (editar) |
| `POST /chat/deleteMessageForEveryone/:nome` | `{ id, remoteJid, fromMe }` |
| `POST /chat/getBase64FromMediaMessage/:nome` | `{ message: { key } }` → `{ mediaType, mimetype, fileName, size, base64 }` |
| `POST /chat/findChats/:nome` | `{ limit? }` |
| `POST /chat/findContacts/:nome` | `{ where: { id } }` ou `{ where: { onlyMyContacts: true } }` |
| `POST /chat/findMessages/:nome` | `{ where: { key: { remoteJid } }, limit?, comMidia? }` → `{ messages: { total, records } }` |
| `POST /chat/fetchProfile/:nome` | o próprio perfil `{ wuid, name, picture }` |

Corpos de mensagem podem chegar a 64 MB (mídia em base64); todas as outras rotas param em 64 KB (`413 payload_too_large`).

## Webhooks

| Rota | Corpo |
|---|---|
| `POST /webhook/set/:nome` | `{ url, enabled?, events? }` — `events` vazio = todos |
| `GET /webhook/find/:nome` | configuração, eventos possíveis e as últimas 30 entregas |

Formato da entrega: [Eventos › Webhooks](#events).

## Rotas do gerente (painel)

Todas exigem a chave global.

| Rota | O quê |
|---|---|
| `GET /manager/instances` · `POST /manager/instances` | listar / criar (`{ name, channel }`) |
| `GET/PATCH/DELETE /manager/instances/:nome` | detalhe com token / atualizar (`channel`, `enabled`, `webhook`) / excluir (`?purge=1`) |
| `GET /manager/instances/:nome/status` · `/logs` · `/qr` · `/webhook` | estado ao vivo · últimas 200 linhas de log · PNG do QR · webhook + entregas |
| `POST /manager/instances/:nome/restart` · `/logout` · `/token` · `/selftest` | reiniciar · desparear · girar token · autoteste |
| `GET /manager/system` · `GET /manager/config` | carga, memória e peso do Chrome por instância · configuração efetiva (chave mascarada) |

## Rotas por instância

`/instances/:nome/api/*` é repassado ao processo da instância com o token dela. Úteis: `GET /api/status`, `GET/POST /api/calls`, `POST /api/calls/:id/(accept|reject|hangup|mute)`, `GET /api/pairing/qr`, `GET /api/diag` (diagnóstico completo de mídia), `POST /api/debug/fake-incoming` (uma chamada recebida falsa para exercitar a UI de um cliente sem ligar para ninguém).

Públicas, sem credencial: `/instances/:nome/static/worklets.js`, `/instances/:nome/static/zc-ui.js`, `/healthz`, `/docs`.
