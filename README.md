# Roblox Studio ⇄ IA

Permite que qualquer IA que aceite conector ou plugin MCP controle o Roblox Studio, pelo MCP oficial que já vem embutido no Studio.

```
IA de fora (conector/plugin MCP)
        │  Streamable HTTP  (/api/mcp?key=...)
        ▼
Vercel ──── publica comando ────▶ Ably ────▶ servidor local (Windows) ────▶ MCP do Studio (stdio)
   ▲                                              │
   └──────────── resposta ◀───── Ably ◀──────────┘
```

Todas as conexões partem do seu computador. O Vercel não guarda estado: ele só repassa os pedidos pelo Ably e devolve a resposta.

O projeto não chama nenhum modelo de IA. Quem decide o que fazer é a IA que você conectar.

## Estrutura

| Caminho | Onde roda | Função |
|---|---|---|
| `api/mcp.ts` | Vercel | Servidor MCP remoto: lista e executa as ferramentas liberadas |
| `api/tool.ts` | Vercel | Executa uma ferramenta direto, com `Authorization: Bearer` (útil para testes) |
| `api/ably-token.ts` | Vercel | Emite token Ably restrito para o servidor local |
| `lib/` | Vercel | Envio de comandos pelo Ably e autenticação |
| `local-bridge/` | Seu PC | Conecta no MCP do Studio e responde aos comandos |

## Segurança

- **Allowlist:** só as ferramentas em `ALLOWED_TOOLS` aparecem para a IA e são aceitas pelo servidor local. Vazio significa nenhuma.
- **Token restrito:** o servidor local recebe um token Ably que só permite assinar `cmd:<MACHINE_ID>` e publicar em `res:*`. A chave principal fica só no Vercel.
- **Segredos separados:** `API_SECRET` (quem fala com o servidor) e `MACHINE_TOKEN` (quem é o seu PC) são independentes.
- **Segredo na URL:** conectores de IA nem sempre aceitam cabeçalhos, então o `API_SECRET` pode ir na query `?key=`. Essa URL funciona como senha: não a publique nem a cole em lugares públicos. Se a URL vazar, troque o `API_SECRET` na Vercel e reconecte.
- **Studio executa Luau com acesso total ao projeto.** Não libere ferramentas de execução de código sem revisão.

## Configuração

### 1. Ably
1. Crie uma conta em ably.com e um app.
2. Copie a *API key* com permissões de publicar e assinar.
3. Confira os limites do plano gratuito na página de preços antes de usar em produção.

### 2. Vercel
1. Importe este repositório no Vercel.
2. Em *Settings → Environment Variables*, preencha as variáveis de `.env.example`: `ABLY_API_KEY`, `API_SECRET`, `MACHINE_TOKEN` e `MACHINE_ID`.
3. Gere segredos longos e aleatórios para `API_SECRET` e `MACHINE_TOKEN`. Use valores diferentes.

### 3. Conectar a IA
A URL do servidor MCP é:

```
https://SEU-DOMINIO.vercel.app/api/mcp?key=SEU_API_SECRET
```

Exemplo de adição como conector personalizado, no formato usado pelos clientes MCP. Os nomes dos menus mudam com o tempo, então siga a documentação do cliente:

- **Claude (claude.ai):** Settings → Connectors → *Add custom connector* → cole a URL.
- **ChatGPT:** Settings → Connectors (modo desenvolvedor) → adicione um servidor MCP com a URL.
- **Outros clientes MCP:** use a URL como endpoint do tipo *Streamable HTTP*.

Se o cliente exigir OAuth, a URL com `?key=` não vai funcionar. Nesse caso, avise, porque será preciso adicionar OAuth ao servidor.

### 4. Studio
1. Abra o place no Roblox Studio.
2. Clique em **Assistant → ⋯ → Manage MCP Servers** e ligue **Enable Studio as MCP server**.
3. Confirme que o MCP funciona pelo `mcp.bat` do Roblox, em `%LOCALAPPDATA%\Roblox`. O bridge usa essa mesma configuração, com `cmd.exe /c` e o `mcp.bat`.

### 5. Servidor local (Windows)
Use o `roblox-studio-local-bridge.zip` ou, a partir do repositório:

```powershell
cd local-bridge
copy .env.example .env
# edite .env: MACHINE_ID, TOKEN_URL, MACHINE_TOKEN
npm install
npm start
```

No primeiro start, o servidor lista as ferramentas do MCP com `[liberada]` ou `[bloqueada]`. Preencha `ALLOWED_TOOLS` com os nomes que quer liberar e reinicie.

## Testes

Com o servidor local rodando e o Studio com o MCP ligado:

```bash
# Chamada direta de uma ferramenta liberada
curl -X POST https://SEU-DOMINIO.vercel.app/api/tool \
  -H "Authorization: Bearer $API_SECRET" -H "Content-Type: application/json" \
  -d '{"tool":"NOME_DA_FERRAMENTA","args":{}}'

# Lista de ferramentas via MCP (mesmo que a IA veria)
curl -X POST "https://SEU-DOMINIO.vercel.app/api/mcp?key=$API_SECRET" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Comece sempre com uma ferramenta de **leitura**. Só depois libere escrita.

## Limitações conhecidas

- Se o servidor local estiver desligado, a chamada retorna erro de timeout após 25 segundos.
- Mensagens publicadas enquanto o servidor local está offline são perdidas. Não há fila persistente.
- O MCP do Studio atende uma chamada por vez; o servidor local enfileira as chamadas.
- A lista de ferramentas é pedida ao PC a cada `tools/list`, então o PC precisa estar ligado para a IA ver qualquer ferramenta.
- O servidor local não reconecta sozinho se o processo do MCP cair. Reinicie o `npm start`.
- Ainda não testado com um cliente real de IA. O teste feito foi do protocolo MCP localmente.

## Desenvolvimento

```bash
npm install
npm run typecheck          # na raiz (Vercel)
cd local-bridge && npm run typecheck
```
