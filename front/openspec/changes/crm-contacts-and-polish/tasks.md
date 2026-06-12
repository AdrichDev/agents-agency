# Tasks — CRM Contacts & Polish (P10)

> Change: `crm-contacts-and-polish` · Nivel 4
> Bloques A, B, C: IMPLEMENTADOS. Bloque D: backend en curso. Bloque E: pendiente.
> Guard de revisión: cambio grande y multi-bloque → PRs encadenados por bloque
> recomendados (A+B+C ya cerrados; D y E como PRs separados).

---

## Bloque A — Stats dashboard rework

### A1. Bug fix: guardia de respuesta stats

- [x] A1.1 Crear función `isStatsResponse(data: unknown): data is StatsResponse`
       en el consumidor de stats front.
- [x] A1.2 Envolver la llamada a `/api/stats` con check `res.ok`; si falla,
       aplicar `defaultStatsResponse` con ceros.
- [x] A1.3 Renderizar tarjeta de error con botón "Reintentar" cuando
       `isStatsResponse` devuelve `false` o la llamada falla.

### A2. Backend: granularidad `day` y series continuas

- [x] A2.1 Añadir granularidad `day` al enum `Granularity` en `stats.ts`.
- [x] A2.2 Implementar `periodKey(date, granularity)` y exportarlo.
- [x] A2.3 Implementar `enumeratePeriods(from, to, granularity, cap=600)` y
       exportarlo; garantizar zero-fill sin huecos.
- [x] A2.4 Aplicar `enumeratePeriods` a las series de facturación y leads
       para rellenar periodos sin datos con valor 0.
- [x] A2.5 Alinear series de facturación con `enumeratePeriods` (mismo bucketing).
- [x] A2.6 Drill-down: parsear correctamente `YYYY-MM-DD` cuando
       granularity=day.
- [x] A2.7 Verificar que `/api/stats` sin params sigue siendo byte-idéntico
       a baseline P7 (test de regresión existente verde).

### A3. Front: filtros toolbar

- [x] A3.1 Select Granularidad: opciones Anual/Mensual/Semanal (year/month/week).
- [x] A3.2 Select Rango: Año en curso (ytd) / Últimos 12 meses (last12m) / Todo (all).
- [x] A3.3 Select Sector: derivado de `GET /api/clients` → distinct sectors.
- [x] A3.4 Select mes-detalle (12 meses en español) visible solo cuando
       Granularidad = Mensual.
- [x] A3.5 Refetch parametrizado al cambiar cualquier filtro.

### A4. Front: formato de ejes y tooltips (`periodFormat.ts`)

- [x] A4.1 Crear `front/components/stats/periodFormat.ts` con
       `formatPeriodLabel(periodKey, granularity, range, opts?)`.
- [x] A4.2 Implementar formato `day`: "1/06", "15/06" (sin cero a la izquierda).
- [x] A4.3 Implementar formato `month` con rango `all`: abrev. mes + año en límites.
- [x] A4.4 Implementar formato `month` con rango `ytd`/`last12m`: nombre completo.
- [x] A4.5 Implementar formato `week`: "S23".
- [x] A4.6 Tooltips en español (fecha completa legible).

### A5. Front: UX stats

- [x] A5.1 Definir `leadStatusPalette` como `Record<string, string>` con color
       único por estado; etiquetas en español.
- [x] A5.2 Aplicar formato `es-ES` a números en tarjetas KPI.
- [x] A5.3 Añadir componentes skeleton durante la carga de stats.
- [x] A5.4 Añadir estados vacíos explícitos cuando la serie devuelve 0 datos.

---

## Bloque B — Market study pro v2

### B1. Prompts: anclaje geográfico y concreción

- [x] B1.1 Añadir bloque ANCLAJE GEOGRÁFICO al system prompt de
       `study-generator.ts`: cada sección debe mencionar zona/barrio/calle real.
- [x] B1.2 Añadir bloque REGLAS DE CONCRECIÓN: prohibir hedging sin cifra;
       exigir número/€/% en toda afirmación de mercado.
- [x] B1.3 Añadir bloque REGLAS DE PRICING: inyectar `buildCatalogContext()`
       en el prompt; exigir citar precios verbatim del catálogo.

