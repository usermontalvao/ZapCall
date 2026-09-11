# ZapCall

**Chamadas de voz e vídeo pelo WhatsApp, por API.** O ZapCall roda o WhatsApp Web oficial dentro de um Chrome controlado e expõe uma interface HTTP + WebSocket para ligar, atender, recusar e desligar — com o áudio e o vídeo crus da chamada trafegando pelo mesmo socket — além de mensagens, contatos e webhooks no formato da Evolution API. Vários números, um serviço só.

[![CI](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml/badge.svg)](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933)](package.json)
[![Docs](https://img.shields.io/badge/docs-PT%20%C2%B7%20EN%20%C2%B7%20ES-0969da)](docs/)

[English](README.md) · [Español](README.es.md)

> **Status: experimental.** Chamadas reais de voz e vídeo funcionam hoje. A mídia de retorno depende de interfaces privadas do WhatsApp Web que a Meta pode mudar sem aviso, e automatizar o WhatsApp Web contraria os termos de uso. Use um número que você pode perder e leia [Limitações](#limitações) antes de depender disto em produção.

## Visão geral

| | |
|---|---|
| **Instâncias** | Um número do WhatsApp pareado por instância, cada uma no próprio processo do Chrome, perfil e porta. Um único gerente supervisiona todas. |
| **Chamadas** | `POST /call/offer` → `callId` → eventos (`incoming_call`, `call_active`, `call_ended`…) e mídia num WebSocket só. Uma chamada por instância, imposta com `409 channel_busy`. |
| **Mídia** | Formato aberto: PCM 16 kHz mono (quadros de 60 ms) e H.264 Annex-B com cabeçalho de 4 bytes. Toque, grave, transcreva, encaminhe. |
| **Mensagens** | `/message/*`, `/chat/*`, `/webhook/*` com corpos Evolution / Baileys — integrações existentes reaproveitam os handlers. |
| **Painel** | UI de administração embutida: instâncias, pareamento por QR, estado da chamada ao vivo, webhooks, logs, diagnóstico, autotestes. PT / EN / ES, claro / escuro. |
| **Documentação** | Manual completo servido pelo próprio serviço em `/docs`, em três idiomas, sem site externo. |

## Início rápido

Requisitos: Node.js ≥ 22.12 e Google Chrome (não o Chromium da distribuição — o vídeo precisa do codec H.264 dele).

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

1. Abra `http://127.0.0.1:18475/` e entre com a chave global (`ZAPCALL_API_KEY`, ou a gerada em `data/manager.json` no primeiro boot — o log mostra só uma versão mascarada).
2. **Nova instância** → dê um nome → **Parear** → leia o QR com o celular (*WhatsApp › Dispositivos conectados › Conectar dispositivo*).
3. Abra a aba **API** da instância: ela mostra o token e os comandos `curl` prontos.

## Docker

```bash
cp .env.example .env      # defina ZAPCALL_API_KEY, DEFAULT_COUNTRY_CODE, ALLOWED_ORIGINS conforme precisar
docker compose up -d
docker compose logs -f zapcall
```

A imagem é só `linux/amd64` e usa rede de host com o serviço preso a `127.0.0.1`. As sessões pareadas vivem no volume `zapcall_data`. Veja [docs/pt/docker.md](docs/pt/docker.md) para proxy reverso e TLS.

## A API em um minuto

```bash
# criar uma instância (chave global) → o token dela é hash.apikey
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: CHAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"vendas","webhook":"https://exemplo.com/zapcall"}'

# QR de pareamento (PNG base64 + arte de terminal)
curl http://127.0.0.1:18475/instance/connect/vendas -H "apikey: TOKEN_DA_INSTANCIA"

# ligar
curl -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: meu-backend" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","isVideo":false}'
# → {"callId":"…"}   ou   409 {"error":"channel_busy","call":{…}}

# eventos + mídia
ws://127.0.0.1:18475/instances/vendas/ws?clientId=meu-backend&token=TOKEN_DA_INSTANCIA
```

## Documentação

Servida pelo serviço em **`/docs`** (PT / EN / ES, com busca) e mantida em Markdown em [`docs/`](docs/): instalação, instâncias, autenticação, API REST, WebSocket, eventos, status, erros, chamadas de áudio, chamadas de vídeo, exemplos com curl e JavaScript, integração com CRM, segurança, Docker, variáveis de ambiente.

## Segurança

Leia [SECURITY.md](SECURITY.md): modelo de ameaça, controles embutidos, suas responsabilidades e como relatar uma vulnerabilidade. Resumo: tokens de instância ficam no backend, `DATA_DIR` é privado, TLS termina na frente e o serviço nunca sai do loopback sem um proxy autenticado.

## Desenvolvimento

```bash
npm run check   # verificação de sintaxe de todos os módulos
npm test        # testes unitários e de integração; o teste ponta a ponta do discador precisa do Chrome e é pulado sem ele
npm run probe   # autoteste de mídia num Chrome real, sem sessão do WhatsApp
```

Arquitetura e organização dos arquivos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Contribuições: [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitações

- **Uma chamada por instância** — regra do WhatsApp Web. Paralelismo = mais instâncias (cada uma usa uma das quatro vagas de dispositivo conectado do número).
- **O celular também toca** nas chamadas recebidas; quem atender primeiro fica com a chamada (`accepted_elsewhere` nos outros).
- **A mídia de retorno depende de módulos privados do WhatsApp Web.** Uma atualização pode quebrá-la; o sintoma é chamada conectada e muda com `nativeMedia.ready = false` em `/api/diag`.
- **Não é uma API multiusuário.** Um token de instância dá tudo naquela instância; autorização por usuário é do seu backend.
- **Termos de uso.** Automatizar o WhatsApp Web viola os termos da Meta; números podem ser banidos.

## Licença

[MIT](LICENSE). O ZapCall não é afiliado, endossado ou ligado ao WhatsApp LLC ou à Meta Platforms, Inc.
