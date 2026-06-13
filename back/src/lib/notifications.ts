import { prisma } from "@/lib/db";
import { nextContactCode, withCodeRetry } from "@/lib/codes";

/**
 * Notificaciones de nuevos leads.
 *
 * Flujo (hook directo, best-effort):
 *   nuevo lead (landing o chat) → processNewLead()
 *     1. crea un ProspectContact type=lead (agenda de llamadas)
 *     2. dispara webhook n8n → n8n envía el email al admin
 *
 * REGLA: nunca lanza — un fallo aquí jamás debe romper la creación del lead.
 * ENV: N8N_WEBHOOK_LEAD_URL — webhook POST de n8n (noop si no está definido)
 */

export interface NewLeadData {
  name: string;
  email?: string | null;
  phone?: string | null;
  source: "landing" | "chat";
}

/** Resuelve el destinatario: SystemConfig.adminEmail → primer User admin. */
export async function resolveAdminEmail(): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "default" },
    select: { adminEmail: true },
  });
  if (config?.adminEmail) return config.adminEmail;

  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return admin?.email ?? null;
}

/** Dispara el webhook n8n con los datos del lead. Lanza si falla o no está configurado. */
export async function notifyLeadViaWebhook(lead: NewLeadData): Promise<void> {
  const webhookUrl = process.env.N8N_WEBHOOK_LEAD_URL;
  if (!webhookUrl) throw new Error("N8N_WEBHOOK_LEAD_URL not set");

  const adminEmail = await resolveAdminEmail();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        source: lead.source,
        adminEmail,
        fecha: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`n8n webhook responded ${res.status}: ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Crea el ProspectContact type=lead con código pc-NN autogenerado. */
export async function createLeadContact(lead: NewLeadData) {
  return withCodeRetry(async () =>
    prisma.prospectContact.create({
      data: {
        codigo: await nextContactCode(),
        type: "lead",
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
      },
    })
  );
}

/**
 * Hook principal: contacto + webhook n8n. Best-effort total — cada paso captura
 * su propio error para que un fallo de notificación no impida crear el contacto
 * y NUNCA propague al endpoint que creó el lead.
 */
export async function processNewLead(
  lead: NewLeadData,
  deps: {
    createContact?: typeof createLeadContact;
    sendNotification?: typeof notifyLeadViaWebhook;
  } = {}
): Promise<void> {
  const createContact = deps.createContact ?? createLeadContact;
  const sendNotification = deps.sendNotification ?? notifyLeadViaWebhook;

  try {
    await createContact(lead);
  } catch (e) {
    console.error("[notifications] error creando ProspectContact del lead:", e);
  }

  try {
    await sendNotification(lead);
  } catch (e) {
    console.error("[notifications] error disparando webhook n8n:", e);
  }
}
