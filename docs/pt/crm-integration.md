# Integração com CRM

O ZapCall foi feito para ficar atrás de um CRM: o CRM é dono dos usuários, das permissões e do histórico de conversas; o ZapCall é dono da sessão do WhatsApp e da mídia. Esta página é a forma recomendada dessa integração.

## Topologia

```
Navegador (atendente) ──HTTPS/WSS──▶ seu backend ──HTTP/WS (loopback ou rede privada)──▶ gerente ZapCall ──▶ instâncias
```

- O **token da instância** vive só no seu backend. Os atendentes se autenticam no seu sistema; o seu backend decide quem pode discar de qual instância.
- Uma **instância por linha/canal** (suporte, vendas, financeiro…). `channel` é um rótulo livre que você mapeia para os seus ids.
- Deixe o ZapCall no loopback ou numa rede privada. Se precisar atravessar a internet, use um proxy reverso com TLS na frente de `127.0.0.1:18475` e mantenha `HOST=127.0.0.1`.

## Mapeando estados para a sua tela

| ZapCall | CRM |
|---|---|
| `connectionState.state = open` | linha disponível |
| `busy = true` / `409 channel_busy` | linha em uso — mostre *quem* (`call.phone`, `call.direction`) e desde quando (`call.acceptedAt`) |
| `incoming_call` | toque para os atendentes com direito àquela linha; o primeiro `accept` leva |
| `call_active` | inicie o cronômetro (nunca pela mídia) |
| `call_ended` + `endReason` | `terminate` = conversou; `missed`/`rejected`/`busy` = não atendida; `accepted_elsewhere` = atendida no celular |
| `messages.upsert` | acrescente à conversa; mídia ≤ 2 MB vem inline em `base64` |

## Fluxo recomendado para uma chamada de saída

1. O backend confere se o atendente pode usar a linha e consulta `GET /instance/connectionState/:nome`. Se `busy`, diz ao atendente quem está na linha.
2. O backend faz `POST /call/offer/:nome` com `x-client-id: <id da sessão do atendente>`.
3. O backend abre (ou já tem) um WebSocket com `clientId = <id da sessão do atendente>` e repassa a mídia ao navegador do atendente (ou o navegador conecta direto através do seu proxy, com uma credencial de curta duração sua).
4. No `call_ended`, persista `startedAt`, `acceptedAt`, `endedAt`, `endReason` e, se gravou, o áudio.

## Gravação e transcrição

A mídia chega como PCM cru 16 kHz mono em quadros de 60 ms — trivial de gravar num WAV (16 bits little-endian, 16000 Hz, 1 canal) ou de mandar em streaming para um serviço de transcrição. Mantenha as duas direções em buffers separados se quiser gravação estéreo (atendente à esquerda, contato à direita).

## Webhooks ou WebSocket

- **Webhooks** bastam para estado e mensagens: um `POST` por evento, com três tentativas, no formato Evolution que os seus handlers talvez já entendam.
- **WebSocket** é obrigatório para **mídia** e entrega os mesmos eventos com menos latência. Backends costumam usar os dois: webhook para estado durável, socket para chamadas ao vivo.

## Várias instâncias

`GET /instance/fetchInstances` (chave global) devolve todas as linhas com `state`, `busy` e `call`. Consulte a cada poucos segundos para um painel de "linhas", ou assine o socket de cada instância e mantenha o estado em memória.

## Vindo da Evolution API

Nomes de rota, corpos e formatos de webhook (`messages.upsert`, `connection.update`, `key`, `pushName`, `message.conversation`…) batem com a Evolution API, então handlers existentes podem ser reaproveitados trocando a URL base. O que é novo: `/call/*`, a mídia binária no WebSocket e `busy`/`call` no `connectionState`.

## O que o CRM precisa tratar

- **Uma chamada por instância.** Enfileire ou roteie para outra instância.
- **LID não é telefone.** `remoteJidAlt` (mensagens) e `phone` (chamadas) vêm preenchidos quando o WhatsApp expõe o número; senão, identifique o contato pelo LID.
- **O celular também toca.** Decida o que a sua tela mostra quando chega `accepted_elsewhere`.
- **Sessões caem.** Observe `status` / `connection.update` e avise um administrador que a "linha precisa parear".
