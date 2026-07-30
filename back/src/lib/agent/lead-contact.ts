/**
 * Respaldo determinista del contacto de un lead
 * (aa-servicios-completos-y-enlaces-clicables, F.2).
 *
 * Medido en producción: una conversación en la que la visitante dio nombre, email y
 * teléfono en tres turnos distintos dejó el lead con el teléfono a `null`. El fusionado por
 * `conversationId` funcionó — una sola fila —, pero el modelo llamó a `guardar_lead` una vez
 * y no volvió a llamarla cuando llegó el último dato.
 *
 * La descripción de la herramienta ya dice que puede llamarla de nuevo. No basta: la prosa de
 * una tool no obliga, sólo el esquema obliga, y aquí el esquema no puede expresar "vuelve a
 * llamarme". Así que el dato se recoge fuera del modelo.
 *
 * Dos límites deliberados:
 *
 * - NUNCA crea un lead. Sólo completa uno que ya existe. Crear uno aquí significaría guardar
 *   el teléfono de alguien que sólo preguntó un precio: dato personal sin interés declarado.
 * - NUNCA pisa un valor existente. Si el email ya está guardado, un email nuevo en el mensaje
 *   se ignora; corregir un dato es una decisión, y esa la toma el modelo llamando a la tool.
 */
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Móvil o fijo español: 9 dígitos que empiezan por 6-9, con los separadores que la gente
 * escribe de verdad ("600 45 12 90", "600-451-290"), y prefijo internacional opcional.
 */
const TELEFONO = /(?:\+34[\s.-]?)?[6-9](?:[\s.-]?\d){8}/;

/**
 * Cifras que NO son un teléfono aunque tengan nueve dígitos: importes y porcentajes.
 * "Facturamos 900 000 000 € al año" encaja con el patrón de arriba y no es un contacto.
 */
const MONEDA = /(?:€|\$|%|\beuros?\b|\bEUR\b)/i;

export function extraerEmail(texto: string): string | null {
  return texto.match(EMAIL)?.[0] ?? null;
}

export function extraerTelefono(texto: string): string | null {
  const match = texto.match(TELEFONO);
  if (!match) return null;

  // Se mira el entorno inmediato, no el mensaje entero: "cuesta 300 € y mi móvil es
  // 600451290" tiene moneda y teléfono, y el teléfono es bueno.
  const desde = Math.max(0, match.index! - 12);
  const entorno = texto.slice(desde, match.index! + match[0].length + 12);
  if (MONEDA.test(entorno)) return null;

  return match[0].replace(/[\s.-]/g, "");
}

/**
 * Completa el email o el teléfono que falten en el lead de esta conversación con lo que el
 * visitante acaba de escribir. Best-effort: nunca rompe el turno.
 */
export async function completarContactoDelLead(
  conversationId: string,
  userMessage: string
): Promise<void> {
  const email = extraerEmail(userMessage);
  const telefono = extraerTelefono(userMessage);
  if (!email && !telefono) return;

  const lead = await prisma.lead.findUnique({
    where: { conversationId },
    select: { id: true, email: true, phone: true },
  });
  // Sin lead no hay interés declarado todavía: el dato se deja pasar a propósito.
  if (!lead) return;

  const data: { email?: string; phone?: string } = {};
  if (email && !lead.email) data.email = email;
  if (telefono && !lead.phone) data.phone = telefono;
  if (Object.keys(data).length === 0) return;

  await prisma.lead.update({ where: { id: lead.id }, data });
  logger.info({ leadId: lead.id, campos: Object.keys(data) }, "[lead] contacto completado");
}
