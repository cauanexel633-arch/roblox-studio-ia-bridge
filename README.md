# Roblox Studio ⇄ IA

Permite que qualquer IA com suporte a MCP controle o Roblox Studio usando o servidor MCP oficial do Studio.

```
IA (MCP) → Vercel → Ably → agente Windows → MCP oficial do Roblox Studio
                    ↘ Telegram (aprovação no iPhone)
```

O agente Windows fica ativo em segundo plano. O processo MCP do Studio só é iniciado após aprovação explícita.

## Estrutura

| Caminho | Função |
|---|---|
| `api/mcp.ts` | Servidor MCP remoto |
| `api/ably-token.ts` | Token Ably restrito para os processos locais |
| `api/telegram-webhook.ts` | Recebe decisões dos botões do Telegram |
| `lib/bridge.ts` | Verifica o agente, solicita aprovação e encaminha comandos |
| `local-bridge/manager.ts` | Agente Windows: janela local, health check e inicialização |
| `local-bridge/index.ts` | Worker MCP conectado ao Roblox Studio |

## Configuração

### 1. Variáveis da Vercel

Mantenha as variáveis já existentes: `ABLY_API_KEY`, `API_SECRET`, `MACHINE_TOKEN`, `MACHINE_ID`. Adicione:

- `TELEGRAM_BOT_TOKEN`: token criado pelo BotFather.
- `TELEGRAM_CHAT_ID`: ID numérico da conversa privada com o bot.
- `TELEGRAM_WEBHOOK_SECRET`: segredo aleatório usado para validar o webhook.

Não compartilhe esses valores no chat nem os coloque no GitHub.

### 2. Criar o bot do Telegram

1. No Telegram, abra **@BotFather**, envie `/newbot` e conclua a criação.
2. Configure o token retornado como `TELEGRAM_BOT_TOKEN` na Vercel.
3. Abra o bot recém-criado no iPhone e envie `/start`.
4. Obtenha seu ID numérico de conversa por um bot de consulta de ID confiável e configure `TELEGRAM_CHAT_ID` na Vercel.
5. Gere um segredo aleatório longo e configure `TELEGRAM_WEBHOOK_SECRET` na Vercel.
6. Depois do deploy, registre o webhook no PowerShell, substituindo os marcadores localmente:

```powershell
$bot = "TOKEN_DO_BOT"
$secret = "SEGREDO_DO_WEBHOOK"
$body = @{
  url = "https://roblox-studio-ia-bridge.vercel.app/api/telegram-webhook"
  secret_token = $secret
}
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$bot/setWebhook" -Body $body
```

### 3. Agente Windows

Na pasta `local-bridge`, mantenha seu `.env` atual com `MACHINE_ID`, `TOKEN_URL` e `MACHINE_TOKEN`.

Esta implementação está na branch `feature/telegram-start-approval`. Para testar:

```powershell
git fetch origin
git checkout feature/telegram-start-approval
cd local-bridge
npm install
npm start
```

`npm start` inicia somente o agente de aprovação, não o MCP do Roblox. Para iniciar o worker manualmente durante testes: `npm run worker`.

Para iniciar o agente automaticamente ao entrar no Windows, crie uma tarefa no **Agendador de Tarefas**:
- Disparador: **Ao fazer logon**.
- Ação: `cmd.exe`.
- Argumentos: `/c cd /d "CAMINHO_COMPLETO\local-bridge" && npm start`.
- Marque **Executar somente quando o usuário estiver conectado**, pois a janela local precisa aparecer na área de trabalho.

### 4. Como funciona

1. O GPT solicita uma ferramenta.
2. Se o worker MCP estiver parado, a Vercel envia uma solicitação ao Telegram e ao agente Windows.
3. No Windows aparece uma janela com **Sim/Não**; no iPhone, o Telegram apresenta **Iniciar/Negar**.
4. Se aprovado, o agente inicia o worker MCP e a chamada tenta continuar.
5. Se negado, o GPT recebe uma resposta informando que a solicitação foi negada. Sem resposta em 15 segundos, a solicitação expira.

## Segurança e limitações

- Os botões do Telegram usam assinatura HMAC; o webhook também valida o segredo configurado no Telegram.
- O token Ably local é limitado aos canais de comando, controle, health e resposta.
- O PC precisa estar ligado e o agente Windows ativo. Aprovação remota não liga fisicamente um PC desligado.
- A janela do Windows só aparece quando o usuário está conectado.
- O endpoint MCP foi configurado para até 60 segundos; o cliente MCP também pode impor seu próprio limite.
- O fluxo ainda precisa ser testado com as credenciais reais do Telegram e no PC.
- O Studio executa código Luau com acesso ao projeto. Libere apenas ferramentas revisadas em `ALLOWED_TOOLS`.
