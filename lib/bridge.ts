import Ably from "ably";
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
 * O canal de resposta é assinado ANTES de o comando ser publicado,
 * para que a resposta nunca chegue antes da assinatura.
 */
export async function sendToBridge(
  name: "list" | "call",
  data: Record<string, unknown> = {}
): Promise<BridgeReply> {
  const machineId = process.env.MACHINE_ID;
  if (!machineId) return { ok: false, error: "MACHINE_ID não configurado" };

  const requestId = randomUUID();
  const realtime = new Ably.Realtime({ key: process.env.ABLY_API_KEY! });
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const resChannel = realtime.channels.get(`res:${requestId}`);

    const reply = new Promise<BridgeReply>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("timeout: o servidor local não respondeu (está ligado e conectado?)")),
        REPLY_TIMEOUT_MS
      );
      resChannel.subscribe("result", (msg) => resolve(msg.data as BridgeReply));
    });

    await resChannel.attach();

    await new Ably.Rest({ key: process.env.ABLY_API_KEY! })
      .channels.get(`cmd:${machineId}`)
      .publish(name, { requestId, ...data });

    return await reply;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    realtime.close();
  }
}
