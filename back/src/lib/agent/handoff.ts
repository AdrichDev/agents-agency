/**
 * Módulo de handoff a humano y horario comercial.
 * Funciones puras (isWithinBusinessHours, buildConversationSummary) + helper de metadata.
 */

import { prisma } from "@/lib/db";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface BusinessHoursSchedule {
  day: number;   // 0=domingo … 6=sábado (Date.getDay)
  open: string;  // "HH:MM"
  close: string; // "HH:MM"
}

interface BusinessHoursConfig {
  timezone: string;
  schedule: BusinessHoursSchedule[];
}

export interface EcommerceConfig {
  businessHours?: BusinessHoursConfig;
  handoffSlackChannel?: string;
  orderStatusUrl?: string;
  orderStatusApiKey?: string;
}

// ── Helpers de horario ────────────────────────────────────────────────────────

/**
 * Función pura. Determina si `now` está dentro del horario comercial configurado.
 * Si la config es inválida/ausente → fallback 24/7 (true).
 * Si la TZ es inválida → warning en log + fallback 24/7 (true). (R4-1, R4-D)
 */
export function isWithinBusinessHours(
  config: EcommerceConfig | undefined,
  now = new Date()
): boolean {
  const bh = config?.businessHours;
  if (!bh?.timezone || !Array.isArray(bh.schedule) || bh.schedule.length === 0) {
    return true; // fallback 24/7
  }

  try {
    // Derivar día de la semana y hora actual en la timezone configurada
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: bh.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const weekdayShort = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
    const hourPart = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minutePart = parts.find((p) => p.type === "minute")?.value ?? "00";
    const currentTime = `${hourPart.padStart(2, "0")}:${minutePart.padStart(2, "0")}`;

    // Mapeo de abreviatura en-GB a número de día (Date.getDay)
    const weekdayMap: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    const dayNum = weekdayMap[weekdayShort.slice(0, 3)];
    if (dayNum === undefined) return true; // fallback si no se puede determinar

    // Buscar la franja para ese día
    const franja = bh.schedule.find((s) => s.day === dayNum);
    if (!franja) return false; // día no laborable

    return currentTime >= franja.open && currentTime < franja.close;
  } catch {
    console.warn(`[handoff] businessHours inválido (tz=${bh.timezone}); fallback 24/7`);
    return true; // R4-D: TZ inválida → fallback
  }
}

// ── Helpers de metadata ───────────────────────────────────────────────────────

/**
 * Lee el metadata de la conversación como objeto plano.
 */
export async function getConversationMetadata(conversationId: string): Promise<Record<string, any>> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });
  return (conv?.metadata as Record<string, any>) ?? {};
}

/**
 * Merge de metadata en la conversación (spread no destructivo).
 * Solo sobreescribe los campos pasados; preserva el resto.
 */
export async function mergeConversationMetadata(
  conversationId: string,
  patch: Record<string, any>
): Promise<void> {
  const current = await getConversationMetadata(conversationId);
  const merged = { ...current, ...patch };
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { metadata: merged },
  });
}

// ── Resumen de conversación para Slack ────────────────────────────────────────

/**
 * Construye el texto de resumen de handoff para Slack.
 * Lee los últimos N mensajes, lead y metadatos.
 */
export async function buildConversationSummary(
  conversationId: string,
  maxMessages = 6
): Promise<string> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      agent: { select: { name: true } },
      lead: { select: { customerName: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: "desc" }, take: maxMessages },
    },
  });

  if (!conv) return `Handoff solicitado · conversationId: ${conversationId}`;

  const meta = (conv.metadata as Record<string, any>) ?? {};
  const intent: string | undefined = meta.leadIntent;

  const lead = conv.lead;
  const msgs = [...(conv.messages ?? [])].reverse(); // cronológico

  const lines: string[] = [
    `Handoff solicitado · Agente: ${conv.agent?.name ?? "—"}`,
    `Contacto: ${lead?.customerName ?? "—"} ${lead?.email ?? ""} ${lead?.phone ?? ""}`.trim(),
    intent ? `Intención: ${intent}` : `Intención: —`,
    `Últimos mensajes:`,
    ...msgs.map((m) => `- ${m.role}: ${m.content.slice(0, 200)}`),
  ];

  return lines.join("\n");
}
