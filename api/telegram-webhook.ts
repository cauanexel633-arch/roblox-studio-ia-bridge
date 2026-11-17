import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHttpClient } from "@ably/pubsub-server";
import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function validSignature(requestId: string, decision: string, expiresAt: string, signature: string): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`telegram-approval:v1:${requestId}:${decision}:${expiresAt}`)
    .digest("hex")
    .slice(0, 16);
  return safeEqual(expected, signature);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const suppliedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!webhookSecret || typeof suppliedSecret !== "string" || !safeEqual(suppliedSecret, webhookSecret)) {
    return res.status(401).end();
  }

  const update = (req.body ?? {}) as {
    callback_query?: {
      id: string;
      data?: string;
      message?: { message_id: number; chat: { id: number | string } };
    };
  };
  const callback = update.callback_query;
  if (!callback?.id || !callback.data) return res.status(200).json({ ok: true });

  const [prefix, requestId, decision, expiresAt, signature] = callback.data.split("|");
  const validId = /^[0-9a-f]{24}$/i.test(requestId ?? "");
  const validExpiry = /^\d{10}$/.test(expiresAt ?? "") && Number(expiresAt) >= Math.floor(Date.now() / 1000);
  const validDecision = decision === "approved" || decision === "denied";
  if (prefix !== "rbx" || !validId || !validExpiry || !validDecision || !signature || !validSignature(requestId, decision, expiresAt, signature)) {
    return res.status(200).json({ ok: true });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;
  if (!callback.message || !configuredChatId || String(callback.message.chat.id) !== configuredChatId) {
    return res.status(200).json({ ok: true });
  }
  const machineId = process.env.MACHINE_ID;
  const ablyKey = process.env.ABLY_API_KEY;
  if (!botToken || !machineId || !ablyKey) return res.status(500).json({ error: "Telegram/Ably não configurado" });

  const http = createHttpClient({ key: ablyKey });
  if (decision === "approved") {
    await http.channels.get(`control:${machineId}`).publish("start", {
      requestId, source: "telegram",
    });
  }
  await http.channels.get(`approval-res:${requestId}`).publish("decision", { decision });

  const api = `https://api.telegram.org/bot${botToken}`;
  await fetch(`${api}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callback.id, text: decision === "approved" ? "Inicialização autorizada." : "Solicitação negada." }),
  });
  if (callback.message) {
    await fetch(`${api}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
        text: decision === "approved"
          ? "✅ Solicitação aceita. O agente do Windows iniciará o servidor local."
          : "⛔ Solicitação negada. O servidor local não será iniciado.",
      }),
    });
  }
  return res.status(200).json({ ok: true });
}
