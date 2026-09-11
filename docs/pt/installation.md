# Instalação

O ZapCall roda o **WhatsApp Web oficial** dentro de um Chrome controlado e expõe uma API HTTP + WebSocket para chamadas de voz e vídeo e para mensagens. Um processo — o **gerente** — supervisiona quantas **instâncias** você quiser (cada uma é um número do WhatsApp pareado).

## Requisitos

| Requisito | Observações |
|---|---|
| Node.js ≥ 22.12 | `node --version` |
| Google Chrome (estável) | Precisa ser **Chrome**, não o Chromium da distribuição: o vídeo depende do codec proprietário H.264 no WebCodecs. |
| Linux amd64 ou macOS | A imagem Docker é só `linux/amd64` (o Chrome não tem build para Linux arm64). |
| ~1 GB de RAM por instância | Cada Chrome pesa de 400 a 900 MB. |

## Opção A — Docker (recomendado)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
cp .env.example .env            # defina ZAPCALL_API_KEY (opcional; é gerada se ficar vazia)
docker compose up -d
docker compose logs -f zapcall   # o gerente mostra onde a chave global foi guardada
```

O serviço escuta em `http://127.0.0.1:18475` (só no loopback). Abra no navegador para chegar ao painel. Veja [Docker](#docker) para volumes, rede de host e proxy reverso.

## Opção B — Local (Node + Chrome)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

`npm start` sobe o gerente (`src/manager.mjs`). No primeiro boot, se `ZAPCALL_API_KEY` estiver vazia, uma chave global é gerada e guardada em `data/manager.json` (permissão `0600`). O log mostra só uma versão mascarada — leia o arquivo para pegar a chave inteira.

## Primeiros passos

1. Abra `http://127.0.0.1:18475/` e entre com a chave global.
2. Clique em **Nova instância** e dê um nome (`vendas`, `suporte`…).
3. Clique em **Parear** e leia o QR com o celular (*WhatsApp › Dispositivos conectados › Conectar dispositivo*).
4. Copie o **token da instância** na aba **API** e comece a integrar — veja [Autenticação](#authentication) e [API REST](#rest-api).

## Conferindo a instalação

```bash
npm run check    # verificação de sintaxe de todos os módulos
npm test         # testes unitários e de integração (o teste do discador precisa do Chrome; sem ele é pulado)
npm run probe    # autoteste de mídia num Chrome real, sem sessão do WhatsApp
```

A aba **Diagnóstico** do painel roda o mesmo autoteste por instância (processo, API, latência, sessão, ganchos de mídia, ponte, adaptador nativo, memória do Chrome).

## Atualizando

```bash
git pull && npm install && npm start          # local
docker compose pull && docker compose up -d   # Docker
```

As sessões pareadas vivem em `DATA_DIR` (`data/` no local, o volume `zapcall_data` no Docker). Preserve esse diretório entre atualizações e nenhuma instância precisa parear de novo.
