# Variáveis de ambiente

Todas são opcionais. O gerente as lê no boot e repassa as relevantes a cada processo de instância.

## Gerente

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `18475` | Porta do gerente (API + painel). |
| `HOST` | `127.0.0.1` | Endereço de escuta. Mantenha no loopback com rede de host no Docker. |
| `ZAPCALL_API_KEY` | *(gerada)* | Chave global. Vazia = gerada no primeiro boot e guardada em `DATA_DIR/manager.json` (permissão `0600`). |
| `DATA_DIR` | `./data` (`/data` no Docker) | Cadastro, chave e sessões pareadas. O volume a preservar. |
| `INSTANCE_PORT_BASE` | `18500` | Primeira porta do loopback para as instâncias; cada uma pega a próxima livre. |
| `ALLOWED_ORIGINS` | *(qualquer)* | Origens de navegador permitidas no CORS e no WebSocket, separadas por vírgula (`https://crm.exemplo.com`). Vazio = qualquer origem. |
| `DEFAULT_COUNTRY_CODE` | *(nenhum)* | Código do país acrescentado a números de 10–11 dígitos (`55`, `1`, `34`…). Vazio = números nacionais são recusados. |
| `VERBOSE` | `1` | Imprime os logs das instâncias no stdout do gerente (eles sempre ficam disponíveis no painel). |
| `CHROME_PATH` | *(autodetectado)* | Binário do Chrome. Precisa ser Chrome (H.264), não Chromium. |
| `CHROME_NO_SANDBOX` | `0` (`1` no Docker) | Acrescenta `--no-sandbox` para containers sem user namespaces. |
| `ZAPCALL_VIDEO_PROFILE` | `realtime` | `realtime` = 640×360/24 fps/650 kbps (hospedagem); `balanced` = 960×540/24; `hd` = 1280×720/30. |
| `ZAPCALL_VIDEO_WIDTH`, `ZAPCALL_VIDEO_HEIGHT`, `ZAPCALL_VIDEO_FPS`, `ZAPCALL_VIDEO_BITRATE` | *(perfil)* | Overrides opcionais. Use somente depois de medir CPU, upload e `GET /api/diag`. |
| `CHROME_DISABLE_DEV_SHM_USAGE` | `0` | `1` manda o Chrome usar `/tmp`; deixe `0` quando o container tiver o `shm_size: 1gb` recomendado. |

## Instância (definidas pelo gerente; relevantes com `npm run start:single`)

| Variável | Padrão | Para quê |
|---|---|---|
| `ZAPCALL_TOKEN` | *(token da instância)* | Bearer token da API da instância. Vazio = API aberta (só no modo avulso; nunca em produção). |
| `PROFILE_DIR` | `./data/profile` | Diretório de perfil do Chrome = a sessão pareada. |
| `HEADFUL` | `0` | `1` mostra a janela do Chrome (desenvolvimento no desktop). |
| `QR_TERMINAL` | `1` (`0` sob o gerente) | Imprime os QRs de pareamento no stdout. |
| `QR_MAX` | `30` | Para de imprimir depois de tantos QRs sem leitura. |
| `QR_STALE_MS` | `180000` | Rede de segurança: recarrega a página se nenhum QR novo apareceu por este tempo. |
| `DEBUG_EVAL` | `0` | `1` liga `POST /api/debug/eval` (execução de código na sessão) só do loopback. Nunca em produção. |
| `ZAPCALL_PARENT_PID` | *(definida pelo gerente)* | A instância se encerra se este processo sumir, para nenhum Chrome órfão sobreviver a um gerente que caiu. |

## Só no Docker

| Variável | Padrão | Para quê |
|---|---|---|
| `DISPLAY` | `:99` | Display do Xvfb. |
| `VNC` | `0` | `1` sobe o `x11vnc` em `127.0.0.1:5900`. |

## Exemplo de `.env`

```bash
PORT=18475
HOST=127.0.0.1
ZAPCALL_API_KEY=troque-por-uma-string-longa-e-aleatoria
DATA_DIR=/data
INSTANCE_PORT_BASE=18500
DEFAULT_COUNTRY_CODE=55
ALLOWED_ORIGINS=https://crm.exemplo.com
VERBOSE=1
ZAPCALL_VIDEO_PROFILE=realtime
```

Gerar uma chave: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
