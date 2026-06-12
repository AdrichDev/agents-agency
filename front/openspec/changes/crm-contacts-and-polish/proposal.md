# Propuesta — CRM Contacts & Polish (P10)

> Estado: **in-progress** · Nivel estimado: **4** · Fase roadmap: **P10**
> Bloques A, B, C: implementados. Bloque D: backend en curso. Bloque E: pendiente.

## Intención

Tres carencias acumuladas en el backlog:

1. **Stats dashboard roto y sin granularidad diaria**: `/api/stats` crasheaba la
   página cuando el backend devolvía un error HTTP (front consumía `res.json()`
   sin comprobar `res.ok`). Además faltaban: granularidad `day`, series continuas
   zero-filled, formato de ejes localizado al español, paleta de colores únicos
   por estado y filtros combinables (sector, granularidad, rango).

2. **Market study pro sin precios de mercado reales**: los prompts del estudio
   no anclan los precios al catálogo de servicios real ni a zonas geográficas
   concretas; los competidores carecen de email de contacto; el scraper no tenía
   timeout.

3. **Sin CRM**: la agencia captura leads del chat y maneja clientes, pero no
   existe ni un modelo de contacto centralizado ni una UI para gestionar el
   pipeline (leads → prospectos → clientes). Tampoco hay notificación automática
   al admin cuando llega un nuevo lead.

**Éxito**: (A) dashboard estable con granularidades completas, colores y formato
español; (B) estudios de mercado anclados a precios reales, con emails de
competidores; (C) catálogo de servicios repriced a mercado España-2026; (D)
ProspectContact model + API CRUD + notificación Gmail automática; (E) UI CRM
con tabla de clientes enriquecida, tabla de posibles contactos con badges y
contador de pendientes en el nav.

## Alcance por bloque

### Bloque A — Stats dashboard rework (IMPLEMENTADO)

- Bug fix: `front/lib/api.ts` devuelve `res.json()` sin check `res.ok`; corregido
  en el consumidor con guardia `isStatsResponse()` + defaults defensivos +
  tarjeta de error con retry.
- `back/src/lib/stats.ts`: nueva granularidad `day`, exporta `periodKey` +
  `enumeratePeriods` (series continuas zero-filled, cap 600 buckets), series de
  facturación alineadas, drill-down parsea `YYYY-MM-DD`. Path sin args P7
  byte-idéntico.
- Filtros front: Granularidad = Anual/Mensual/Semanal; Rango = Año en
  curso/Últimos 12 meses/Todo; select de Sector derivado de `/api/clients`
  distinct sectors; select de mes-detalle (12 meses) cuando Mensual.
- `front/components/stats/periodFormat.ts`: day "1/06"; Todo → abreviatura de
  mes con año reemplazando enero en límites de año; ytd/last12m → nombre completo
  de mes; semanas "S23"; tooltips en español inequívocos.
- Colores únicos por estado en "Leads por estado" (`leadStatusPalette`), etiquetas
  de estado en español, formato numérico `es-ES`, skeletons, estados vacíos.

### Bloque B — Market study pro v2 (IMPLEMENTADO)

- `back/src/lib/market-study/study-generator.ts`: reglas de prompt ANCLAJE
  GEOGRÁFICO (cada sección anclada a zona+radio, calles/barrios reales), REGLAS
  DE CONCRECIÓN (sin hedging ni relleno, cada afirmación con número/%/€/zona),
  REGLAS DE PRICING (citar precios del catálogo verbatim vía
  `buildCatalogContext()`).
- `places.ts`: `geocodeZone()` + `haversineKm()`, textSearch sesgado por radio,
  post-filtro estricto de radio para prospectos.
- `competitors.ts`: competidores reales filtrados por radio, website vía Place
  Details, extracción de email de contacto (nuevo `email-extractor.ts`: mailto
  primero, filtrado de junk, cap 3), columna Email con enlace `mailto:`.
- `scraper/web.ts`: timeout `AbortController` de 10 s (corrige warning P9
  verify).
- Front `[id]` page: inputs siempre editables en cualquier estado + "Generar
  con IA"/"Regenerar completo"; nombres de prospectos enlazan a su website
  (nueva pestaña); `ProspectsAdjustPanel` conectado a
  `POST /:id/generate {feedback, refreshProspects:true}`.

### Bloque C — Actualización de precios (IMPLEMENTADO)

- `back/src/lib/service-catalog.ts` + `front/app/facturacion/page.tsx` +
  `front/app/tarifas/page.tsx`: precios actualizados a mercado España-2026
  (respaldados por investigación): chatbot_basic 1200+89/mo, chatbot_pro
  2900+179, chatbot_enterprise 6900+449, web_basic 1190+49, web_chatbot
  3400+149, automation 1900+119, hours 95/h, tokens 39/mo.

### Bloque D — CRM: clientes y contactos prospecto (EN CURSO — agente backend)

- **Schema**: `Client.codCliente` ("cli-01" secuencial, único) +
  `Client.direccion`; nuevo modelo `ProspectContact` (código "pc-01",
  `type enum lead|prospecto`, name/phone/email/sector/direccion,
  `contactado enum si|no|nc` default nc, contactedAt, createdAt, FK nullable
  `clientId → Client`). Migración aditiva + backfill.
- **API**: `/api/contacts` CRUD + `/api/contacts/pending-count` (contactado ≠
  si); clients API devuelve `codCliente`, `direccion`, flag `hasInvoices`.
