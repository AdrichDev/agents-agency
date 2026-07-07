import { logger } from "@/lib/logger";

export interface CrmTelegramFanoutInput {
  businessId?: string | null;
  conversationId: string;
  direction: "in" | "out";
  text: string;
  providerMessageId?: string | null;
  clientMessageId?: string | null;
  remitente?: string | null;
}

function endpoint(): string {
  const explicit = process.env.CRM_TELEGRAM_WEBHOOK_URL ?? "";
  if (explicit) return explicit;
  const base = (process.env.CRM_BASE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/service/operator/telegram` : "";
}

export async function fanOutTelegramToCrm(input: CrmTelegramFanoutInput): Promise<void> {
  const url = endpoint();
  const token = process.env.OPERATOR_SERVICE_TOKEN ?? "";
  if (!url || !token || !input.businessId) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": token },
      body: JSON.stringify(input),
    });
    if (!res.ok) logger.warn(`[telegram-fanout] CRM returned ${res.status}`);
  } catch (err) {
    logger.warn({ err }, "[telegram-fanout] CRM fan-out failed");
  }
}
