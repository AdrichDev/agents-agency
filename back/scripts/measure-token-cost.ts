import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * H4 (aa-planes-y-cuotas, T2.1) — Coste real por conversación desde `uso_tokens`.
 *
 * SÓLO LECTURA. No escribe nada. Su salida es el gate de todo el resto del change: sin estos
 * números no se fija precio ni se crea ningún `Plan` (ver `design.md §A`).
 *
 * Uso:
 *   npx tsx scripts/measure-token-cost.ts              # últimos 30 días
 *   npx tsx scripts/measure-token-cost.ts --days=90
 *   npx tsx scripts/measure-token-cost.ts --all        # histórico completo
 *   npx tsx scripts/measure-token-cost.ts --out-ratio=0.4
 *
 * LIMITACIÓN DE PRECISIÓN, léela antes de usar los números:
 * `uso_tokens.tokens` guarda `usage.total_tokens` (engine.ts:466) — entrada y salida NO se
 * distinguen, y cuestan distinto (en gpt-4o la salida es 4x la entrada). Por tanto el coste
 * aquí es una ESTIMACIÓN con tarifa mixta, calculada suponiendo una proporción de salida
 * (`--out-ratio`, 30% por defecto). Sirve para poner precio con margen; NO sirve para
 * reconciliar la factura del proveedor al centavo. Ver `design.md §B.1`.
 */

/**
 * Tarifas USD por millón de tokens. ENTRADA EXPLÍCITA a propósito: una tarifa enterrada como
 * constante caduca en silencio y envenena la decisión de precio.
 *
 * ⚠️ SIN VERIFICAR. Los modelos con `null` NO están tarifados, y eso NO es un descuido a
 * rellenar "algún día": mientras haya tokens de modelos sin tarifa, este script se niega a
 * derivar coste agregado (ver `cobertura` más abajo). Un informe que dice "$0.0000" porque
 * falta la tarifa es peor que no tener informe: parece que servir es gratis.
 *
 * El catálogo de abajo replica el del selector (`src/lib/model-capabilities.ts` +
 * `front/lib/models.ts`) para que un modelo en uso nunca falte de esta lista. Rellena los
 * `null` con los precios de la página del proveedor y actualiza `TARIFA_FECHA`:
 *   OpenAI: https://openai.com/api/pricing/
 *   Google: https://ai.google.dev/pricing
 *   Anthropic: https://www.anthropic.com/pricing
 */
