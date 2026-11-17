# Roblox Studio ⇄ IA

Permite que uma IA (Claude) controle o Roblox Studio pelo MCP oficial que já vem embutido no Studio.

```
IA (Claude) ──▶ Vercel (/api/chat, /api/tool) ──▶ Ably ──▶ servidor local (Windows) ──▶ MCP do Studio (stdio)
                       ▲                            │
                       └──────── resposta ◀─────────┘
```

Todas as conexões partem do seu computador. O Vercel não guarda estado: ele só publica comandos no Ably e espera a resposta.

## Estrutura

| Caminho | Onde roda | Função |
|---|---|---|
| `api/chat.ts` | Vercel | Recebe uma mensagem, roda o loop de tool use com Claude e executa as ferramentas |
| `api/tool.ts` | Vercel | Executa uma ferramenta diretamente (útil para testes) |
| `api/ably-token.ts` | Vercel | Emite token Ably restrito para o servidor local |
| `lib/` | Vercel | Envio de comandos pelo Ably e autenticação |
| `local-bridge/` | Seu PC | Conecta no MCP do Studio e responde aos comandos |

## Segurança

- **Allowlist:** só as ferramentas listadas em `ALLOWED_TOOLS` são expostas à IA e aceitas pelo servidor local. Vazio significa nenhuma.
- **Token restrito:** o servidor local recebe um token Ably que só permite assinar `cmd:<MACHINE_ID>` e publicar em `res:*`. A chave principal fica só no Vercel.
- **Segredos separados:** `API_SECRET` (quem chama a IA) e `MACHINE_TOKEN` (quem é o seu PC) são independentes.
- **Ações destrutivas:** o prompt do sistema instrui a IA a não apagar nem sobrescrever sem pedido. A proteção real deve ser a allowlist.
- **Studio executa Luau com acesso total ao projeto.** Não libere ferramentas de execução de código sem revisão.

## Configuração

### 1. Ably
1. Crie uma conta em ably.com e um app.
2. Copie a *API key* com permissões de publicar e assinar.
3. Confira os limites do plano gratuito na página de preços antes de usar em produção.

### 2. Vercel
1. Importe este repositório no Vercel.
2. Em *Settings → Environment Variables*, preencha as variáveis de `.env.example`:
   - `ABLY_API_KEY`, `API_SECRET`, `MACHINE_TOKEN`, `MACHINE_ID`
   - `ANTHROPIC_API_KEY` e, se quiser, `ANTHROPIC_MODEL`
3. Gere segredos longos e aleatórios para `API_SECRET` e `MACHINE_TOKEN`. Use valores diferentes.

### 3. Studio
1. Abra o place no Roblox Studio.
2. Clique em **Assistant → ⋯ → Manage MCP Servers** e ligue **Enable Studio as MCP server**.
3. Confirme que o MCP funciona pelo `mcp.bat` do Roblox, em `%LOCALAPPDATA%\Roblox`. O bridge usa essa mesma configuração, com `cmd.exe /c` e o `mcp.bat`.

### 4. Servidor local (Windows)
```powershell
cd local-bridge
copy .env.example .env
# edite .env: MACHINE_ID, TOKEN_URL, MACHINE_TOKEN, ROBLOX_MCP_CMD
npm install
npm start
```

No primeiro start, o servidor lista as ferramentas do MCP com `[liberada]` ou `[bloqueada]`. Preencha `ALLOWED_TOOLS` com os nomes que quer liberar e reinicie.

## Testes

Com o servidor local rodando e o Studio com o MCP ligado:

```bash
# Ferramentas liberadas
curl -X POST https://SEU-PROJETO.vercel.app/api/chat \
  -H "Authorization: Bearer $API_SECRET" -H "Content-Type: application/json" \
  -d '{"message":"Liste a hierarquia do Workspace"}'

# Chamada direta
curl -X POST https://SEU-PROJETO.vercel.app/api/tool \
  -H "Authorization: Bearer $API_SECRET" -H "Content-Type: application/json" \
  -d '{"tool":"NOME_DA_FERRAMENTA","args":{}}'
```

Comece sempre com uma ferramenta de **leitura**. Só depois libere escrita.

## Limitações conhecidas

- Se o servidor local estiver desligado, a chamada retorna erro de timeout após 25 segundos.
- Mensagens publicadas enquanto o servidor local está offline são perdidas. Não há fila persistente.
- O MCP do Studio atende uma chamada por vez; o servidor local enfileira as chamadas.
- O endpoint `/api/chat` pode demorar em conversas longas. O limite está em 60 s no `config`, e o plano do Vercel precisa suportar esse valor.
- O servidor local não reconecta sozinho se o processo do MCP cair. Reinicie o `npm start`.

## Desenvolvimento

```bash
npm install
npm run typecheck          # na raiz (Vercel)
cd local-bridge && npm run typecheck
```
