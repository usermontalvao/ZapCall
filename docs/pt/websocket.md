# WebSocket

Um socket por cliente entrega os **eventos** (quadros de texto JSON) e a **mídia da chamada** (quadros binários) de uma instância.

```
ws://127.0.0.1:18475/instances/:nome/ws?clientId=<seu id>&token=<token da instância>
```

- `clientId` identifica o seu cliente. Use um id por aba do navegador ou por processo de backend — dois sockets com o mesmo id mandando mídia para a mesma chamada é a causa clássica de vídeo travado.
- Credenciais: `token` na query string, ou `Authorization: Bearer <token>` em header quando o cliente consegue mandar header (backends, `ws` no Node).
- Com `ALLOWED_ORIGINS` definido, navegadores de outras origens são recusados com `403`.
- Limite por quadro: 2 MB.

## Handshake

Logo depois de conectar você recebe um `hello`:

```json
{ "type": "hello",
  "status": { "connected": true, "jid": "5511999999999@c.us", "pushName": "Vendas", "phone": "5511999999999", "activeCalls": 0 },
  "calls": [ ] }
```

`calls` lista as chamadas de que a instância ainda se lembra, para um cliente que reconecta no meio de uma chamada redesenhar a tela.

## Quadros de texto (eventos)

Todo quadro de texto é `{ "type": "<evento>", … }`. A lista completa, com os corpos, está em [Eventos](#events). Eventos de chamada trazem `call` (um *call row*); `status` traz `status`; eventos de mensagem trazem `data`.

## Quadros binários (mídia da chamada)

Todo quadro binário tem um cabeçalho de 4 bytes seguido do conteúdo:

| Byte | Campo | Valores |
|---|---|---|
| 0 | `kind` | `1` áudio · `2` vídeo |
| 1 | `flags` | bit 0 = keyframe (só vídeo) |
| 2 | `orientation` | 0–3 = rotação em múltiplos de 90° no sentido horário, a aplicar ao desenhar (só vídeo) |
| 3 | reservado | `0` |

- **Áudio**: PCM mono, **16 kHz**, Int16 little-endian, quadros de **exatamente 960 amostras** (60 ms, 1920 bytes). Qualquer outro tamanho é descartado nas duas pontas.
- **Vídeo**: H.264 **Annex-B** (SPS/PPS dentro do keyframe). Do contato chegam até 1280×720 a ~15 fps; o que você manda é recodificado pelo WhatsApp (o discador de referência manda 720p a 30 fps, ~2 Mbps).

A direção é simétrica: quadros que você **envia** alimentam o microfone/câmera virtual da sessão do WhatsApp Web; quadros que você **recebe** são a voz e o vídeo do contato.

## Dono e vários clientes

- A mídia de retorno vai para os sockets cujo `clientId` é o **dono** da chamada (o `x-client-id` usado em `/call/offer` ou `/call/accept`). Chamada sem dono (atendida no celular) vai para todos os sockets.
- A mídia de subida é aceita de **um socket por chamada**: o primeiro socket do dono que mandar um quadro vira a fonte até a chamada acabar. Quadros de outros sockets são contados em `GET /api/diag` (`servidor.descartes.midiaDeOutroSocket`) e ignorados.

## Disciplina de keyframe

- Um decoder recém-criado (ou recriado depois de um erro) precisa esperar um keyframe e ignorar deltas até lá.
- Um emissor que precisou descartar um delta (fila cheia) precisa segurar os deltas seguintes até o próximo keyframe, e deve pedir um ao encoder.

## Reconexão

Sockets são baratos: reconecte com recuo, leia `hello.calls` e retome. Chamadas encerradas ficam listadas por até uma hora, para um cliente atrasado ainda mostrar o que aconteceu.

## Exemplo em Node

```js
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:18475/instances/vendas/ws?clientId=meu-backend', { headers: { authorization: 'Bearer TOKEN_DA_INSTANCIA' } });
ws.binaryType = 'arraybuffer';
ws.on('message', (dados, binario) => {
  if (binario) { const kind = Buffer.from(dados)[0]; return; }      // 1 áudio, 2 vídeo
  const ev = JSON.parse(dados.toString());
  if (ev.type === 'call_active') console.log('atendida', ev.call.callId);
});
```