const TARIFA_FECHA = "sin verificar";
type Tarifa = { in: number; out: number } | null;
const TARIFA: Record<string, Tarifa> = {
  // OpenAI razonadores — el default del wizard sale de aquí (`gpt-5.4-mini`).
  "gpt-5.6-luna": null,
  "gpt-5.5": null,
  "gpt-5.4": null,
  "gpt-5.4-mini": null,
  "gpt-5.4-nano": null,
  // OpenAI clásicos.
  "gpt-4.1": { in: 2.0, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  // Gemini (OpenAI-compat).
  "gemini-3.1-pro-preview": null,
  "gemini-3.5-flash": null,
  "gemini-3-flash-preview": null,
  "gemini-3.1-flash-lite": null,
};

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const num = (flag: string, def: number, min: number, max: number) => {
  const a = args.find((x) => x.startsWith(`--${flag}=`));
  if (!a) return def;
  const v = Number(a.slice(flag.length + 3));
  // Un flag ilegible cae al default en vez de propagar NaN o un valor absurdo (un
  // `--out-ratio=-1` daría tarifas negativas, y `--days=` un informe vacío sin explicación).
  if (!Number.isFinite(v) || v < min || v > max) {
    console.warn(`⚠️  --${flag} inválido ("${a}"), se usa el valor por defecto ${def}.`);
    return def;
  }
  return v;
};
const DAYS = num("days", 30, 1, 36_500);
const OUT_RATIO = num("out-ratio", 0.3, 0, 1);

/** Tarifa mixta USD/millón para un modelo, o null si no está tarifado. */
function tarifaMixta(model: string | null): number | null {
  if (!model) return null;
  const t = TARIFA[model];
  if (!t) return null;
  return t.in * (1 - OUT_RATIO) + t.out * OUT_RATIO;
}

function coste(tokens: number, model: string | null): number | null {
  const t = tarifaMixta(model);
  return t === null ? null : (tokens / 1_000_000) * t;
}

const usd = (n: number) => `$${n.toFixed(4)}`;

/** Percentil por rango más cercano (nearest-rank) sobre un array YA ordenado. */
function percentil(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

/** Mediana real: con n par es el promedio de los dos centrales, no el menor de ellos. */
function mediana(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const desde = ALL ? undefined : new Date(Date.now() - DAYS * 86_400_000);
  const where = desde ? { createdAt: { gte: desde } } : {};

  console.log(
    `\n=== Coste de tokens — ${ALL ? "histórico completo" : `últimos ${DAYS} días`} ===\n` +
      `Tarifa: ${TARIFA_FECHA} · proporción de salida asumida: ${(OUT_RATIO * 100).toFixed(0)}%\n` +
      `Estimación con tarifa mixta: total_tokens no separa entrada de salida.\n`
  );

  // --- Por modelo: además detecta modelos sin tarifa (coste subestimado) ---
  const porModelo = await prisma.tokenUsage.groupBy({
    by: ["model"],
    where,
    _sum: { tokens: true },
    _count: { _all: true },
  });

  if (porModelo.length === 0) {
    console.log("No hay filas en uso_tokens para el rango pedido. Nada que medir.\n");
    return;
  }

  const sinTarifa: { modelo: string; tokens: number }[] = [];
  let tokensTotal = 0;
  let costeTotal = 0;
  let tokensSinTarifar = 0;

  const filasModelo = porModelo.map((r) => {
    const tokens = r._sum.tokens ?? 0;
    const c = coste(tokens, r.model);
    tokensTotal += tokens;
    if (c === null) {
      tokensSinTarifar += tokens;
      sinTarifa.push({ modelo: r.model ?? "(sin modelo)", tokens });
    } else {
      costeTotal += c;
    }
    return {
      modelo: r.model ?? "(null)",
      filas: r._count._all,
      tokens,
      "USD/1M": tarifaMixta(r.model)?.toFixed(2) ?? "SIN TARIFA",
      coste: c === null ? "—" : usd(c),
    };
  });

  console.log("— Por modelo —");
  console.table(filasModelo);

  // Cobertura de tarifa: qué porción del consumo real sabemos convertir en dinero. Si no es
  // total, NINGÚN coste agregado se imprime. Un informe de ceros creíble sería peor que la
  // ausencia de informe: la decisión de precio (T2.2) se tomaría sobre una mentira.
  const COMPLETA = tokensSinTarifar === 0;
  const cobertura = tokensTotal > 0 ? ((tokensTotal - tokensSinTarifar) / tokensTotal) * 100 : 0;

  if (!COMPLETA) {
    console.log("🛑 TARIFA INCOMPLETA — el coste agregado NO se calcula.");
    console.log(
      `Cobertura: ${cobertura.toFixed(1)}% de los tokens del periodo tienen tarifa. ` +
        `Faltan ${tokensSinTarifar.toLocaleString()} tokens de estos modelos:`
    );
    console.table(
      [...sinTarifa]
        .sort((a, b) => b.tokens - a.tokens)
        .map((s) => ({
          modelo: s.modelo,
          tokens: s.tokens,
          "% del total": `${((s.tokens / tokensTotal) * 100).toFixed(1)}%`,
        }))
    );
    console.log(
      `Rellena esos modelos en TARIFA (cabecera de este fichero), fecha TARIFA_FECHA y vuelve a ` +
        `ejecutar. Los modelos "openclaw/aa-<id>" son del runtime propio: tarifa el modelo ` +
        `subyacente o registra su coste aparte.\n`
    );
  } else if (TARIFA_FECHA === "sin verificar") {
    console.log(
      `⚠️  Todos los modelos tienen tarifa, pero TARIFA_FECHA sigue en "sin verificar": los ` +
        `precios no se han comprobado contra el proveedor. Verifícalos antes de decidir precio.\n`
    );
  }

  // --- Por conversación: la unidad de precio del producto ---
  // Se excluyen las filas sin conversación (automatizaciones), que se reportan aparte.
  const porConv = await prisma.tokenUsage.groupBy({
    by: ["conversationId"],
    where: { ...where, conversationId: { not: null } },
    _sum: { tokens: true },
  });

  // El coste por conversación necesita el modelo, que puede variar dentro de una misma
  // conversación. Se usa la tarifa media ponderada global (USD por token): aproximación
  // suficiente para decidir precio, y explícita para que nadie la confunda con exactitud.
  const tokensTarifados = tokensTotal - tokensSinTarifar;
  const tarifaMedia = tokensTarifados > 0 ? costeTotal / tokensTarifados : 0;

  /**
   * Coste derivado de la tarifa media. Devuelve "—" si la cobertura no es total: extrapolar
   * la media de una parte al todo produce cifras que no suman con el coste por modelo, y en
   * el caso extremo (nada tarifado) imprimiría $0.0000 para todo.
   */
  const derivado = (tokens: number) => (COMPLETA ? usd(tokens * tarifaMedia) : "—");

  const tokensPorConv = porConv.map((c) => c._sum.tokens ?? 0).sort((a, b) => a - b);
  const sumaConv = tokensPorConv.reduce((a, b) => a + b, 0);
  const media = tokensPorConv.length > 0 ? sumaConv / tokensPorConv.length : 0;

  console.log("— Por conversación (la unidad de precio) —");
  console.table([
    {
      conversaciones: tokensPorConv.length,
      "tokens media": Math.round(media),
      "tokens mediana": mediana(tokensPorConv),
      "tokens p90": percentil(tokensPorConv, 90),
      "tokens max": tokensPorConv[tokensPorConv.length - 1] ?? 0,
      "coste media": derivado(media),
      "coste p90": derivado(percentil(tokensPorConv, 90)),
    },
  ]);
  console.log(
    COMPLETA
      ? `Coste por conversación = tokens x ${usd(tarifaMedia * 1_000_000)}/1M (tarifa media ` +
          `ponderada del periodo).\n`
      : `Las columnas de coste van vacías a propósito: tarifa incompleta (ver arriba). Los ` +
          `tokens sí son dato real y ya sirven para dimensionar cupos.\n`
  );

  // --- Conversaciones sin una sola fila de consumo: consumo mal registrado o chats vacíos ---
  // Las dos poblaciones tienen que ser LA MISMA o el aviso miente: `porConv` incluye
  // conversaciones de la consola de pruebas (el metering las cuenta, H1/AC6) y se agrupa por
  // la fecha del consumo, no de la conversación. Se cruza contra los ids reales del periodo.
  const convReales = await prisma.conversation.findMany({
    where: { ...(desde ? { createdAt: { gte: desde } } : {}), isTest: false },
    select: { id: true },
  });
  const idsConConsumo = new Set(porConv.map((c) => c.conversationId));
  const sinConsumo = convReales.filter((c) => !idsConConsumo.has(c.id)).length;
  if (sinConsumo > 0) {
    console.log(
      `⚠️  ${sinConsumo} de ${convReales.length} conversaciones reales no tienen ninguna fila ` +
        `en uso_tokens. Puede ser normal (cortadas por el gate, atendidas por el flujo de ` +
        `captación sin LLM) o síntoma de consumo sin registrar.\n`
    );
  }

  // --- Por operacion: separar chat de automatizaciones ---
  const porOperacion = await prisma.tokenUsage.groupBy({
    by: ["operacion"],
    where,
    _sum: { tokens: true },
    _count: { _all: true },
  });
  console.log("— Por operación (chat vs automatizaciones) —");
  console.table(
    porOperacion.map((r) => {
      const tokens = r._sum.tokens ?? 0;
      return {
        operacion: r.operacion ?? "(chat)",
        filas: r._count._all,
        tokens,
        "% tokens": tokensTotal > 0 ? `${((tokens / tokensTotal) * 100).toFixed(1)}%` : "—",
        coste: derivado(tokens),
      };
    })
  );

  // --- Por tenant: quién está fuera de márgenes ---
  const porTenant = await prisma.tokenUsage.groupBy({
    by: ["tenantId"],
    where,
    _sum: { tokens: true },
    _count: { _all: true },
    orderBy: { _sum: { tokens: "desc" } },
    take: 20,
  });
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: porTenant.map((t) => t.tenantId) } },
    select: { id: true, name: true, tokenBalance: true, tokensUsed: true, isActive: true },
  });
  const nombre = new Map(tenants.map((t) => [t.id, t]));

  console.log("— Por cliente (top 20 por consumo) —");
  console.table(
    porTenant.map((r) => {
      const t = nombre.get(r.tenantId);
      const tokens = r._sum.tokens ?? 0;
      return {
        cliente: t?.name ?? r.tenantId,
        activo: t?.isActive ?? "?",
        tokens,
        coste: derivado(tokens),
        cupo: t?.tokenBalance ?? "?",
        "acumulado vida": t?.tokensUsed ?? "?",
      };
    })
  );

  // --- Por agente: insumo de la cuota por agente (T5) ---
  const porAgente = await prisma.tokenUsage.groupBy({
    by: ["agentId"],
    where,
    _sum: { tokens: true },
    orderBy: { _sum: { tokens: "desc" } },
    take: 15,
  });
  const agentIds = porAgente.map((a) => a.agentId).filter((x): x is string => Boolean(x));
  const agentes = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, tenant: { select: { name: true } } },
  });
  const agName = new Map(agentes.map((a) => [a.id, a]));

  console.log("— Por agente (top 15) —");
  console.table(
    porAgente.map((r) => {
      const a = r.agentId ? agName.get(r.agentId) : undefined;
      const tokens = r._sum.tokens ?? 0;
      return {
        agente: a?.name ?? r.agentId ?? "(sin agente)",
        cliente: a?.tenant?.name ?? "—",
        tokens,
        coste: derivado(tokens),
      };
    })
  );

  console.log(
    `\n=== Totales ===\n` +
      `tokens: ${tokensTotal.toLocaleString()}\n` +
      (COMPLETA
        ? `coste estimado: ${usd(costeTotal)} (tarifa mixta, out-ratio ${OUT_RATIO})\n\n` +
          `SIGUIENTE PASO (T2.2, decisión humana): con el coste por conversación de arriba,\n` +
          `fijar precio y cupo por plan. La cifra es una estimación con tarifa mixta: pon margen.\n`
        : `coste: NO CALCULABLE — cobertura de tarifa ${cobertura.toFixed(1)}%.\n` +
          `  (la porción tarifada suma ${usd(costeTotal)}, pero no representa el total)\n\n` +
          `SIGUIENTE PASO: rellenar TARIFA con los modelos listados arriba y volver a ejecutar.\n` +
          `T2.2 (decidir precio) NO puede resolverse con este informe.\n`)
  );
}

main()
  .catch((e) => {
    console.error("measure-token-cost error:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
