import { createClient } from "@ably/pubsub-device";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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
const control = ably.channels.get(`control:${MACHINE_ID}`);
const health = ably.channels.get(`health:${MACHINE_ID}`);
let worker: ReturnType<typeof spawn> | null = null;
const prompts = new Set<string>();

function startWorker() {
  if (worker && worker.exitCode === null && !worker.killed) {
    console.log("[MANAGER] Worker já está em execução.");
    return;
  }
  console.log("[MANAGER] Iniciando o servidor MCP do Roblox Studio...");
  worker = spawn(process.execPath, ["--import", "tsx", "index.ts"], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[WORKER] ${chunk}`));
  worker.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[WORKER] ${chunk}`));
  worker.on("exit", (code, signal) => {
    console.log(`[MANAGER] Worker encerrou (code=${code}, signal=${signal}).`);
    worker = null;
  });
  worker.on("error", (error) => {
    console.error("[MANAGER] Não foi possível iniciar o worker:", error);
    worker = null;
  });
}

async function publishDecision(requestId: string, decision: "approved" | "denied") {
  await ably.channels.get(`approval-res:${requestId}`).publish("decision", { decision });
  if (decision === "approved") {
    await control.publish("start", { requestId, source: "windows" });
    startWorker();
  }
}

async function askOnWindows(requestId: string) {
  if (prompts.has(requestId)) return;
  prompts.add(requestId);
  try {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$answer = [System.Windows.Forms.MessageBox]::Show('O ChatGPT solicitou iniciar o servidor local do Roblox Studio. Deseja iniciar agora?','Roblox Studio - Solicitação de inicialização',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question)",
      "if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { 'approved' } else { 'denied' }",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: false,
      timeout: 120000,
    });
    const decision = stdout.trim().toLowerCase().includes("approved") ? "approved" : "denied";
    await publishDecision(requestId, decision);
  } catch (error) {
    console.error("[MANAGER] Falha na janela de aprovação:", error);
    try { await publishDecision(requestId, "denied"); } catch (publishError) {
      console.error("[MANAGER] Falha ao enviar decisão:", publishError);
    }
  } finally {
    prompts.delete(requestId);
  }
}

control.subscribe(async (message) => {
  const data = (message.data ?? {}) as { requestId?: string };
  if (message.name === "start") {
    startWorker();
  } else if (message.name === "approval_request" && data.requestId) {
    void askOnWindows(data.requestId);
  }
});

health.subscribe(async (message) => {
  if (message.name !== "ping") return;
  const data = (message.data ?? {}) as { requestId?: string };
  if (!data.requestId) return;
  try {
    await ably.channels.get(`health-res:${data.requestId}`).publish("pong", {
      managerOnline: true,
      workerRunning: Boolean(worker && worker.exitCode === null && !worker.killed),
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

console.log(`[MANAGER] Agente de inicialização ativo para ${MACHINE_ID}.`);
console.log("[MANAGER] Aguardando solicitações. O MCP só será iniciado após aprovação.");
