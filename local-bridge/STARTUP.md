# Agente de inicialização automática (Windows)

O agente `manager.ts` deve ficar ativo em segundo plano. Ele não inicia o MCP do Roblox até receber uma aprovação. O processo MCP atual continua em `index.ts` e é iniciado pelo agente quando você aceita.

## Instalação

Na pasta `local-bridge`:

```powershell
npm install
npm start
```

O comando `npm start` inicia apenas o agente de aprovação. Para iniciar o MCP manualmente para testes, use:

```powershell
npm run worker
```

## Iniciar o agente junto com o Windows

1. Abra o **Agendador de Tarefas**.
2. Escolha **Criar Tarefa**.
3. Em **Geral**, marque **Executar somente quando o usuário estiver conectado**.
4. Em **Disparadores**, crie um disparador **Ao fazer logon**.
5. Em **Ações**, escolha **Iniciar um programa**:
   - Programa: `cmd.exe`
   - Argumentos: `/c cd /d "CAMINHO_COMPLETO\local-bridge" && npm start`
6. Salve e teste a tarefa.

O agente precisa estar ativo para exibir a janela de aprovação no Windows e iniciar o MCP. A janela de aprovação oferece **Sim** e **Não**. O iPhone recebe os mesmos botões pelo bot do Telegram.
