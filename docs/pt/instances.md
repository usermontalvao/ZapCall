# Criação de instâncias

Uma **instância** é uma sessão do WhatsApp Web: o próprio Chrome, o próprio diretório de perfil, o próprio token e **uma chamada por vez** (regra do WhatsApp Web, não uma escolha do ZapCall). Vários números = várias instâncias, todas atrás do mesmo gerente.

## Pelo painel

**Instâncias › Nova instância**. Campos:

| Campo | Regras |
|---|---|
| Nome | Vai na URL e no diretório de dados: `a-z`, `0-9`, `-`, `_`, até 32 caracteres, começando por letra ou dígito. |
| Rótulo | Texto livre mostrado no painel (`Atendimento`). Opcional. |
| Webhook | URL que recebe os eventos por `POST`. Opcional; pode ser definido depois. |

Depois de criar, a janela de pareamento abre sozinha.

## Pela API

Rota no estilo Evolution (exige a chave global):

```bash
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: SUA_CHAVE_GLOBAL" -H "Content-Type: application/json" \
  -d '{"instanceName":"vendas","channel":"Atendimento","webhook":"https://exemplo.com/zapcall"}'
```

```json
{ "instance": { "instanceName": "vendas", "state": "connecting", "connected": false, "busy": false, "port": 18500, "…": "…" },
  "hash": { "apikey": "TOKEN_DA_INSTANCIA" } }
```

`hash.apikey` é o **token da instância**: a única credencial que a sua integração precisa. Guarde no backend.

O equivalente no estilo do gerente é `POST /manager/instances` com `{ "name", "channel" }`, que devolve `{ "instance": { …, "token" } }`.

## Pareamento

Parear vincula a instância a um número. O QR gira a cada ~20 s.

- **Painel**: *Parear* na linha da instância ou na gaveta de detalhes.
- **API**: `GET /instance/connect/:nome` devolve `{ code, base64, ansi }` — `base64` já serve num `<img src>`, `ansi` desenha o QR no terminal.
- **Página de pareamento**: `/instances/:nome/pair?token=TOKEN_DA_INSTANCIA` (o token sai da URL assim que a página carrega).

Depois de pareada, a sessão sobrevive a reinícios: ela mora em `DATA_DIR/instances/<nome>/profile`.

## Ciclo de vida

| Ação | Painel | API |
|---|---|---|
| Reiniciar o Chrome (mantém a sessão) | *Reiniciar* | `POST /instance/restart/:nome` |
| Desligar / ligar (parar o processo) | Zona de perigo | `POST /instance/update/:nome` `{ "enabled": false }` |
| Desparear (apaga a sessão, volta ao QR) | Zona de perigo › *Desparear* | `DELETE /instance/logout/:nome` |
| Girar o token | Zona de perigo › *Gerar outro token* | `POST /instance/token/:nome` |
| Excluir | Zona de perigo › *Excluir* (digite o nome) | `DELETE /instance/delete/:nome` (`?purge=1` apaga a sessão também) |

Se o Chrome de uma instância morrer, o gerente o reinicia com recuo exponencial (2 s … 60 s). Processos de Chrome órfãos que ainda seguram o perfil são encerrados antes de o novo subir.

## Capacidade

Cada instância ocupa uma das vagas de dispositivo conectado do número (o WhatsApp permite quatro) e ~1 GB de RAM. A aba **Diagnóstico** mostra o peso de cada Chrome; acima de ~1,5 GB por instância, ou com menos de 15 % de memória livre, não crie mais instâncias nessa máquina.
