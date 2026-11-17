import { createHttpClient, createRealtimeClient } from "@ably/pubsub-server";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

export type BridgeReply =
  | { ok: true; result?: unknown; tools?: unknown[] }
  | { ok: false; error: string };

const REPLY_TIMEOUT_MS = 25_000;
const MANAGER_PING_TIMEOUT_MS = 1_500;
const APPROVAL_TIMEOUT_MS = 60_000;
const STARTUP_TIMEOUT_MS = 12_000;
const MAX_DECOMPRESSED_REPLY_BYTES = 10 * 1024 * 1024;

type EncodedBridgeReply = { __bridgeEncoding: "gzip+base64"; payload: string };


function decodeBridgeReply(data: unknown): BridgeReply {
  if (
    data && typeof data === "object" && "__bridgeEncoding" in data &&
    (data as EncodedBridgeReply).__bridgeEncoding === "gzip+base64"
  ) {
    const encoded = data as EncodedBridgeReply;
    if (typeof encoded.payload !== "string") throw new Error("Resposta comprimida inválida");
    const json = gunzipSync(Buffer.from(encoded.payload, "base64"), {
      maxOutputLength: MAX_DECOMPRESSED_REPLY_BYTES,
    }).toString("utf8");
    return JSON.parse(json) as BridgeReply;
  }
  return data as BridgeReply;
}

type ManagerStatus = { managerOnline: boolean; workerRunning: boolean; workerStarting?: boolean };

async function pingManager(machineId: string, key: string): Promise<ManagerStatus | null> {
  const requestId = randomUUID();
  const realtime = createRealtimeClient({ key });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const channel = realtime.channels.get(`health-res:${requestId}`);
    const response = new Promise<ManagerStatus | null>((resolve) => {
      timer = setTimeout(() => resolve(null), MANAGER_PING_TIMEOUT_MS);
      channel.subscribe("pong", (message) => resolve(message.data as ManagerStatus));
    });
    await channel.attach();
    await createHttpClient({ key }).channels.get(`health:${machineId}`).publish("ping", { requestId });
    return await response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    realtime.close();
  }
}

function approvalSignature(requestId: string, decision: string, expiresAt: number): string {
  const secret = process.env.API_SECRET;
  if (!secret) throw new Error("API_SECRET não configurado");
  return createHmac("sha256", secret)
    .update(`telegram-approval:v1:${requestId}:${decision}:${expiresAt}`)
    .digest("hex")
    .slice(0, 12);
}

async function sendTelegramApproval(requestId: string, expiresAt: number): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    throw new Error("Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID na Vercel para habilitar a aprovação pelo iPhone.");
  }
  const callback = (decision: "approved" | "denied") => {
    const signature = approvalSignature(requestId, decision, expiresAt);
    return `rbx|${requestId}|${decision}|${expiresAt}|${signature}`;
  };

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "O ChatGPT solicitou iniciar o servidor local do Roblox Studio. Deseja iniciar agora?",
      reply_markup: {
        inline_keyboard: [[
          { text: "▶ Iniciar", callback_data: callback("approved") },
          { text: "✖ Negar", callback_data: callback("denied") },
        ]],
      },
    }),
  });
  if (!response.ok) throw new Error(`Telegram não enviou a notificação (HTTP ${response.status})`);
  const result = await response.json() as { ok?: boolean; description?: string };
  if (!result.ok) throw new Error(result.description ?? "Falha ao enviar notificação do Telegram");
}

async function waitForApproval(machineId: string, key: string): Promise<"approved" | "denied" | "expired"> {
  const requestId = randomBytes(12).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + Math.ceil(APPROVAL_TIMEOUT_MS / 1000);
  const realtime = createRealtimeClient({ key });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const responseChannel = realtime.channels.get(`approval-res:${requestId}`);
    const decisionPromise = new Promise<"approved" | "denied" | "expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), APPROVAL_TIMEOUT_MS);
      responseChannel.subscribe("decision", (message) => {
        const decision = (message.data as { decision?: string })?.decision;
        if (decision === "approved" || decision === "denied") resolve(decision);
      });
    });
    await responseChannel.attach();

    // Dispara as duas notificações. Uma falha não impede a outra de funcionar.
    const [telegramResult, windowsResult] = await Promise.allSettled([
      sendTelegramApproval(requestId, expiresAt),
      createHttpClient({ key }).channels.get(`control:${machineId}`).publish("approval_request", {
        requestId,
        expiresAt,
        message: "O ChatGPT solicitou iniciar o servidor local do Roblox Studio.",
      }),
    ]);
    if (telegramResult.status === "rejected" && windowsResult.status === "rejected") {
      throw new Error("Não foi possível enviar a solicitação ao Telegram nem ao agente Windows.");
    }

    return await decisionPromise;
  } finally {
    clearTimeout(timer);
    realtime.close();
  }
}

async function ensureWorker(machineId: string, key: string): Promise<BridgeReply | null> {
  const status = await pingManager(machineId, key);
  if (status?.workerRunning) return null;
  if (status?.workerStarting) {
    const startupDeadline = Date.now() + 12_000;
    while (Date.now() < startupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const current = await pingManager(machineId, key);
      if (current?.workerRunning) return null;
      if (!current?.workerStarting) break;
    }
    return { ok: false, error: "O servidor MCP está iniciando, mas não ficou pronto dentro do prazo. Verifique os logs do agente Windows." };
  }

  let decision: "approved" | "denied" | "expired";
  try {
    decision = await waitForApproval(machineId, key);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (decision === "denied") {
    return { ok: false, error: "Solicitação de inicialização negada. O servidor local não foi iniciado." };
  }
  if (decision === "expired") {
    return { ok: false, error: "A solicitação de inicialização expirou sem uma resposta. O servidor local continua desligado." };
  }

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await pingManager(machineId, key);
    if (current?.workerRunning) return null;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return {
    ok: false,
    error: "A solicitação foi aceita, mas o agente do Windows não iniciou o servidor. Verifique se o agente de inicialização está aberto no PC.",
  };
}

/**
 * Garante que o worker MCP esteja ativo antes de listar ferramentas ou executar
 * uma chamada. Se estiver parado, solicita aprovação por Telegram/Windows.
 */
export async function sendToBridge(
  name: "list" | "call",
  data: Record<string, unknown> = {}
): Promise<BridgeReply> {
  const machineId = process.env.MACHINE_ID;
  const key = process.env.ABLY_API_KEY;
  if (!machineId) return { ok: false, error: "MACHINE_ID não configurado" };
  if (!key) return { ok: false, error: "ABLY_API_KEY não configurada" };

  const readinessError = await ensureWorker(machineId, key);
  if (readinessError) return readinessError;

  const requestId = randomUUID();
  const realtime = createRealtimeClient({ key });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resChannel = realtime.channels.get(`res:${requestId}`);
    const reply = new Promise<BridgeReply>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("timeout: o servidor local não respondeu dentro do prazo")),
        REPLY_TIMEOUT_MS
      );
      realtime.connection.on("failed", (change) => {
        reject(new Error(`Ably: conexão falhou (${change.reason?.message ?? "motivo desconhecido"})`));
      });
      resChannel.subscribe("result", (message) => {
        try { resolve(decodeBridgeReply(message.data)); }
        catch (error) {
          reject(new Error(`Falha ao decodificar resposta do bridge: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });

    await resChannel.attach();
    await createHttpClient({ key }).channels.get(`cmd:${machineId}`).publish(name, {
      requestId,
      ...data,
    });
    return await reply;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    try { realtime.close(); } catch { /* conexão já encerrada */ }
  }
}
