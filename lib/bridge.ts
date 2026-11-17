import { createHttpClient, createRealtimeClient } from "@ably/pubsub-server";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

export type BridgeReply =
  | { ok: true; result?: unknown; tools?: unknown[] }
  | { ok: false; error: string };

const REPLY_TIMEOUT_MS = 25_000;
const MANAGER_PING_TIMEOUT_MS = 1_500;
const STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_POLL_MS = 700;
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

/**
 * O manager inicia o worker automaticamente ao receber o primeiro health ping.
 * A chamada só prossegue depois que o worker confirmar que está pronto.
 */
async function ensureWorker(machineId: string, key: string): Promise<BridgeReply | null> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let managerWasSeen = false;

  while (Date.now() < deadline) {
    const status = await pingManager(machineId, key);
    if (status) {
      managerWasSeen = true;
      if (status.workerRunning) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_MS));
  }

  if (!managerWasSeen) {
    return {
      ok: false,
      error: "O agente Windows não respondeu. Abra o agente local com npm start e tente novamente.",
    };
  }
  return {
    ok: false,
    error: "O servidor MCP não ficou pronto em 30 segundos. Verifique os logs do agente Windows e a conexão com o Roblox Studio.",
  };
}

/**
 * Garante que o worker MCP esteja ativo antes de listar ferramentas ou executar
 * uma chamada. Se estiver parado, o manager Windows inicia-o automaticamente.
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
