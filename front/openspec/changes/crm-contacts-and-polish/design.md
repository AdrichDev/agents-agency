# Design: crm-contacts-and-polish (P10)

## Enfoque técnico

Cinco bloques sobre el stack Express + Prisma + Next existente. Los bloques A,
B y C son cambios aditivos o correcciones sobre módulos ya existentes; D añade
un nuevo modelo Prisma y un router dedicado; E añade páginas y ajusta
componentes de nav/tema sin alterar el modelo de datos.

---

## Decisiones de arquitectura

### D1 — Guardia `isStatsResponse()` en el consumidor, no en `api.ts`

| Decisión | Implementar la guardia en el componente consumidor de stats |
|----------|-------------------------------------------------------------|
| Rechazado | Parchear `front/lib/api.ts` globalmente |
| Rationale | `api.ts` es un cliente genérico; añadir lógica específica de stats rompe SRP. El consumidor conoce el contrato esperado y puede aplicar defaults domain-específicos. Patrón compatible con el resto de calls en `api.ts`. |

```ts
function isStatsResponse(data: unknown): data is StatsResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "kpis" in data &&
    "series" in data
  );
}
```

### D2 — `enumeratePeriods` como función pura exportada de `stats.ts`

| Decisión | Exportar `periodKey(date, granularity)` y `enumeratePeriods(from, to, granularity)` desde `stats.ts` |
|----------|------------------------------------------------------------------------------------------------------|
| Rechazado | Inline en la query SQL |
| Rationale | Permite unit tests sin BD. El cap de 600 buckets se aplica aquí, no en SQL. Series zero-filled se construyen en memoria: `LEFT JOIN` alternativo habría complicado las queries parametrizadas existentes. |

### D3 — `periodFormat.ts` como módulo utilitario front puro

`front/components/stats/periodFormat.ts` exporta una única función:

```ts
export function formatPeriodLabel(
  periodKey: string,
  granularity: "year" | "month" | "week" | "day",
  range: "ytd" | "last12m" | "all",
  opts?: { tooltip?: boolean }
): string
```

Sin dependencias externas. Los tests son unitarios con valores de entrada fijos.
La lógica de "año en límite" para `all` compara el año del periodo anterior para
determinar si añadir el sufijo de año a la abreviatura de mes.

### D4 — `leadStatusPalette` como constante en el componente de gráfico

Paleta hardcodeada (`Record<string, string>`) definida junto al componente
"Leads por estado". No en un archivo de tema global para evitar acoplamiento.
Los colores son los 10 primeros de la escala Tailwind categórica (sin repetir
grises ni transparentes).

### D5 — `geocodeZone()` + `haversineKm()` en `places.ts`, no en un helper externo

Ambas funciones son pequeñas y solo las usa `places.ts`. Exportarlas desde el
mismo módulo evita un archivo de 20 líneas separado. `geocodeZone` llama a
Geocoding API (misma clave `GOOGLE_MAPS_API_KEY`); si falla, lanza error
descriptivo que Places captura y propaga al router como 422.

### D6 — `email-extractor.ts` como módulo puro (sin Prisma, sin fetch externo)

```ts
// back/src/lib/market-study/email-extractor.ts
export function extractEmails(html: string, baseUrl: string): string[]
```

Recibe HTML ya descargado por `scraper/web.ts`. Prioridad de extracción:
1. `href="mailto:..."` — más fiable (intención explícita del webmaster).
2. Regex sobre texto (`/[\w.-]+@[\w.-]+\.\w{2,}/g`).

Lista de junk: `["noreply", "no-reply", "info", "soporte", "support",
"hola", "contact", "hello", "admin", "webmaster"]` — descarta emails cuya parte
local (antes de `@`) contiene alguno de estos términos en minúsculas. Cap: 3
resultados válidos.

### D7 — Schema `ProspectContact`: enums Prisma nativos

```prisma
enum ProspectType {
  lead
  prospecto
}

enum ContactadoStatus {
  si
  no
  nc
}

model ProspectContact {
  id          String           @id @default(cuid())
  codigo      String           @unique
  type        ProspectType
  name        String
  phone       String?
  email       String?
  sector      String?
  direccion   String?
  contactado  ContactadoStatus @default(nc)
  contactedAt DateTime?
  createdAt   DateTime         @default(now())
  clientId    String?
  client      Client?          @relation(fields: [clientId], references: [id])
}
```

Rationale: enums Prisma garantizan integridad en BD; el checklist de valores
válidos no vive solo en Zod.

### D8 — `codigo` secuencial: generado en el router, no en BD

La BD no tiene secuencias automáticas tipo "pc-001". El router calcula el
siguiente código con:

