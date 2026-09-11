# Chamadas de áudio

## Como a voz trafega

```
seu cliente ──PCM 16 kHz──▶ gerente ──▶ instância ──▶ página do WhatsApp Web (microfone virtual) ──▶ WhatsApp
seu cliente ◀──PCM 16 kHz── gerente ◀── instância ◀── página do WhatsApp Web (adaptador de áudio de retorno) ◀── WhatsApp
```

Dentro da página do WhatsApp Web, o ZapCall substitui o `getUserMedia` por um microfone virtual alimentado pelos quadros que você manda, e captura a voz do contato no caminho de reprodução de áudio da página. Os dois lados usam o mesmo quadro de 16 kHz / 960 amostras descrito em [WebSocket](#websocket).

## Fazendo uma chamada

```bash
curl -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: atendente-42" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","isVideo":false}'
# → {"callId":"3EB0…"}
```

Depois, num WebSocket aberto com `clientId=atendente-42`:

1. Espere o `call_active` (o contato atendeu). Não inicie o cronômetro no `outgoing_call`.
2. Comece a mandar quadros de áudio (kind `1`) e a tocar os que chegam.
3. `POST /call/hangup/:nome` com o `callId` para encerrar; o `call_ended` confirma.

Mande áudio assim que a chamada estiver `active`; quadros enviados enquanto toca são aceitos, mas ninguém os ouve.

## Recebendo uma chamada

O `incoming_call` chega com `direction: "inbound"`. Atenda com `POST /call/accept/:nome` `{ "callId" }` usando o mesmo `x-client-id` do seu socket, para a mídia ser roteada para você. Ou recuse com `/call/reject/:nome`.

A chamada também toca no celular: se alguém atender lá primeiro você recebe `call_ended` com `endReason: "accepted_elsewhere"`.

## Mudo

`POST /call/mute/:nome` `{ "callId", "muted": true }` faz a página parar de repassar os seus quadros (você pode continuar mandando; eles são descartados). `muted: false` retoma. O call row reflete em `muted`.

## Notas de qualidade

- Os quadros têm 60 ms: mantenha o envio regular (um quadro a cada 60 ms). O receptor tem um buffer de jitter com alvo de 120 ms que encolhe acima de 240 ms.
- A fila de subida é curta de propósito: se o socket acumular mais de ~6 quadros de áudio, os novos são descartados em vez de atrasados. Quadro atrasado vale menos que quadro perdido.
- Ligue o cancelamento de eco na captura (`echoCancellation: true` no `getUserMedia`); o discador de referência liga.
- Pico (`estado.pico` no discador, `remoto.pico` em `/api/diag`) acima de ~300 é voz; ~0 é silêncio ou caminho quebrado.

## O discador de referência

`/instances/:nome/dialer?token=TOKEN_DA_INSTANCIA` é um cliente completo de voz/vídeo num HTML só (`src/page/dialer.html`): worklets de WebAudio para captura e reprodução, WebCodecs para vídeo, sem dependências. Ele fala exatamente a mesma API que a sua integração vai falar — por isso é a bancada de testes: o que funciona ali funciona no seu cliente.

Abra pelo painel (*Discador* numa instância pareada). O token sai da URL assim que a página carrega.
