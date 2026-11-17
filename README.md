# Roblox Studio ⇄ IA

Permite que qualquer IA com suporte a MCP controle o Roblox Studio usando o servidor MCP oficial do Studio.

```
IA (MCP) → Vercel → Ably → agente Windows → MCP oficial do Roblox Studio
```

O agente Windows fica ativo em segundo plano. Quando uma ferramenta é solicitada e o worker MCP está parado, o agente o inicia automaticamente, sem confirmação no Telegram ou no Windows.

## Estrutura

| Caminho | Função |
|---|---|
| `api/mcp.ts` | Servidor MCP remoto |
| `api/ably-token.ts` | Token Ably restrito para os processos locais |
| `lib/bridge.ts` | Verifica a prontidão e encaminha comandos |
| `local-bridge/manager.ts` | Agente Windows: health check e inicialização automática |
| `local-bridge/index.ts` | Worker MCP conectado ao Roblox Studio |

## Configuração

### 1. Variáveis da Vercel

Mantenha as variáveis já existentes: `ABLY_API_KEY`, `API_SECRET`, `MACHINE_TOKEN` e `MACHINE_ID`.

As variáveis de Telegram não são mais necessárias para iniciar o servidor.

### 2. Agente Windows

Na pasta `local-bridge`, mantenha seu `.env` atual com `MACHINE_ID`, `TOKEN_URL` e `MACHINE_TOKEN`.

Esta implementação está na branch `feature/telegram-start-approval`. Para atualizar e testar:

```powershell
git pull origin feature/telegram-start-approval
cd local-bridge
npm install
npm start
```

`npm start` mantém o agente Windows ativo. O worker MCP será iniciado automaticamente quando a primeira ferramenta for solicitada. Para iniciar o worker manualmente durante testes: `npm run worker`.

Para iniciar o agente automaticamente ao entrar no Windows, crie uma tarefa no **Agendador de Tarefas**:
- Disparador: **Ao fazer logon**.
- Ação: `cmd.exe`.
- Argumentos: `/c cd /d "CAMINHO_COMPLETO\local-bridge" && npm start`.
- Marque **Executar somente quando o usuário estiver conectado**.

### 3. Como funciona

1. O GPT solicita uma ferramenta.
2. A Vercel envia um health ping ao agente Windows.
3. Se o worker MCP estiver parado, o agente inicia o processo automaticamente.
4. A Vercel aguarda a confirmação de prontidão do worker e só então envia o comando solicitado.
5. Se o agente Windows não responder ou o worker não ficar pronto em 30 segundos, o GPT recebe um erro explicativo.

## Segurança e limitações

- O token Ably local é limitado aos canais de comando, health e resposta.
- O PC precisa estar ligado e o agente Windows ativo. O fluxo não liga fisicamente um PC desligado.
- O endpoint MCP foi configurado para até 60 segundos; o cliente MCP também pode impor seu próprio limite.
- O Studio executa código Luau com acesso ao projeto. Libere apenas ferramentas revisadas em `ALLOWED_TOOLS`.
