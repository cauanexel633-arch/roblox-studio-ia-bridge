import Ably from "ably";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Variável ${name} não definida no .env`);
  return value;
}

const MACHINE_ID = env("MACHINE_ID");
const TOKEN_URL = env("TOKEN_URL");
const MACHINE_TOKEN = env("MACHINE_TOKEN");
const MCP_CMD = env("ROBLOX_MCP_CMD");
const MCP_ARGS = (process.env.ROBLOX_MCP_ARGS ?? "--stdio").split(/\s+/).filter(Boolean);
const ALLOWED = new Set(
  (process.env.ALLOWED_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
);
const UUID = /^[0-9a-f-]{36}$/i;

// 1. MCP oficial do Studio, como processo filho via stdio
const mcp = new Client({ name: "roblox-studio-ia-bridge", version: "0.1.0" });
await mcp.connect(new StdioClientTransport({ command: MCP_CMD, args: MCP_ARGS }));

const { tools: available } = await mcp.listTools();
console.log("Ferramentas expostas pelo MCP do Studio:");
for (const t of available) {
  console.log(` - ${t.name}${ALLOWED.has(t.name) ? "  [liberada]" : "  [bloqueada]"}`);
}
if (ALLOWED.size === 0) {
  console.warn("ALLOWED_TOOLS está vazio: nenhuma ferramenta será exposta à IA.");
}

// 2. Fila de execução: o Studio atende uma chamada por vez
let queue: Promise<unknown> = Promise.resolve();
function enqueue(job: () => Promise<void>): Promise<void> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

// 3. Ably com token restrito emitido pelo Vercel
const ably = new Ably.Realtime({
  authUrl: TOKEN_URL,
  authHeaders: { Authorization: `Bearer ${MACHINE_TOKEN}` },
  clientId: MACHINE_ID,
});

const cmd = ably.channels.get(`cmd:${MACHINE_ID}`);

cmd.subscribe((msg) => {
  const { requestId, tool, args } = (msg.data ?? {}) as {
    requestId?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };

  if (!requestId || !UUID.test(requestId)) {
    console.warn("Comando ignorado: requestId inválido");
    return;
  }

  const out = ably.channels.get(`res:${requestId}`);
  const reply = (payload: object) =>
    out.publish("result", payload).catch((e) => console.error("Falha ao publicar resposta:", e));

  enqueue(async () => {
    if (msg.name === "list") {
      const { tools } = await mcp.listTools();
      await reply({ ok: true, tools: tools.filter((t) => ALLOWED.has(t.name)) });
      return;
    }

    if (msg.name === "call") {
      if (!tool || !ALLOWED.has(tool)) {
        console.warn(`Bloqueado: ${tool}`);
        await reply({ ok: false, error: `ferramenta não permitida: ${tool}` });
        return;
      }
      console.log(`Executando: ${tool}`);
      const result = await mcp.callTool({ name: tool, arguments: args ?? {} });
      await reply({ ok: true, result });
      return;
    }

    await reply({ ok: false, error: `comando desconhecido: ${msg.name}` });
  }).catch((err) => reply({ ok: false, error: String(err?.message ?? err) }));
});

const shutdown = async () => {
  ably.close();
  await mcp.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Bridge ativo para ${MACHINE_ID}. Aguardando comandos...`);
