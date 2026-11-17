import { createClient } from "@ably/pubsub-device";
import { spawn } from "node:child_process";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} não definida no .env`);
  return value;
}
const MACHINE_ID = env("MACHINE_ID");
const TOKEN_URL = env("TOKEN_URL");
const MACHINE_TOKEN = env("MACHINE_TOKEN");

const ably = createClient({
  authUrl: TOKEN_URL,
  authHeaders: { Authorization: `Bearer ${MACHINE_TOKEN}` },
  clientId: MACHINE_ID,
});
const health = ably.channels.get(`health:${MACHINE_ID}`);
let worker: ReturnType<typeof spawn> | null = null;
let workerReady = false;

function startWorker() {
  if (worker && worker.exitCode === null && !worker.killed) return;

  console.log("[MANAGER] Iniciando automaticamente o servidor MCP do Roblox Studio...");
  workerReady = false;
  worker = spawn(process.execPath, ["--import", "tsx", "index.ts"], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let workerOutput = "";
  worker.stdout?.on("data", (chunk: Buffer) => {
    const output = chunk.toString();
    workerOutput = (workerOutput + output).slice(-4000);
    if (workerOutput.includes("Bridge ativo para")) {
      workerReady = true;
      console.log("[MANAGER] Worker MCP pronto para receber comandos.");
    }
    process.stdout.write(`[WORKER] ${output}`);
  });
  worker.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[WORKER] ${chunk}`));
  worker.on("exit", (code, signal) => {
    console.log(`[MANAGER] Worker encerrou (code=${code}, signal=${signal}).`);
    worker = null;
    workerReady = false;
  });
  worker.on("error", (error) => {
    console.error("[MANAGER] Não foi possível iniciar o worker:", error);
    worker = null;
    workerReady = false;
  });
}

health.subscribe(async (message) => {
  if (message.name !== "ping") return;
  const data = (message.data ?? {}) as { requestId?: string };
  if (!data.requestId) return;

  // O primeiro ping dispara a inicialização; pings seguintes acompanham a prontidão.
  if (!worker || worker.exitCode !== null || worker.killed) startWorker();

  try {
    await ably.channels.get(`health-res:${data.requestId}`).publish("pong", {
      managerOnline: true,
      workerRunning: Boolean(workerReady && worker && worker.exitCode === null && !worker.killed),
      workerStarting: Boolean(!workerReady && worker && worker.exitCode === null && !worker.killed),
    });
  } catch (error) {
    console.error("[MANAGER] Falha ao responder health check:", error);
  }
});

const shutdown = async () => {
  if (worker && worker.exitCode === null) worker.kill();
  ably.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[MANAGER] Agente automático ativo para ${MACHINE_ID}.`);
console.log("[MANAGER] O worker MCP será iniciado automaticamente quando uma ferramenta for solicitada.");