### B2. Places: geocodificación y post-filtro de radio

- [x] B2.1 Implementar `geocodeZone(zone: string): Promise<{lat,lng}>` en
       `places.ts` usando Geocoding API.
- [x] B2.2 Implementar `haversineKm(a: {lat,lng}, b: {lat,lng}): number`.
- [x] B2.3 Aplicar bias de radio en `textSearch` (campo `locationBias` o
       `locationRestriction`).
- [x] B2.4 Post-filtrar resultados: descartar los que estén a > radius km
       del origen geocodificado.

### B3. Competidores: filtro radio + email

- [x] B3.1 Aplicar `haversineKm` a resultados de búsqueda de competidores;
       descartar los fuera del radio.
- [x] B3.2 Obtener website de cada competidor vía Place Details.
- [x] B3.3 Crear `back/src/lib/market-study/email-extractor.ts` con
       `extractEmails(html, baseUrl): string[]`.
- [x] B3.4 Invocar `extractEmails` para cada competidor con website;
       almacenar hasta 3 emails.
- [x] B3.5 Mostrar columna Email en la tabla de competidores con enlace
       `mailto:` (front).

### B4. Scraper timeout

- [x] B4.1 Añadir `AbortController` con timeout de 10 s en `scraper/web.ts`.
- [x] B4.2 En caso de abort, devolver resultado vacío con `unverified: true`;
       sin excepción no capturada.

### B5. Front: inputs editables y ProspectsAdjustPanel

- [x] B5.1 Eliminar el bloqueo de inputs por estado en la página `[id]` del
       estudio; todos los campos editables en cualquier estado.
- [x] B5.2 Mostrar botón "Generar con IA" cuando `status = "draft"` y
       "Regenerar completo" en cualquier otro estado.
- [x] B5.3 Nombres de prospectos como enlaces `<a href={websiteUrl} target="_blank">`.
- [x] B5.4 Conectar `ProspectsAdjustPanel` a
       `POST /:id/generate { feedback, refreshProspects: true }`.

---

## Bloque C — Actualización de precios

- [x] C1 Actualizar `back/src/lib/service-catalog.ts` con precios España-2026.
- [x] C2 Actualizar `front/app/facturacion/page.tsx` (`SERVICE_CATALOG`).
- [x] C3 Actualizar `front/app/tarifas/page.tsx` (planes públicos alineados).
- [x] C4 Verificar que los tres archivos tienen exactamente los mismos valores
       numéricos para cada `serviceId`.

---

## Bloque D — CRM: clientes y contactos prospecto (EN CURSO)

### D1. Schema y migración

- [x] D1.1 Añadir enums `ProspectType` y `ContactadoStatus` a `schema.prisma`.
- [x] D1.2 Añadir modelo `ProspectContact` con todos sus campos a `schema.prisma`.
- [x] D1.3 Añadir `codCliente String? @unique` y `direccion String?` a `Client`.
- [ ] D1.4 Crear `back/prisma/migrate-crm-contacts.sql` (idempotente: enums,
       ALTER TABLE Client, backfill codCliente, CREATE TABLE ProspectContact).
- [ ] D1.5 Ejecutar `npx prisma db execute --file migrate-crm-contacts.sql &&
       npx prisma generate` en entorno de desarrollo.
- [ ] D1.6 Añadir constraint `@unique` en `Client.codCliente` tras backfill
       (incluido en el SQL).

### D2. Router `/api/contacts`

- [ ] D2.1 Crear `back/src/routes/contacts.ts` con Express `Router`.
- [ ] D2.2 Implementar `GET /api/contacts` (lista paginable).
- [ ] D2.3 Implementar `POST /api/contacts` con validación Zod
       (type, name, contactado enum).
- [ ] D2.4 Implementar `PATCH /api/contacts/:id`.
- [ ] D2.5 Implementar `DELETE /api/contacts/:id` (devuelve 204).
- [ ] D2.6 Implementar `GET /api/contacts/pending-count` →
       `{ count: number }` (contactado != "si").
- [ ] D2.7 Montar `contactsRouter` en `back/src/index.ts`.

