# Segurança

O que o serviço faz para proteger as sessões do WhatsApp que guarda, o que espera de você e o que ele **não** faz.

## Modelo de ameaça

Um token de instância dá controle total de um número do WhatsApp: discar, atender, ouvir, ler e mandar mensagens. A chave global dá isso para todos os números, mais o poder de criar e apagar instâncias. Trate os dois como segredos de produção.

## Embutido

| Controle | Detalhe |
|---|---|
| Loopback por padrão | `HOST=127.0.0.1`. Com rede de host no Docker, `0.0.0.0` exporia a API na internet. |
| Chave global nunca na URL | Recusada com `401` quando vai em `?token=`. Tokens de instância podem ir na URL só no WebSocket, no discador e na página de pareamento, e essas páginas o removem da barra de endereço ao carregar. |
| `Referrer-Policy: no-referrer` | Em toda resposta, para um token na URL de uma página nunca vazar por um link. |
| Comparação em tempo constante | Chaves e tokens são comparados com `crypto.timingSafeEqual` sobre resumos SHA-256. |
| Limite de força bruta | 20 falhas de autenticação por IP por minuto → `429` pelo resto da janela. |
| Lista de origens | `ALLOWED_ORIGINS` restringe CORS e upgrades de WebSocket aos seus front-ends. |
| CSP, `nosniff`, `frame-ancestors 'none'` | Painel, documentação, discador e pareamento são autocontidos (sem CDN) e não podem ser embutidos. Sem `unsafe-eval`. |
| Limites de corpo | 64 KB por pedido (64 MB para mídia de mensagem), 2 MB por quadro WebSocket. |
| Segredos mascarados em log e tela | O gerente nunca imprime a chave global inteira; `/manager/config` devolve mascarada; o painel esconde tokens até você clicar em *Mostrar*. `manager.json` é gravado com permissão `0600`. |
| Uma fonte de mídia por chamada | Impede um segundo cliente de injetar áudio/vídeo numa chamada que não é dele. |
| Limpeza de órfãos | Processos de Chrome deixados por uma queda são encerrados antes de um perfil ser reutilizado. |
| Eval de depuração desligado | `POST /api/debug/eval` só existe com `DEBUG_EVAL=1` e só do loopback. Nunca ligue em produção. |

## Suas responsabilidades

- **Tokens ficam no backend.** Nunca mande um token de instância para o navegador do usuário final. Se atendentes precisam de WebSocket direto, coloque uma credencial de curta duração sua e um proxy na frente.
- **Proteja o `DATA_DIR`.** `instances/<nome>/profile` **é** a sessão do WhatsApp; `manager.json` e `instances.json` guardam a chave e os tokens. Faça backup criptografado; nunca comite; restrinja permissões.
- **Termine o TLS na frente.** O ZapCall fala HTTP/WS puro no loopback. Use um proxy reverso (Caddy, nginx, Traefik) para HTTPS/WSS e, de preferência, um túnel autenticado ou VPN para administração.
- **Gire ao desconfiar.** `POST /instance/token/:nome` invalida um token na hora; trocar `ZAPCALL_API_KEY` e reiniciar gira a chave global.
- **Atualize o Chrome.** A imagem Docker baixa o Chrome estável no build; reconstrua com regularidade.

## Limitações conhecidas

- **O dono da chamada é declarativo.** `owner` é o `x-client-id` que o cliente manda. Qualquer cliente com o token da instância pode agir sobre qualquer `callId`. A autorização por atendente é do seu backend.
- **Sem limite de taxa por rota** além das falhas de autenticação.
- **O Chrome roda sem sandbox dentro do container** (`CHROME_NO_SANDBOX=1`) e com rede de host. Rode num host ou VM dedicados, com firewall restritivo.
- **Depende de internos do WhatsApp Web** para a mídia de retorno. Uma atualização do WhatsApp pode quebrar as chamadas; o sintoma é chamada conectada e muda, com `nativeMedia.ready = false` em `/api/diag`.

## Relatando uma vulnerabilidade

Veja o `SECURITY.md` no repositório. Não abra issues públicas para problemas de segurança; inclua versão, passos de reprodução e impacto, e nunca anexe tokens, QR ou dados de sessão.
