# Status

Três níveis de "está funcionando?": o gerente, cada instância e cada chamada.

## Gerente

| Rota | Auth | Resultado |
|---|---|---|
| `GET /healthz` | nenhuma | `200 { ok: true, instances, healthy, uptime }` quando toda instância **ligada** responde; `503` caso contrário. É o que o healthcheck do Docker consulta. |
| `GET /manager/system` | global | CPUs, carga de 1/5/15 min, memória livre, disco livre, RAM do gerente e, por instância: RAM do Node, número de processos do Chrome, RAM e CPU do Chrome. |
| `GET /manager/config` | global | Configuração efetiva: porta, diretório de dados, base de portas, origem da chave (env ou arquivo) e a chave **mascarada**, caminho do Chrome, origens permitidas, DDI padrão. |

## Instância

`GET /instance/connectionState/:nome` (token) ou `GET /manager/instances/:nome/status` (global):

| Campo | Significado |
|---|---|
| `state` | `open` pareada · `connecting` rodando mas sem sessão (QR) ou ainda subindo · `close` processo parado |
| `running` / `pid` / `uptime` | O processo da instância. Filho morto por sinal conta como **não** rodando. |
| `healthy` | A API da instância respondeu `/api/status`. |
| `connected` / `phone` / `pushName` | A sessão do WhatsApp. |
| `busy` / `activeCalls` / `call` | Se há chamada em curso e o call row dela. `maxCalls` é sempre `1`. |

Máquina de estados de uma instância, como o painel mostra:

```
Desligada  →  (ligar)  →  Subindo  →  Aguardando QR  →  (ler)  →  Livre  ⇄  Em chamada
    ↑                                                                   │
    └────────────────────── (desligar / processo morreu) ───────────────┘
```

## Chamada

`GET /call/status/:nome` devolve todos os call rows de que a instância se lembra. As mudanças ao vivo chegam como [eventos](#events). As transições decisivas:

- `ringing → active`: atendida. `acceptedAt` é definido **pelo estado do próprio WhatsApp Web**, nunca pela mídia começar a fluir.
- `→ ended`: `endReason` diz se alguém atendeu: `terminate` (desligou depois de conversar), `rejected`, `missed`, `busy`, `accepted_elsewhere` (atendida em outro dispositivo), `connection_lost`, `relay_failed`.

## Diagnóstico de mídia

`GET /instances/:nome/api/diag` (token) despeja o estado da página injetada:

- `diag.zapcall.ganchos` — os três ganchos de API do navegador (`getUserMedia`, `enumerateDevices`, `rtcPeerConnection`) precisam estar `true`.
- `diag.zapcall.ponte` — a ponte página↔servidor: `aberta`, quadros enviados/recebidos, áudio/vídeo descartado.
- `diag.zapcall.nativeMedia` — o adaptador que captura voz/vídeo de retorno: `ready`, `faltando` (módulos não encontrados depois de uma atualização do WhatsApp Web), `error`.
- `diag.zapcall.worklets` — `ok` ou `ausente`: os worklets de áudio foram injetados.
- `diag.zapcall.mic` / `cam` / `remoto` — contadores de quadros, picos, fps, erros de decoder.
- `servidor.fonteMidia` / `servidor.descartes` — qual cliente alimenta a chamada e quantos quadros de outros sockets foram descartados.

O **Diagnóstico › Autoteste** no painel (ou `POST /manager/instances/:nome/selftest`) confere tudo isso de uma vez e reporta cada item como passou/falhou com um detalhe.

## Logs

O gerente guarda as últimas 200 linhas de stdout/stderr de cada instância: `GET /manager/instances/:nome/logs`, ou a aba **Logs** no painel (ao vivo, filtrável). Com `VERBOSE=1` (padrão no Docker) as mesmas linhas saem no stdout do gerente com o prefixo `[<instância>]`.