```ts
const last = await prisma.prospectContact.findFirst({
  orderBy: { createdAt: "desc" },
  select: { codigo: true },
});
const next = last
  ? `pc-${String(Number(last.codigo.split("-")[1]) + 1).padStart(2, "0")}`
  : "pc-01";
```

Mismo patrón para `codCliente` en `Client`. No es race-condition-safe para
alto tráfico concurrente, pero el dominio (agencia pequeña) no lo requiere.
Si en el futuro se necesita, se añade un `SEQUENCE` en SQL.

### D9 — Notificación Gmail: fire-and-forget con wrapper existente

La integración Gmail OAuth (P2) expone una función para enviar email via la
API de Gmail. El hook de creación de lead la invoca dentro de un bloque
`try/catch` que registra el error en consola pero no relanza. El lead ya está
persistido antes del intento de envío.

```ts
// en el handler POST /api/leads (o equivalente)
await prisma.lead.create({ data: leadData });
await prisma.prospectContact.create({ data: contactData });
// fire-and-forget — no await con propagación
notifyAdminNewLead(contact).catch((err) =>
  console.error("[lead-notify] Gmail error:", err)
);
```

### D10 — `hasInvoices` computado en query, no en campo persistido

```ts
const clients = await prisma.client.findMany({
  include: { _count: { select: { budgets: true } } },
});
// hasInvoices = client._count.budgets > 0
```

No se añade columna `hasInvoices` a `Client`; es dato derivado. Si el volumen
crece, se puede añadir índice en `Budget.clientId` (ya debería existir como FK).

### D11 — Badge pendientes en nav: fetch ligero en montaje

`GET /api/contacts/pending-count` devuelve `{ count: number }`. El componente
nav hace fetch en `useEffect([pathname])` (se refresca al cambiar de página).
No se usa polling ni WebSocket para este MVP. El badge se oculta si `count === 0`.

### D12 — Favicon: precedencia localStorage > DB > default

En `ThemeInitializer`:

```ts
const stored = localStorage.getItem("favicon");
if (stored) {
  applyFavicon(stored);
  return; // no sobreescribir con DB
}
const config = await fetchSystemConfig();
if (config.favicon) {
  localStorage.setItem("favicon", config.favicon);
  applyFavicon(config.favicon);
} else {
  applyFavicon("/3A_sin_fondo.png");
}
```

El reset ocurría porque `ThemeInitializer` siempre sobreescribía localStorage
con el valor de DB (incluso `null`). Fix: solo escribe en localStorage si DB
tiene valor; no borra el valor previo.

---

## Estructura de archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `back/src/lib/stats.ts` | Modificado | Añadir granularidad `day`, `periodKey`, `enumeratePeriods`, cap 600 |
| `back/src/lib/market-study/study-generator.ts` | Modificado | Reglas ANCLAJE GEOGRÁFICO, CONCRECIÓN, PRICING en prompt |
| `back/src/lib/market-study/places.ts` | Modificado | `geocodeZone`, `haversineKm`, post-filtro radius, bias en textSearch |
| `back/src/lib/market-study/competitors.ts` | Modificado | Filtro radius, llamada a `email-extractor` |
| `back/src/lib/market-study/email-extractor.ts` | Nuevo | `extractEmails(html, baseUrl): string[]` |
| `back/src/lib/scraper/web.ts` | Modificado | `AbortController` 10 s timeout |
| `back/src/lib/service-catalog.ts` | Modificado | Precios España-2026 |
| `back/prisma/schema.prisma` | Modificado | Enums `ProspectType`/`ContactadoStatus`, model `ProspectContact`, campos `Client.codCliente`/`Client.direccion` |
| `back/prisma/migrate-crm-contacts.sql` | Nuevo | Migración aditiva + backfill `codCliente` |
| `back/src/routes/contacts.ts` | Nuevo | Router `/api/contacts` CRUD + pending-count |
| `back/src/index.ts` | Modificado | Mount `contactsRouter`; hook lead-creation → `ProspectContact` + notificación |
| `front/lib/api.ts` (o consumidor) | Modificado | `isStatsResponse()`, defaults defensivos, tarjeta error con retry |
| `front/components/stats/periodFormat.ts` | Nuevo | `formatPeriodLabel()` |
| `front/app/estadisticas/page.tsx` | Modificado | Filtros granularidad/rango/sector, `leadStatusPalette`, skeletons, estados vacíos |
| `front/app/facturacion/page.tsx` | Modificado | Repricing |
| `front/app/tarifas/page.tsx` | Modificado | Repricing planes públicos |
| `front/app/estadisticas/estudios/[id]/page.tsx` | Modificado | Inputs editables, botones generar/regenerar, `ProspectsAdjustPanel` |
| `front/app/clientes/page.tsx` | Modificado | Añadir columnas codCliente/direccion/Facturas |
| `front/app/contactos/page.tsx` | Nuevo | Tabla `ProspectContact` con badges y badge "N" |
| `front/components/nav/*` | Modificado | Badge contador pendientes |
| `front/components/theme/ThemeInitializer.tsx` | Modificado | Fix precedencia favicon |

