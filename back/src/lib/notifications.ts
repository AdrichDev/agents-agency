import { prisma } from "@/lib/db";
import { getValidToken } from "@/lib/integrations/oauth";
import { sendEmail } from "@/lib/integrations/gmail";
import { nextContactCode, withCodeRetry } from "@/lib/codes";

/**
 * Notificaciones de nuevos leads.
 *
 * Flujo (hook directo, best-effort):
 *   nuevo lead (landing o chat) → processNewLead()
 *     1. crea un ProspectContact type=lead (agenda de llamadas)
 *     2. envía email al admin reutilizando la integración Gmail OAuth conectada
 *
 * REGLA: nunca lanza — un fallo aquí jamás debe romper la creación del lead.
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

/**
 * Resuelve la primera integración Gmail (provider google) conectada y devuelve
 * un access token válido (descifrado/refrescado por getValidToken).
 */
async function resolveGmailToken(): Promise<string | null> {
  const integration = await prisma.integration.findFirst({
    where: { provider: "google", status: "connected" },
    orderBy: { createdAt: "asc" },
    select: { agentId: true },
  });
  if (!integration) return null;
  return getValidToken(integration.agentId, "google");
}

/** Cuerpo del email de aviso en español. */
export function buildLeadEmail(lead: NewLeadData): { subject: string; body: string } {
  const origen = lead.source === "landing" ? "el formulario de la web" : "el chat del agente";
  return {
    subject: `Nuevo lead en la web: ${lead.name}`,
    body: [
      `Se ha registrado un nuevo lead desde ${origen}.`,
      ``,
      `Nombre: ${lead.name}`,
      `Email: ${lead.email ?? "—"}`,
      `Teléfono: ${lead.phone ?? "—"}`,
      `Fecha: ${new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`,
      ``,
      `Puedes gestionarlo desde la agenda de contactos del dashboard.`,
    ].join("\n"),
  };
}

/** Envía el email de aviso al admin. Lanza si no hay integración o falla el envío. */
export async function sendLeadNotificationEmail(lead: NewLeadData): Promise<void> {
  const to = await resolveAdminEmail();
  if (!to) throw new Error("No admin email configured (SystemConfig.adminEmail or admin user)");

  const token = await resolveGmailToken();
  if (!token) throw new Error("No connected Gmail integration found");

  const { subject, body } = buildLeadEmail(lead);
  await sendEmail(token, to, subject, body);
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
 * Hook principal: contacto + email. Best-effort total — cada paso captura su
 * propio error para que un fallo de email no impida crear el contacto (ni
 * viceversa) y NUNCA propague al endpoint que creó el lead.
 */
export async function processNewLead(
  lead: NewLeadData,
  deps: {
    createContact?: typeof createLeadContact;
    sendNotification?: typeof sendLeadNotificationEmail;
  } = {}
): Promise<void> {
  const createContact = deps.createContact ?? createLeadContact;
  const sendNotification = deps.sendNotification ?? sendLeadNotificationEmail;

  try {
    await createContact(lead);
  } catch (e) {
    console.error("[notifications] error creando ProspectContact del lead:", e);
  }

  try {
    await sendNotification(lead);
  } catch (e) {
    console.error("[notifications] error enviando email de nuevo lead:", e);
  }
}
