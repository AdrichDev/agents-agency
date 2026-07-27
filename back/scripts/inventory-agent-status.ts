import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * H3 (aa-agente-ciclo-vida-publicacion, T0.1) — Inventario del backfill de estado.
 *
 * SÓLO LECTURA. No escribe nada. Su única función es que el gate humano de T0.2 se
 * decida con la lista delante, porque la migración de T1 puede dejar clientes de
 * producción sin servicio: el default de columna es `draft`, y aplicarlo tal cual
 * callaría TODOS los agentes que hoy están funcionando.
 *
 * ATENCIÓN — la migración YA NO aplica este criterio. T0.2 se cerró con el dato de que
 * ninguno de los agentes es de un cliente: **todos son pruebas**. Con eso el backfill
 * correcto pasó a ser el trivial (el default de columna, todos a `draft`, `publishedAt =
 * NULL`) y `published` en el backfill pasó de prudente a falso. Ver `design.md §D` y T1.2.
 *
 * Lo que sigue calculando la columna `PROPUESTA` es la recomendación descartada, y se
 * mantiene por una razón concreta: identifica qué agentes tienen tráfico real, o sea la
 * lista de los que habría que publicar A MANO si alguna vez uno de ellos deja de ser una
 * prueba. Es una sugerencia para el humano, no lo que hará la migración.
 *
 * Criterio de esa recomendación (v1 de `design.md §D`, descartada como backfill):
 *   - tenant + ≥1 conversación con `isTest = false`  → publicar a mano
 *   - tenant, sin conversaciones reales               → dejar en draft
 *   - sin tenant                                      → dejar en draft (huérfanos de H1)
 *
 * `PUBLISHED_AT` es la fecha de la PRIMERA conversación real, no la de hoy: si algún día se
 * publica uno de estos a mano, poner la fecha de hoy sería inventarse historia, y esa fecha
 * es la que H4 usará para saber desde cuándo se factura.
 *
 * Además contrasta cada candidato a `published` contra las precondiciones que exigirá
 * `POST /agents/:id/publish` (design.md §C.4). Un agente que el backfill publica pero
 * el endpoint rechazaría es una incoherencia que hay que ver ANTES de migrar, no
 * después: significa que la plataforma serviría algo que no se puede volver a publicar
 * si se despublica una vez.
 *
 * Run: npx tsx scripts/inventory-agent-status.ts   (npm run inventory:agent-status)
 */

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function main() {
  const agents = await prisma.agent.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      sector: true,
      channel: true,
      systemPrompt: true,
      tenantId: true,
      createdAt: true,
      widgetInstalledAt: true,
      tenant: { select: { name: true, isActive: true } },
      channelConnections: { select: { provider: true, status: true } },
    },
  });

  if (agents.length === 0) {
    console.log("No hay agentes. Nada que backfillear.");
    return;
  }

  // Conversaciones REALES por agente (excluye la consola de pruebas del operador) y
  // fecha de la primera: las dos cosas salen de la misma agrupación.
  const realByAgent = await prisma.conversation.groupBy({
    by: ["agentId"],
    where: { isTest: false },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  const real = new Map(
    realByAgent.map((r) => [r.agentId, { n: r._count._all, first: r._min.createdAt }])
  );

  const filas = agents.map((a) => {
    const r = real.get(a.id);
    const convReales = r?.n ?? 0;
    // Recomendación para el humano, NO lo que hará la migración (ver cabecera y T1.2): la
    // migración deja a TODOS en `draft`. Esto sólo señala quién tiene tráfico real.
    const recomendacion = a.tenantId && convReales > 0 ? "publicar-a-mano" : "dejar-draft";
    const motivo = !a.tenantId
      ? "sin tenant: no hay a quién cobrar"
      : convReales === 0
        ? "con tenant pero sin tráfico real: nunca sirvió a nadie"
        : "con tenant y tráfico real: callarlo sería un incidente";

    // Precondiciones BLOQUEANTES de publicación (design.md §C.4). Se evalúan para TODOS,
    // pero sólo importan en los recomendados para publicar a mano.
    const faltan: string[] = [];
    if (!a.tenantId) faltan.push("tenant");
    if (!a.systemPrompt?.trim()) faltan.push("prompt");

    // Aviso NO bloqueante: canal de mensajería declarado sin conexión. La primera versión
    // de §C.4 lo tenía como bloqueante; este mismo inventario demostró que 3 de los 6
    // agentes que hoy sirven producción lo incumplen y funcionan por widget/API, así que
    // se degradó a aviso (T0.1b). `channel` es decorativo tras el alta.
    const avisos: string[] = [];
    const declaraMensajeria = a.channel === "telegram" || a.channel === "whatsapp";
    if (declaraMensajeria && !a.channelConnections.some((c) => c.provider === a.channel)) {
      avisos.push(`canal ${a.channel} sin conexión`);
    }

    return {
      id: a.id,
      nombre: a.name,
      cliente: a.tenant?.name ?? "—",
      canal: a.channel,
      creado: iso(a.createdAt),
      convReales,
      primeraReal: iso(r?.first ?? null),
      widgetInst: iso(a.widgetInstalledAt),
      recomendacion,
      publishedAtSugerido:
        recomendacion === "publicar-a-mano" ? iso(r?.first ?? null) : "-",
      motivo,
      faltan: faltan.length ? faltan.join(", ") : "-",
      avisos: avisos.length ? avisos.join(", ") : "-",
    };
  });

  console.log(`\nAgentes en total: ${filas.length}\n`);
  console.table(
    filas.map(({ motivo, ...resto }) => resto) // el motivo va aparte: no cabe en la tabla
  );

  const aPublicar = filas.filter((f) => f.recomendacion === "publicar-a-mano");
  const aBorrador = filas.filter((f) => f.recomendacion === "dejar-draft");

  // La migración NO discrimina: default de columna `draft` para todos (T1.2). Lo que sigue es
  // la recomendación de qué publicar A MANO después, no un resumen de lo que va a pasar.
  console.log(`\nLa migración deja los ${filas.length} en draft. Después, a mano:`);
  console.log(`  publicar a mano : ${aPublicar.length}`);
  console.log(`  dejar en draft  : ${aBorrador.length}\n`);

  if (aPublicar.length > 0) {
    console.log("RECOMENDADO publicar a mano (tienen tráfico real; si no, dejan de responder):");
    for (const f of aPublicar) {
      console.log(
        `  - ${f.nombre} (${f.id}) — cliente ${f.cliente}, ${f.convReales} conv. reales, publishedAt sugerido=${f.publishedAtSugerido}`
      );
    }
    console.log("");
  }

  if (aBorrador.length > 0) {
    console.log("Se quedan en DRAFT (no responden por vía pública hasta que alguien publique):");
    for (const f of aBorrador) {
      console.log(`  - ${f.nombre} (${f.id}) — ${f.motivo}`);
    }
    console.log("");
  }

  // Señal fuerte: un agente recomendado para publicar que el endpoint de publicación
  // rechazaría. Hay que verlo antes de intentar publicarlo a mano.
  const incoherentes = aPublicar.filter((f) => f.faltan !== "-");
  if (incoherentes.length > 0) {
    console.log(
      `⚠ ${incoherentes.length} agente(s) recomendados para publicar NO cumplen las precondiciones BLOQUEANTES:`
    );
    for (const f of incoherentes) {
      console.log(`  - ${f.nombre} (${f.id}) — falta: ${f.faltan}`);
    }
    console.log(
      "  Están sirviendo hoy, pero tras la migración quedan en draft y\n" +
        "  POST /agents/:id/publish los rechazará hasta completar eso.\n"
    );
    process.exitCode = 2;
  }

  // Avisos: no impiden publicar (T0.1b), pero el cliente que compró "WhatsApp" y no lo
  // tiene conectado merece saberlo. Informativo: no cambia el exit code.
  const conAvisos = aPublicar.filter((f) => f.avisos !== "-");
  if (conAvisos.length > 0) {
    console.log(`ℹ ${conAvisos.length} agente(s) recomendados con avisos (no bloquean):`);
    for (const f of conAvisos) {
      console.log(`  - ${f.nombre} (${f.id}) — ${f.avisos}`);
    }
    console.log("  Sirven por widget/API. `channel` es decorativo tras el alta.\n");
  }

  // Un borrador con el widget instalado en la web de alguien es la señal más incómoda:
  // hay una página ahí fuera con ese snippet puesto, y va a dejar de responder.
  const borradoresInstalados = aBorrador.filter((f) => f.widgetInst !== "-");
  if (borradoresInstalados.length > 0) {
    console.log(
      `⚠ ${borradoresInstalados.length} agente(s) que se quedan en DRAFT tienen el widget INSTALADO en alguna web:`
    );
    for (const f of borradoresInstalados) {
      console.log(`  - ${f.nombre} (${f.id}) — instalado ${f.widgetInst}, sin conversaciones reales`);
    }
    console.log(
      "  Sin tráfico real, pero el snippet está puesto en algún sitio. Decidir uno por uno:\n" +
        "  publicarlo a mano tras migrar, o confirmar que era una prueba.\n"
    );
    process.exitCode = 2;
  }

  console.log(
    "Este script NO escribe. La migración de T1 NO aplica el criterio de arriba: deja a\n" +
      "TODOS en draft (T1.2, tras cerrarse T0.2 con «ninguno es de un cliente»). La columna\n" +
      "RECOMENDACION es una sugerencia de qué publicar a mano DESPUÉS de migrar.\n"
  );
}

main()
  .catch((e) => {
    console.error("inventory-agent-status error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