---

## Contrato de interfaces

```ts
// stats.ts — nuevas exportaciones
export function periodKey(date: Date, granularity: "year"|"month"|"week"|"day"): string;
export function enumeratePeriods(
  from: Date, to: Date,
  granularity: "year"|"month"|"week"|"day",
  cap?: number   // default 600
): string[];

// email-extractor.ts
export function extractEmails(html: string, baseUrl: string): string[];

// contacts router — payload
// POST /api/contacts
interface CreateContactBody {
  type: "lead" | "prospecto";
  name: string;
  phone?: string;
  email?: string;
  sector?: string;
  direccion?: string;
  clientId?: string;
}
// PATCH /api/contacts/:id — subset de CreateContactBody + contactado + contactedAt
// GET /api/contacts/pending-count → { count: number }
```

---

## Estrategia de tests

| Capa | Qué | Enfoque |
|------|-----|---------|
| Unit (back) | `enumeratePeriods` cap + zero-fill | Vitest, sin BD |
| Unit (back) | `periodKey` para los 4 granularity values | Vitest, sin BD |
| Unit (back) | `extractEmails` prioridad mailto, junk filter, cap 3 | Vitest, sin BD |
| Unit (back) | Heurística radio haversine (dentro/fuera del umbral) | Vitest, sin BD |
| Unit (back) | Notificación Gmail: fallo no propaga al caller | Vitest, mock Gmail |
| Unit (back) | `pending-count` solo cuenta `contactado != "si"` | Vitest, mock Prisma |
| Unit (front) | `formatPeriodLabel` para cada granularity × range | Jest/Vitest, sin DOM |
| Unit (front) | `isStatsResponse()` con payload válido/inválido/error HTTP | Jest/Vitest |
| Integration (back) | CRUD `/api/contacts` + pending-count | Supertest, BD de test |
| Regresión | `/api/stats` sin params == baseline P7 | Test existente, debe seguir verde |

---

## Plan de migración y rollout

```sql
-- migrate-crm-contacts.sql (idempotente)

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE "ProspectType" AS ENUM ('lead', 'prospecto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactadoStatus" AS ENUM ('si', 'no', 'nc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Nuevos campos en Client
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "codCliente" TEXT,
  ADD COLUMN IF NOT EXISTS "direccion"  TEXT;

-- 3. Backfill codCliente
UPDATE "Client" c
SET "codCliente" = sub.codigo
FROM (
  SELECT id,
    'cli-' || LPAD(ROW_NUMBER() OVER (ORDER BY "createdAt")::TEXT, 2, '0') AS codigo
  FROM "Client"
) sub
WHERE c.id = sub.id AND c."codCliente" IS NULL;

-- 4. Unique constraint (después del backfill)
ALTER TABLE "Client"
  ADD CONSTRAINT IF NOT EXISTS "Client_codCliente_key" UNIQUE ("codCliente");

-- 5. Tabla ProspectContact
CREATE TABLE IF NOT EXISTS "ProspectContact" (
  "id"          TEXT        NOT NULL,
  "codigo"      TEXT        NOT NULL,
  "type"        "ProspectType" NOT NULL,
  "name"        TEXT        NOT NULL,
  "phone"       TEXT,
  "email"       TEXT,
  "sector"      TEXT,
  "direccion"   TEXT,
  "contactado"  "ContactadoStatus" NOT NULL DEFAULT 'nc',
  "contactedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientId"    TEXT,
  CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProspectContact_codigo_key" UNIQUE ("codigo"),
  CONSTRAINT "ProspectContact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
```

Rollback: `DROP TABLE IF EXISTS "ProspectContact"; ALTER TABLE "Client" DROP COLUMN IF EXISTS "codCliente", DROP COLUMN IF EXISTS "direccion";`

---

## Preguntas abiertas

- [ ] ¿El badge "N" en posibles contactos desaparece automáticamente cuando
      `contactado` cambia a `"si"` sin recargar la página, o solo en el siguiente
      montaje? (Asumido: siguiente montaje / refetch tras mutación.)
- [ ] ¿`pending-count` incluye registros `contactado = "no"` además de `"nc"`, o
      solo `"nc"`? (Asumido: todos los que no sean `"si"`, es decir `"no"` y `"nc"`.)
- [ ] ¿El filtro `?clientId=` en `/facturacion` ya existe, o hay que añadirlo
      como parte de E? (Asumido: se añade en Bloque E si no existe.)