### D3. API clientes enriquecida

- [ ] D3.1 Añadir `codCliente` y `direccion` al select de `GET /api/clients`.
- [ ] D3.2 Calcular `hasInvoices` vía `_count.budgets > 0` e incluirlo en
       la respuesta.

### D4. Automatización de leads

- [ ] D4.1 En el handler que crea un `Lead` (landing/chat), añadir creación
       automática de `ProspectContact(type="lead")` en el mismo bloque
       transaccional (o inmediatamente después).
- [ ] D4.2 Implementar función `notifyAdminNewLead(contact)` que usa la
       integración Gmail OAuth existente para enviar email al admin.
- [ ] D4.3 Invocar `notifyAdminNewLead` en fire-and-forget (`catch` con
       `console.error`); no bloquea la respuesta HTTP.
- [ ] D4.4 Leer `SystemConfig.adminEmail`; si es null/vacío, hacer fallback
       al email del primer usuario con rol admin; si no hay ninguno, omitir.

### D5. Tests bloque D

- [ ] D5.1 Test `pending-count`: solo cuenta `contactado = "no"` y `"nc"`,
       no `"si"`.
- [ ] D5.2 Test `notifyAdminNewLead`: fallo de Gmail no lanza excepción al
       caller (mock que rechaza).
- [ ] D5.3 Test CRUD básico: POST crea con código secuencial; PATCH actualiza
       `contactado`; GET pending-count decrece tras actualizar a "si".

---

## Bloque E — Front CRM UI + favicon (PENDIENTE)

### E1. Tabla de clientes

- [ ] E1.1 Añadir columnas codCliente y Dirección a la tabla de
       `front/app/clientes/page.tsx`.
- [ ] E1.2 Añadir columna Facturas con icono SVG documento (rojo/verde según
       `hasInvoices`).
- [ ] E1.3 El icono Facturas es enlace a `/facturacion?clientId={id}`.
- [ ] E1.4 Si `/facturacion` no acepta aún `?clientId=`, añadir el filtro.

### E2. Página posibles contactos

- [ ] E2.1 Crear `front/app/contactos/page.tsx` con tabla de `ProspectContact`.
- [ ] E2.2 Columna Contactado: badges verde/rojo/naranja (sí/no/nc).
- [ ] E2.3 Badge "N" amarillo en columna Nombre para entradas del mismo día
       con `contactado != "si"`.
- [ ] E2.4 Columna Tipo: "Lead" / "Prospecto".
- [ ] E2.5 Columna Fecha/Hora alta: formato "dd/mm/aaaa hh:mm".
- [ ] E2.6 Acción inline para actualizar `contactado` (select o botones).

### E3. Badge de pendientes en nav

- [ ] E3.1 Fetch `GET /api/contacts/pending-count` en el componente nav
       (en `useEffect([pathname])`).
- [ ] E3.2 Mostrar badge amarillo con el número; ocultar si count = 0.
- [ ] E3.3 Añadir enlace en el nav hacia `/contactos`.

### E4. Favicon persistente

- [ ] E4.1 Auditar flujo en `ThemeInitializer.tsx`: identificar dónde se
       sobreescribe localStorage con valor `null` de DB.
- [ ] E4.2 Corregir precedencia: localStorage > DB > default.
- [ ] E4.3 Solo escribir en localStorage cuando DB tiene valor no nulo.
- [ ] E4.4 El favicon por defecto es `/assets/3A_sin_fondo.png` si no hay
       valor en localStorage ni DB.

---

## Cierre

- [ ] Z1 Ejecutar `cd back && npm test` — todos los tests verdes incluyendo
       nuevos de bloque D.
- [ ] Z2 Ejecutar `cd front && npm run typecheck` — sin errores de tipos.
- [ ] Z3 Verificar `next build` front sin warnings de tamaño ni errores.
- [ ] Z4 Comprobar que test de regresión P7 (`/api/stats` sin params) sigue verde.
- [ ] Z5 Actualizar `front/openspec/changes/README.md` con la entrada P10.
- [ ] Z6 Actualizar `front/openspec/project.md`: añadir P10 en Completed Roadmap
       Phases y actualizar Current SDD State.