- **Automatización de leads**: al crear nuevo lead desde landing/chat →
  auto-crear `ProspectContact(type=lead)` + email fire-and-forget al admin vía
  integración Gmail OAuth existente (destinatario `SystemConfig.adminEmail`,
  fallback primer usuario admin). Decisión aprobada: Gmail OAuth, NO SMTP nuevo.

### Bloque E — Front CRM UI + favicon (PENDIENTE)

- **Tabla de clientes**: columnas codCliente, nombre, contacto, teléfono, email,
  dirección, columna Facturas con SVG de documento (rojo = sin facturas, verde =
  tiene) enlazando a `/facturacion` filtrado por cliente.
- **Tabla posibles contactos**: badges contactado sí=verde/no=rojo/nc=naranja,
  badge "N" amarillo para entradas del mismo día hasta que se contacte, columna
  tipo (lead/prospecto), fecha y hora de alta.
- **Nav**: badge contador amarillo con contactos pendientes (contactado ≠ si).
- **Favicon**: default `front/assets/3A_sin_fondo.png`; corrección del reset
  por sesión en `ThemeInitializer`/configuración (precedencia localStorage vs DB).

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/stats.ts` | Modificado | Granularidad `day`, series zero-filled, `periodKey`, `enumeratePeriods` |
| `back/src/lib/market-study/study-generator.ts` | Modificado | Reglas de prompt geográfico y pricing |
| `back/src/lib/market-study/places.ts` | Modificado | Geocodificación, post-filtro radius, bias |
| `back/src/lib/market-study/competitors.ts` | Modificado | Filtro radius, extracción de email |
| `back/src/lib/market-study/email-extractor.ts` | Nuevo | Extracción de email de contacto |
| `back/src/lib/service-catalog.ts` | Modificado | Repricing España-2026 |
| `back/src/lib/scraper/web.ts` | Modificado | Timeout AbortController 10 s |
| `back/prisma/schema.prisma` | Modificado | `codCliente`, `direccion` en Client; nuevo modelo `ProspectContact` |
| `back/src/routes/contacts.ts` | Nuevo | CRUD ProspectContact + pending-count |
| `back/src/index.ts` | Modificado | Mount contacts router, lead-creation hook |
| `front/lib/api.ts` / consumidores stats | Modificado | Guardia `isStatsResponse()`, defaults defensivos |
| `front/components/stats/periodFormat.ts` | Nuevo | Formateo localizado de ejes |
| `front/app/estadisticas/page.tsx` | Modificado | Filtros granularidad/rango/sector, colores, skeletons |
| `front/app/facturacion/page.tsx` | Modificado | Repricing |
| `front/app/tarifas/page.tsx` | Modificado | Repricing |
| `front/app/estadisticas/estudios/[id]/page.tsx` | Modificado | Inputs editables, ProspectsAdjustPanel |
| `front/app/clientes/page.tsx` | Nuevo/Modificado | Tabla enriquecida + columna Facturas |
| `front/app/contactos/page.tsx` | Nuevo | Tabla posibles contactos con badges |
| `front/components/nav` | Modificado | Badge contador pendientes |
| `front/components/theme/ThemeInitializer.tsx` | Modificado | Fix precedencia favicon |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Migración backfill `codCliente` sobre datos existentes | Media | Script idempotente con `ROW_NUMBER()` en SQL; reversible con `ALTER TABLE DROP COLUMN` |
| Gmail OAuth throttling en notificación de lead | Baja | Fire-and-forget con try/catch; fallo no bloquea creación del lead |
| Retrocompatibilidad stats P7 tras nueva granularidad `day` | Baja | Path sin args idéntico; test de regresión existente |
| Reset de favicon en cada sesión (bug de precedencia) | Alta | Prioridad E; fix requiere auditar flujo `ThemeInitializer` vs `localStorage` |

## Plan de rollback

- **A**: revertir `stats.ts` + componentes front; path sin args garantiza que P7
  sigue funcionando.
- **B**: cambios aditivos a módulos existentes; revertir commits individuales por
  archivo.
- **C**: revertir los tres archivos de catálogo a precios anteriores.
- **D**: `DROP TABLE "ProspectContact"`, `ALTER TABLE "Client" DROP COLUMN
  "codCliente"`, eliminar router; sin datos críticos perdidos si no hay UI aún.
- **E**: eliminar páginas y componentes nuevos; sin impacto en backend.

## Dependencias

- Gmail OAuth integration (ya implementada, P2).
- `GOOGLE_MAPS_API_KEY` (opcional; heredada de P8/P9).
- Migración Prisma para `ProspectContact`.

## Criterios de éxito

- [ ] `/api/stats` sin params = salida P7 idéntica (test de regresión verde).
- [ ] Dashboard no crashea ante error de backend; muestra tarjeta de error con retry.
- [ ] Granularidad `day` devuelve serie continua zero-filled sin huecos.
- [ ] Estudios de mercado citan precios del catálogo verbatim y anclan a zona real.
- [ ] Competidores incluyen email de contacto cuando disponible.
- [ ] `ProspectContact` creado automáticamente al llegar un lead nuevo.
- [ ] Admin recibe email de notificación vía Gmail OAuth.
- [ ] UI CRM muestra clientes con `codCliente` y tabla de posibles contactos con badges.
- [ ] Badge nav muestra contador de pendientes en tiempo real.
- [ ] Favicon se mantiene entre sesiones sin resetear.
