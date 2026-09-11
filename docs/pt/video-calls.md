# Chamadas de vídeo

O vídeo vai no mesmo WebSocket do áudio, como quadros binários com `kind = 2`.

## Oferecer e atender com vídeo

```bash
curl -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: atendente-42" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","isVideo":true}'
```

Atender um convite de **vídeo**: `POST /call/accept/:nome` `{ "callId", "video": true }`. Aceite *com* vídeo desde o início — transformar uma chamada de voz em vídeo depois costuma ser recusado pelo WhatsApp (`501 video_upgrade_nao_implementado` do nosso lado).

Uma chamada de voz que o **contato** transforma em vídeo funciona: o primeiro quadro chega com `kind = 2` e o seu cliente deve criar o decoder sob demanda (o discador de referência faz isso).

## Enviando vídeo

- Codec: H.264 Baseline, byte stream **Annex-B**, SPS/PPS dentro de todo keyframe.
- Escolha o *nível* do H.264 pela resolução: `avc1.42E01E` (3.0) só cobre até 720×576; use `avc1.42E01F` (3.1) para 720p e `avc1.42E028` (4.0) para 1080p. Nível errado faz o `VideoEncoder.configure` estourar e você não manda nada.
- O discador de referência usa por padrão o perfil `realtime`: 640×360 @ 24 fps, 650 kbps, keyframe a cada 1 s e `latencyMode: 'realtime'`. `balanced` e `hd` são opções explícitas de ambiente.
- Mantenha as filas do encoder e decoder em no máximo 2 quadros. Ao descartar qualquer quadro, force o próximo a ser keyframe; um pedido `media-control` faz isso imediatamente.

A página do WhatsApp Web decodifica o seu stream, cadencia somente o quadro mais recente numa câmera virtual limitada pelo perfil e o WhatsApp recodifica para o contato. A limitação é intencional: impede que uma VPS tente duas codificações 720p/30 ao mesmo tempo.

## Recebendo vídeo

- Os quadros chegam em H.264 Annex-B, até 1280×720 a ~15 fps.
- O byte 2 do cabeçalho é a **orientação** (0–3 × 90° horário): o celular gira sem mudar o tamanho do quadro, então aplique a rotação ao desenhar, pelo cabeçalho do quadro mais recente.
- Depois de criar (ou recriar) o decoder, espere um keyframe (`flags & 1`) e ignore deltas até lá. Um erro fatal do `VideoDecoder` o fecha de vez: crie outro.

## Diagnóstico

| Sintoma | Onde olhar |
|---|---|
| O contato vê preto | `GET /api/diag` → `cam.quadros` deve crescer; `cam.erros` e `cam.descartadosSemKeyframe` não. |
| O contato vê vídeo travando | Confira `cam.fps`, `cam.descartadosDecoder`, `servidor.descartes.videoPorFila` e `videoSemKeyframe`. O serviço descarta o passado em vez de acumular atraso. |
| CPU alta depois da chamada | `cam.ativa` deve voltar a `false`; streams, decoder, frame e timer são encerrados no fim. |
| Você não vê nada | `remoto.video` true e `remoto.quadrosCodificados` crescendo significam que os quadros saem da página; confira o seu decoder/keyframe. |
| Vídeo de lado | Aplique o byte 2 do cabeçalho ao desenhar. |

## Banda

No perfil `realtime`, reserve cerca de 650 kbps de subida para a câmera e 0,5–1,5 Mbps de descida para o contato, mais ~256 kbps de áudio PCM em cada sentido entre o cliente e o gerente. `hd` usa até 1,8 Mbps na subida.
