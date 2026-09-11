# Autenticação

O ZapCall tem duas credenciais com dois alcances. As duas vão em header — `apikey: …` ou `Authorization: Bearer …`.

| Credencial | Alcance | Onde vive |
|---|---|---|
| **Chave global** | Tudo: criar, apagar e listar instâncias, ler tokens, o painel, `/manager/*`, `/instance/*`. | `ZAPCALL_API_KEY`, ou gerada no primeiro boot em `DATA_DIR/manager.json`. |
| **Token da instância** | Só aquela instância: chamadas, mensagens, eventos, o QR e o estado dela. | Criado com a instância; visível no painel (aba API); girado com `POST /instance/token/:nome`. |

## Regras

- A **chave global nunca é aceita na URL**. Ela iria parar em histórico de navegador, logs de proxy e `Referer`. Pedidos com `?token=<chave global>` recebem `401`.
- O **token da instância pode ir na URL** só onde o navegador não consegue mandar header: o WebSocket (`/instances/:nome/ws?token=…`), o discador e a página de pareamento. Essas páginas removem o token da barra de endereço imediatamente e toda resposta leva `Referrer-Policy: no-referrer`.
- A comparação é em **tempo constante**. Vinte tentativas erradas do mesmo IP em um minuto devolvem `429 too_many_attempts` para todo pedido daquele IP (até os válidos) até a janela passar.
- O painel guarda a chave global no `localStorage` do navegador e sempre a envia em header. Sair esquece a chave.

## Exemplos

```bash
# Chave global (administração)
curl http://127.0.0.1:18475/instance/fetchInstances -H "apikey: SUA_CHAVE_GLOBAL"

# Token da instância (integração)
curl http://127.0.0.1:18475/instance/connectionState/vendas -H "apikey: TOKEN_DA_INSTANCIA"
curl http://127.0.0.1:18475/instance/connectionState/vendas -H "Authorization: Bearer TOKEN_DA_INSTANCIA"
```

## Qual a minha integração deve usar?

O **token da instância**. Guarde-o no backend e autentique os seus usuários lá. O token é tudo-ou-nada para aquela instância (discar, atender, ouvir, ler e mandar mensagens), então nunca pode ir para o navegador do usuário final. Se precisar de um cliente no navegador, faça o WebSocket passar pelo seu backend ou abra uma sessão de curta duração do seu lado.

## Restringindo origens

Se um cliente de navegador for conectar direto, defina `ALLOWED_ORIGINS` com uma lista de origens separadas por vírgula. Com a lista definida, `Origin` fora dela é recusado (`403`) no HTTP e no upgrade do WebSocket, e o `Access-Control-Allow-Origin: *` aberto deixa de existir. Pedidos sem `Origin` (curl, backends) não são afetados.
