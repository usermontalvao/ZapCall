# Exemplos com curl

Troque `CHAVE_GLOBAL`, `TOKEN_DA_INSTANCIA` e `vendas` pelos seus. A URL base é o gerente (`http://127.0.0.1:18475`).

## Administração (chave global)

```bash
# Criar uma instância
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: CHAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"vendas","channel":"Atendimento"}'

# Listar instâncias com estado ao vivo
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: CHAVE_GLOBAL"

# Trocar o rótulo, desligar, definir webhook — qualquer subconjunto
curl -X POST http://127.0.0.1:18475/instance/update/vendas \
  -H "apikey: CHAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"channel":"Financeiro","webhook":{"url":"https://exemplo.com/zapcall","events":["incoming_call","call_ended"]}}'

# Girar o token (o antigo para de valer; a instância reinicia)
curl -X POST http://127.0.0.1:18475/instance/token/vendas -H "apikey: CHAVE_GLOBAL"

# Excluir, apagando a sessão pareada também
curl -X DELETE "http://127.0.0.1:18475/instance/delete/vendas?purge=1" -H "apikey: CHAVE_GLOBAL"
```

## Pareamento

```bash
# QR em PNG base64 + arte de terminal
curl http://127.0.0.1:18475/instance/connect/vendas -H "apikey: TOKEN_DA_INSTANCIA"

# Desenhar no terminal (precisa do jq)
curl -s http://127.0.0.1:18475/instance/connect/vendas -H "apikey: TOKEN_DA_INSTANCIA" | jq -r .ansi

# Estado
curl http://127.0.0.1:18475/instance/connectionState/vendas -H "apikey: TOKEN_DA_INSTANCIA"
```

## Chamadas (token da instância)

```bash
# Chamada de voz
curl -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: meu-backend" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","isVideo":false}'

# Chamada de vídeo
curl -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: meu-backend" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","isVideo":true}'

# Segunda chamada com a linha ocupada → 409 channel_busy
curl -i -X POST http://127.0.0.1:18475/call/offer/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" -d '{"number":"5511888888888"}'

# Atender / recusar / mudo / desligar
curl -X POST http://127.0.0.1:18475/call/accept/vendas -H "apikey: TOKEN_DA_INSTANCIA" -H "x-client-id: meu-backend" -H "Content-Type: application/json" -d '{"callId":"3EB0…","video":false}'
curl -X POST http://127.0.0.1:18475/call/reject/vendas -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'
curl -X POST http://127.0.0.1:18475/call/mute/vendas   -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…","muted":true}'
curl -X POST http://127.0.0.1:18475/call/hangup/vendas -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" -d '{"callId":"3EB0…"}'

# Chamadas conhecidas
curl http://127.0.0.1:18475/call/status/vendas -H "apikey: TOKEN_DA_INSTANCIA"
```

## Mensagens

```bash
curl -X POST http://127.0.0.1:18475/message/sendText/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"number":"5511999999999","text":"Olá! Posso te ligar?"}'

curl -X POST http://127.0.0.1:18475/message/sendMedia/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" \
  -d "{\"number\":\"5511999999999\",\"mediatype\":\"image\",\"mimetype\":\"image/jpeg\",\"caption\":\"Boleto\",\"fileName\":\"boleto.jpg\",\"media\":\"$(base64 -i boleto.jpg)\"}"

curl -X POST http://127.0.0.1:18475/chat/whatsappNumbers/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"numbers":["5511999999999"]}'
```

## Webhook

```bash
curl -X POST http://127.0.0.1:18475/webhook/set/vendas \
  -H "apikey: TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" \
  -d '{"url":"https://exemplo.com/zapcall","enabled":true,"events":[]}'

curl http://127.0.0.1:18475/webhook/find/vendas -H "apikey: TOKEN_DA_INSTANCIA"
```

## Saúde e diagnóstico

```bash
curl -i http://127.0.0.1:18475/healthz
curl http://127.0.0.1:18475/manager/system -H "apikey: CHAVE_GLOBAL"
curl -X POST http://127.0.0.1:18475/manager/instances/vendas/selftest -H "apikey: CHAVE_GLOBAL"
curl http://127.0.0.1:18475/instances/vendas/api/diag -H "Authorization: Bearer TOKEN_DA_INSTANCIA"

# Uma chamada recebida FALSA, para exercitar a UI do seu cliente sem ligar para ninguém
curl -X POST http://127.0.0.1:18475/instances/vendas/api/debug/fake-incoming \
  -H "Authorization: Bearer TOKEN_DA_INSTANCIA" -H "Content-Type: application/json" -d '{"video":false}'
```

## WebSocket pelo terminal

Com o [websocat](https://github.com/vi/websocat):

```bash
websocat "ws://127.0.0.1:18475/instances/vendas/ws?clientId=shell&token=TOKEN_DA_INSTANCIA"
```

Linhas de texto são eventos; quadros binários são mídia (o websocat os imprime como bytes crus — use um cliente de verdade para áudio).
