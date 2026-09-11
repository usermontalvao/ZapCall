# Eventos

Os eventos chegam pelo [WebSocket](#websocket) como JSON e, opcionalmente, como `POST` num webhook. Os nomes seguem a Evolution API onde ela tem um equivalente.

## Eventos de chamada

| `type` | Quando |
|---|---|
| `incoming_call` | Um contato está ligando para a instância. Toca em todos os dispositivos do número, celular incluído. |
| `outgoing_call` | `/call/offer` criou uma chamada. |
| `call_accepted` | `/call/accept` foi executado por um cliente. |
| `call_active` | O WhatsApp Web reporta a chamada conectada — a hora de iniciar o cronômetro. Nunca inferido da mídia. |
| `call_update` | Qualquer outra mudança de estado (`ringing → connecting`, mudo, flags de vídeo). |
| `call_ended` | A chamada acabou. `endReason` diz por quê. |

Todos trazem um **call row**:

```json
{ "type": "call_active",
  "call": { "callId": "3EB0…", "direction": "outbound", "status": "active",
            "phone": "5511999999999", "lid": null, "peer": "5511999999999@c.us",
            "isVideo": false, "videoActive": false, "peerVideo": false, "muted": false,
            "owner": "meu-backend", "startedAt": 1789000000000, "acceptedAt": 1789000004000,
            "endedAt": null, "endReason": null, "raw": "ACTIVE" } }
```

| Campo | Significado |
|---|---|
| `status` | `ringing` · `connecting` · `active` · `ended` |
| `direction` | `inbound` · `outbound` |
| `phone` | Dígitos do número do contato, quando o WhatsApp expõe. `null` para contatos só com LID. |
| `lid` | O identificador `@lid` do contato quando a conta usa LIDs. **LID não é telefone** — nunca tente converter. |
| `owner` | `x-client-id` do cliente que ofereceu ou atendeu a chamada. |
| `endReason` | `terminate` · `rejected` · `missed` · `busy` · `accepted_elsewhere` · `connection_lost` · `relay_failed` |
| `raw` | O estado cru do WhatsApp Web, para diagnóstico. |

Chamadas encerradas ficam guardadas por uma hora (no máximo 100), para clientes atrasados ainda lerem.

## Eventos de sessão

| `type` | Corpo |
|---|---|
| `status` | `{ status: { connected, jid, phone, pushName, activeCalls } }` — enviado quando a sessão pareia ou cai. No webhook vira `connection.update` com `state: "open" \| "close"`. |

## Eventos de mensagem

| `type` | Corpo |
|---|---|
| `messages.upsert` | Mensagem nova, recebida ou enviada (`data.key.fromMe`). Formato Baileys/Evolution; mídia até 2 MB vem inline em `data.base64`. |
| `messages.update` | Confirmação: `data.status` = `SERVER_ACK` · `DELIVERY_ACK` · `READ` · `PLAYED` · `ERROR`. |
| `messages.delete` | Mensagem apagada para todos (`data.key`). |
| `presence.update` | Contato online, digitando, gravando: `data.presences[jid].lastKnownPresence`. |

```json
{ "type": "messages.upsert",
  "data": { "key": { "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "3EB0…" },
            "pushName": "Maria", "messageType": "conversation",
            "message": { "conversation": "olá" },
            "messageTimestamp": 1789000000, "status": "DELIVERY_ACK", "source": "web" } }
```

## Webhooks

Configure com `POST /webhook/set/:nome` (`{ url, enabled, events }`; `events` vazio = todos). Cada evento vira um `POST`, com até 3 tentativas (recuo de 1 s, 2 s, 3 s, prazo de 8 s cada). A mídia da chamada nunca vai por webhook. As últimas 30 entregas (status HTTP ou erro) aparecem no painel e em `GET /webhook/find/:nome`.

```json
{ "event": "messages.upsert", "instance": "vendas", "date_time": "2026-01-01T12:00:00.000Z",
  "server_url": "http://127.0.0.1:18475", "data": { "…": "…" } }
```

Os headers `x-zapcall-event` e `x-zapcall-instance` repetem os dois campos, para você rotear antes de ler o corpo.
