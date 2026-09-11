# Erros

Todo erro é JSON: `{ "error": "<código>", "message": "<texto>" }`, às vezes com campos extras (`call` no `channel_busy`, `motivo` no `numero_invalido`).

| HTTP | `error` | Significado | O que fazer |
|---|---|---|---|
| 400 | `missing_to`, `missing_callId`, `missing_action`, `invalid_name`, `invalid_webhook` | Corpo incompleto ou inválido. | Corrija o pedido; `message` explica. |
| 400 | `numero_invalido` | O número não pôde ser normalizado. `motivo` diz por quê (ex.: sem `DEFAULT_COUNTRY_CODE` para um número nacional). | Mande o número completo com código do país, ou defina `DEFAULT_COUNTRY_CODE`. |
| 401 | `unauthorized` | Sem credencial, credencial errada, chave global na URL, ou token usado em outra instância. | Veja [Autenticação](#authentication). |
| 403 | `origin_not_allowed` | O `Origin` do navegador não está em `ALLOWED_ORIGINS`. | Adicione a origem ou chame do backend. |
| 404 | `instance_not_found`, `call_not_found`, `not_found` | Nome de instância, `callId` ou rota desconhecidos. | — |
| 405 | `method_not_allowed` | Método HTTP errado numa rota de mensagem/conversa. | — |
| 409 | `channel_busy` | A instância já está em chamada. `call` traz o call row atual. | Espere o `call_ended`, ou use outra instância. |
| 409 | `not_paired` | Sem sessão do WhatsApp. | Pareie pelo QR. |
| 409 | `already_exists` | Nome de instância repetido. | — |
| 413 | `payload_too_large` | Corpo acima de 64 KB (ou 64 MB para mídia de mensagem). | — |
| 429 | `too_many_attempts` | 20+ falhas de autenticação deste IP em um minuto. Bloqueia **todo** pedido do IP pelo resto da janela. | Pare de tentar com credencial errada; espere um minuto. |
| 500 | `falha` | Erro inesperado; `message` tem o motivo. | Abra uma issue com as linhas de log. |
| 501 | `video_upgrade_nao_implementado` | Ligar o vídeo numa chamada de voz depois de começada. | Ofereça/atenda a chamada com `isVideo: true`. |
| 502 | `sem_chamada` | O WhatsApp Web aceitou a oferta mas nenhuma chamada apareceu; `motivo` traz a razão da página (número sem WhatsApp, bloqueado etc.). | Leia `motivo`. |
| 502 | `wa_error` | O WhatsApp Web recusou uma ação de mensagem/conversa. | `message` tem o motivo. |
| 502 | `instance_unreachable` | O processo da instância não respondeu ao gerente. | Provavelmente está reiniciando; tente em alguns segundos. |
| 503 | `instance_stopped` | Instância desligada ou processo caído. | Ligue-a / espere o reinício automático. |
| 503 | `browser_not_ready` | O Chrome ainda está subindo. | Tente de novo. |
| 504 | `timeout` | A página do WhatsApp não respondeu à ação no prazo (20 s discar, 15 s atender, 10 s recusar/desligar, 60 s mensagens). | Tente de novo; se persistir, reinicie a instância. |

## Falhas silenciosas que vale conhecer

- **Chamada conectada e muda** com `nativeMedia.ready = false` em `/api/diag`: uma atualização do WhatsApp Web mudou os nomes dos módulos privados de que o adaptador depende. `faltando` lista o que não foi encontrado. Reinicie a instância primeiro; se persistir, abra uma issue com essa lista.
- **Vídeo travando no celular**: veja `servidor.descartes.midiaDeOutroSocket` — dois clientes alimentavam a mesma chamada. Use um `clientId` por aba/processo.
- **Instância presa em "Aguardando QR" para sempre**: o celular precisa estar online e o número pode já ter quatro dispositivos conectados. Desconecte um dispositivo antigo no celular.
- **Instância listada como rodando depois de um reinício, mas sem responder**: o perfil do Chrome pode estar preso por um Chrome órfão. O gerente mata órfãos antes de subir um novo; procure `orfao` na aba Logs.
