/**
 * El contacto de una reserva tiene que ser el del visitante
 * (aa-reserva-contacto-real-del-visitante).
 *
 * `crear_reserva` escribía en la agenda del negocio la cadena que el modelo pusiera en
 * `telefono` o `email`. La guarda que había, `assertContactChannel`, sólo comprueba que venga
 * ALGUNO: no distingue un contacto real de uno inventado, y uno inventado es peor que ninguno.
 * Un campo vacío se ve vacío; un teléfono verosímil parece un cliente.
 *
 * Medido en la fila SEC3 de la matriz de casuística, agente `barberia`, `gpt-4.1-nano`, n=4: en
 * una de las cuatro tiradas la cita se creó con `910000002` —el teléfono DEL PROPIO NEGOCIO,
 * sacado de sus instrucciones— a nombre de "Usuario". Nadie puede llamar a quien reservó, y en
 * la fila no hay nada que lo indique.
 *
 * Dos guardas, las dos calculadas FUERA del modelo. Es el mismo patrón que `lead-contact.ts`,
 * al que se llegó después de que tres redacciones distintas del prompt fallaran en lo mismo:
 * la prosa de una tool no obliga.
 */
import { prisma } from "@/lib/db";

/** Cliente mínimo que necesitan las lecturas. Inyectable para poder probarlas sin BD. */
export interface ContactoReadClient {
  agent: {
    findUnique: (args: any) => Promise<any>;
  };
  lead: {
    findUnique: (args: any) => Promise<any>;
  };
}

export interface ContactoNegocio {
  telefono: string | null;
  email: string | null;
}

export interface ContactoSuministrado {
  email?: string | null;
  telefono?: string | null;
}

/**
 * ¿Son el mismo número? Los dos lados se escriben distinto: el tenant guarda
 * "+34 910 00 00 02" y el modelo escribió "910000002".
 *
 * Se comparan los últimos 9 dígitos porque un número español tiene 9 y el prefijo +34 es
 * opcional en ambos lados. Comparar la cadena entera de dígitos no habría detectado el caso
 * medido; comparar un sufijo más corto empezaría a casar números que no tienen nada que ver.
 */
export function mismoTelefono(a?: string | null, b?: string | null): boolean {
  const da = soloDigitos(a);
  const db = soloDigitos(b);
  if (da.length < 9 || db.length < 9) return false;
  return da.slice(-9) === db.slice(-9);
}

/** Un email es o no es el del negocio: no hay lógica de sufijos, sólo caja y espacios. */
export function mismoEmail(a?: string | null, b?: string | null): boolean {
  const na = a?.trim().toLowerCase();
  const nb = b?.trim().toLowerCase();
  if (!na || !nb) return false;
  return na === nb;
}

function soloDigitos(valor?: string | null): string {
  return valor ? valor.replace(/\D/g, "") : "";
}

/**
 * Contacto del propio negocio, para saber qué NO es un cliente. Una lectura pequeña por
 * llamada, misma forma que `getAgentTimezone`, y sin caché a propósito: una caché caliente
 * aquí sería un RECHAZO caduco, que es peor que la lectura.
 *
 * Un agente sin tenant devuelve `null` y entonces no se rechaza nada.
 */
export async function cargarContactoDelNegocio(
  agentId: string,
  client: ContactoReadClient = prisma as unknown as ContactoReadClient
): Promise<ContactoNegocio | null> {
  const agent = await client.agent.findUnique({
    where: { id: agentId },
    select: { tenant: { select: { phone: true, email: true } } },
  });
  const tenant = agent?.tenant;
  if (!tenant) return null;
  return { telefono: tenant.phone ?? null, email: tenant.email ?? null };
}

/**
 * Contacto que el visitante ya dio en esta conversación. Se lee del `Lead`, no del mensaje del
 * turno: para cuando se ejecuta una tool, `completarContactoDelLead` ya ha corrido con el mismo
 * extractor, así que la fila del lead es ese dato con la extracción hecha una sola vez.
 */
export async function cargarContactoDelLead(
  conversationId: string | undefined,
  client: ContactoReadClient = prisma as unknown as ContactoReadClient
): Promise<ContactoSuministrado | null> {
  if (!conversationId) return null;
  const lead = await client.lead.findUnique({
    where: { conversationId },
    select: { email: true, phone: true },
  });
  if (!lead) return null;
  return { email: lead.email ?? null, telefono: lead.phone ?? null };
}

/**
 * Contacto definitivo de la reserva.
 *
 * El orden importa, y es el contrario del obvio: primero se RELLENA y después se exige. Si el
 * modelo omite el teléfono y el visitante ya lo escribió, la reserva tiene que salir con el
 * suyo, no fallar. Exigir primero y no rellenar nunca es justamente lo que empuja al modelo a
 * producir "algo", que es como entró `910000002`.
 *
 * Un valor que venga del lead pasa también por la guarda del negocio. El lead se rellena desde
 * los mensajes del visitante, así que normalmente no puede traer el número del negocio — pero
 * "normalmente" no da para dejar el hueco escrito.
 */
export function resolverContactoReserva(
  suministrado: ContactoSuministrado,
  negocio: ContactoNegocio | null,
  lead: ContactoSuministrado | null
): { email?: string; telefono?: string } {
  const email = primerValor(suministrado.email, lead?.email);
  const telefono = primerValor(suministrado.telefono, lead?.telefono);

  if (negocio) {
    if (mismoTelefono(telefono, negocio.telefono)) {
      throw new Error(
        "Ese teléfono es el del PROPIO NEGOCIO, no el del cliente: no sirve para avisar a " +
          "quien reserva. Pídele al usuario SU teléfono o su email y vuelve a llamar a " +
          "crear_reserva con el dato suyo."
      );
    }
    if (mismoEmail(email, negocio.email)) {
      throw new Error(
        "Ese email es el del PROPIO NEGOCIO, no el del cliente: no sirve para avisar a quien " +
          "reserva. Pídele al usuario SU email o su teléfono y vuelve a llamar a crear_reserva " +
          "con el dato suyo."
      );
    }
  }

  return { email: email || undefined, telefono: telefono || undefined };
}

function primerValor(...valores: (string | null | undefined)[]): string | undefined {
  for (const v of valores) {
    const limpio = v?.trim();
    if (limpio) return limpio;
  }
  return undefined;
}
