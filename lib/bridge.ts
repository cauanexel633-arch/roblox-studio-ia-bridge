import { createHttpClient, createRealtimeClient } from "@ably/pubsub-server";
import { randomUUID } from "crypto";

export type BridgeReply =
  | { ok: true; result?: unknown; tools?: unknown[] }
  | { ok: false; error: string };

const REPLY_TIMEOUT_MS = 25_000;

/**
 * Envia um comando ao servidor local pelo Ably e aguarda a resposta.
 *
 * - "list": pede ao servidor local as ferramentas liberadas (allowlist).
 * - "call": pede a execução de uma ferramenta.
 *
 * Usa o SDK de servidor (@ably/pubsub-server), exigido pelo preço por MAU.
 * O canal de resposta é assinado ANTES de o comando ser publicado.
 */
export async function sendToBridge(
  name: "list" | "call",
  data: Record<string, unknown> = {}
): Promise<BridgeReply> {
  const machineId = process.env.MACHINE_ID;
  const key = process.env.ABLY_API_KEY;
  if (!machineId) return { ok: false, error: "MACHINE_ID não configurado" };
  if (!key) return { ok: false, error: "ABLY_API_KEY não configurada" };

  const requestId = randomUUID();
  const realtime = createRealtimeClient({ key });
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const resChannel = realtime.channels.get(`res:${requestId}`);

    const reply = new Promise<BridgeReply>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("timeout: o servidor local não respondeu (está ligado e conectado?)")),
        REPLY_TIMEOUT_MS
      );
      // Falha de conexão com o Ably deve virar erro imediato, não esperar o timeout
      realtime.connection.on("failed", (change) => {
        reject(new Error(`Ably: conexão falhou (${change.reason?.message ?? "motivo desconhecido"})`));
      });
      resChannel.subscribe("result", (msg) => resolve(msg.data as BridgeReply));
    });

    await resChannel.attach();

    await createHttpClient({ key })
      .channels.get(`cmd:${machineId}`)
      .publish(name, { requestId, ...data });

    return await reply;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    try {
      realtime.close();
    } catch {
      // conexão já encerrada
    }
  }
}
