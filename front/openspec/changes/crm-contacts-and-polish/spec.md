# Spec: crm-contacts-and-polish (P10)

## Criterios de aceptación

---

### Bloque A — Stats dashboard rework

#### A-S1 — Guardia de respuesta de stats

- DADO que el backend devuelve un status HTTP ≥ 400 en `GET /api/stats`,
  CUANDO el front procesa la respuesta,
  ENTONCES la función `isStatsResponse()` devuelve `false`, se aplican los
  defaults defensivos, y se muestra una tarjeta de error con botón "Reintentar";
  la página NO lanza una excepción no capturada.

- DADO que `res.json()` falla (payload inválido o red cortada),
  CUANDO el consumidor atrapa el error,
  ENTONCES se aplican los mismos defaults defensivos y la tarjeta de error
  aparece sin bloquear el render del resto de la página.

#### A-S2 — Granularidad `day` en backend

- DADO `GET /api/stats?granularity=day&range=last12m`,
  CUANDO `getStats` procesa la petición,
  ENTONCES la serie temporal devuelve **un bucket por día** dentro del rango,
  incluyendo días con valor cero (sin huecos), con `periodKey` en formato
  `YYYY-MM-DD`, hasta un máximo de 600 buckets.

- DADO `GET /api/stats` sin parámetros (path P7),
  CUANDO se procesa la petición,
  ENTONCES la respuesta es byte-idéntica a la baseline P7 (test de regresión
  verde).

- DADO cualquier granularidad (year/month/week/day) con un rango que produce N
  buckets,
  CUANDO `enumeratePeriods` genera la serie,
  ENTONCES todos los periodos del rango aparecen en orden cronológico con valor
  0 si no hay datos, sin periodos duplicados ni faltantes, respetando el cap de
  600.

#### A-S3 — Filtros front

- DADO que el usuario selecciona Granularidad = "Mensual" y Rango = "Año en
  curso",
  CUANDO se ejecuta el fetch a `/api/stats`,
  ENTONCES los params `granularity=month&range=ytd` llegan al backend y los
  gráficos muestran meses del año en curso con etiquetas de nombre completo en
  español.

- DADO que el usuario selecciona un Sector del select derivado de
  `/api/clients` (sectores distintos),
  CUANDO se ejecuta el fetch,
  ENTONCES el param `sector={valor}` se incluye en la query string.

- DADO que Granularidad = "Mensual" está activa,
  CUANDO se renderiza la toolbar,
  ENTONCES aparece un select adicional de mes-detalle con los 12 meses en
  español.

#### A-S4 — Formato de ejes y tooltips

- `periodFormat.ts` debe cumplir:
  - Granularidad `day`: etiqueta "1/06", "15/06", etc. (sin cero a la izquierda
    en el día).
  - Rango `all` con granularidad `month`: abreviatura de mes (ene/feb/…); en
    enero de cada año que no sea el primero, mostrar "ene 25" (año de dos
    dígitos).
  - Rango `ytd` o `last12m` con granularidad `month`: nombre completo (Enero,
    Febrero, …).
  - Granularidad `week`: "S23", "S24", etc. (número de semana ISO).
  - Tooltips en español sin ambigüedad (fecha completa legible).

#### A-S5 — Colores, etiquetas y UX

- El gráfico "Leads por estado" usa `leadStatusPalette`: cada estado tiene un
  color único; ningún color se repite entre los estados.
- Las etiquetas de estado en el gráfico son en español (p.ej. "Nuevo", "En
  progreso", "Cerrado").
- Los números en tarjetas KPI usan formato `es-ES` (separador de miles: punto;
  decimales: coma).
- Mientras se carga, se muestran componentes skeleton en lugar de áreas en
  blanco.
- Si la consulta devuelve datos vacíos para una serie, se muestra un estado
  vacío explícito (no un gráfico vacío silencioso).

---

### Bloque B — Market study pro v2

#### B-S1 — Anclaje geográfico en prompts

- DADO que se genera un estudio para zona "Salamanca, Madrid" radio 3 km,
  CUANDO el LLM recibe el prompt,
  ENTONCES cada sección del estudio contiene al menos una referencia explícita
  a la zona (nombre de barrio, calle, distrito o municipio real); el texto no
  usa frases genéricas como "la zona estudiada" sin concreción geográfica.

#### B-S2 — Reglas de concreción

- El estudio generado no contiene las palabras/frases "podría", "quizás",
  "aproximadamente" ni equivalentes sin ir acompañadas de una cifra concreta,
  porcentaje, rango de € o zona específica.
- Cada afirmación de precio, porcentaje de mercado o cuota incluye un número
  explícito.

#### B-S3 — Precios del catálogo verbatim

- DADO que `buildCatalogContext()` construye el contexto del catálogo,
  CUANDO el LLM genera recomendaciones de pricing,
  ENTONCES los precios citados en la sección de opciones recomendadas son
  idénticos a los valores de `SERVICE_CATALOG` (no interpolados ni redondeados
  libremente).

#### B-S4 — Post-filtro de radio en prospectos

- DADO una búsqueda de prospectos con zona geocodificada y radio 2 km,
  CUANDO Places devuelve resultados,
  ENTONCES `haversineKm(origin, result)` se calcula para cada resultado y solo
  pasan el filtro los que están a ≤ radio km del origen geocodificado.
  Los resultados fuera del radio se descartan silenciosamente.

#### B-S5 — Extracción de email de competidores

- DADO que `email-extractor.ts` analiza el HTML de la web de un competidor,
  CUANDO encuentra un enlace `mailto:`,
  ENTONCES devuelve ese email en primer lugar.
- DADO que se encuentran múltiples emails,
  CUANDO se aplica el filtro de junk (noreply, info@, soporte@, etc.),
  ENTONCES se descartan los que coinciden con la lista de junk y se devuelven
  como máximo 3 emails válidos.
- DADO que la web no tiene `mailto:` pero tiene emails en texto plano,
  CUANDO se aplica el extractor,
  ENTONCES se intenta extraer con regex; si no se encuentra ninguno, se devuelve
  array vacío sin lanzar error.

#### B-S6 — Timeout del scraper

- DADO que `scraper/web.ts` inicia una petición HTTP a una URL externa,
  CUANDO la respuesta no llega en 10 segundos,
  ENTONCES el `AbortController` cancela la petición y el scraper devuelve
  resultado vacío con flag `unverified: true`; no lanza excepción no capturada.

#### B-S7 — Front: inputs siempre editables

- DADO un estudio en estado `completed` o `generating`,
  CUANDO el usuario visualiza la página `[id]`,
  ENTONCES los campos de inputs (zona, radio, sectores, etc.) son editables
  (no bloqueados por estado) y el botón "Generar con IA" / "Regenerar completo"
  está visible y operativo.

#### B-S8 — ProspectsAdjustPanel

- DADO que el usuario ajusta el feedback en `ProspectsAdjustPanel` y pulsa
  "Actualizar prospectos",
  CUANDO se envía la petición,
  ENTONCES se hace `POST /:id/generate` con body `{ feedback: string,
  refreshProspects: true }` y el panel de prospectos se recarga con los
  resultados actualizados.

---

### Bloque C — Actualización de precios

#### C-S1 — Coherencia del catálogo

- Los siguientes servicios tienen exactamente estos precios en
  `back/src/lib/service-catalog.ts`, `front/app/facturacion/page.tsx` y
  `front/app/tarifas/page.tsx` (los tres archivos deben estar sincronizados):

  | serviceId | implPrice | maintPrice/mo |
  |-----------|-----------|---------------|
  | chatbot_basic | 1200 | 89 |
  | chatbot_pro | 2900 | 179 |
  | chatbot_enterprise | 6900 | 449 |
  | web_basic | 1190 | 49 |
  | web_chatbot | 3400 | 149 |
  | automation | 1900 | 119 |
  | hours | 95 (por hora) | — |
  | tokens | — | 39 |

- DADO que se genera un presupuesto con línea `chatbot_pro`,
  CUANDO se calcula el precio,
  ENTONCES `implPrice` = 2900 y `maintPrice` = 179 (sin margen ni redondeo
  adicional desde el catálogo).

---

### Bloque D — CRM: clientes y contactos prospecto

#### D-S1 — Schema `ProspectContact`

- El modelo `ProspectContact` en `schema.prisma` tiene los campos:
  `id` (cuid), `codigo` (String único, formato "pc-NNN" secuencial),
  `type` (enum `lead | prospecto`), `name` (String), `phone` (String?),
  `email` (String?), `sector` (String?), `direccion` (String?),
  `contactado` (enum `si | no | nc`, default `nc`), `contactedAt` (DateTime?),
  `createdAt` (DateTime, default now), `clientId` (String?, FK nullable
  a `Client`).

- El campo `Client.codCliente` existe como String único con formato "cli-NNN".
- El campo `Client.direccion` existe como String?.
- La migración es aditiva: no elimina columnas existentes; el backfill de
  `codCliente` asigna valores a clientes existentes de forma idempotente.

#### D-S2 — API CRUD de contactos

- `GET /api/contacts` devuelve lista paginable de `ProspectContact` con todos
  sus campos.
- `POST /api/contacts` crea un `ProspectContact`; valida que `type` sea
  `lead | prospecto` y `contactado` sea `si | no | nc`; devuelve 201 con el
  objeto creado.
- `PATCH /api/contacts/:id` actualiza campos editables (incluye `contactado`,
  `contactedAt`, `clientId`); devuelve 200 con objeto actualizado.
- `DELETE /api/contacts/:id` elimina el registro; devuelve 204.
- `GET /api/contacts/pending-count` devuelve `{ count: number }` con el total
  de registros donde `contactado != "si"`.

#### D-S3 — API clientes enriquecida

- `GET /api/clients` (o `GET /api/clients/:id`) incluye en la respuesta los
  campos `codCliente`, `direccion` y `hasInvoices` (boolean: `true` si el
  cliente tiene al menos un `Budget` asociado).

#### D-S4 — Automatización de leads

- DADO que llega un nuevo lead desde el flujo de chat o landing,
  CUANDO se persiste el modelo `Lead`,
  ENTONCES se crea automáticamente un `ProspectContact` con `type = "lead"`,
  `name` = nombre del lead, `email` = email del lead (si existe), `phone` =
  teléfono del lead (si existe), `contactado = "nc"`.

- DADO que `SystemConfig.adminEmail` está configurado,
  CUANDO se crea el `ProspectContact`,
  ENTONCES se envía un email de notificación al `adminEmail` vía la integración
  Gmail OAuth existente (fire-and-forget: un fallo en el envío NO bloquea ni
  revierte la creación del lead).

- DADO que `SystemConfig.adminEmail` no está configurado,
  CUANDO se intenta enviar la notificación,
  ENTONCES se usa el email del primer usuario con rol admin como destinatario
  de fallback; si no existe ninguno, el envío se omite silenciosamente.

---

### Bloque E — Front CRM UI + favicon

#### E-S1 — Tabla de clientes

- La tabla de clientes en `/clientes` muestra columnas: codCliente, Nombre,
  Contacto, Teléfono, Email, Dirección, Facturas.
- La columna Facturas muestra un icono SVG de documento:
  - Rojo si `hasInvoices = false`.
  - Verde si `hasInvoices = true`.
  - El icono es un enlace que navega a `/facturacion?clientId={id}` filtrando
    por ese cliente.

#### E-S2 — Tabla de posibles contactos

- La página `/contactos` (o sección CRM) muestra una tabla con columnas: Código,
  Nombre, Tipo, Teléfono, Email, Sector, Dirección, Contactado, Fecha/Hora alta.
- La columna Contactado muestra un badge:
  - Verde + texto "Sí" si `contactado = "si"`.
  - Rojo + texto "No" si `contactado = "no"`.
  - Naranja + texto "NC" si `contactado = "nc"`.
- Las entradas creadas el mismo día calendario que el momento de la visita y
  con `contactado != "si"` muestran un badge "N" amarillo en la columna Nombre.
- La columna Tipo muestra "Lead" o "Prospecto" según `type`.
- La columna Fecha/Hora alta muestra fecha y hora en formato español (dd/mm/aaaa
  hh:mm).

#### E-S3 — Badge de pendientes en nav

- El ítem de navegación CRM/Contactos muestra un badge amarillo con el número
  devuelto por `GET /api/contacts/pending-count`.
- DADO que `pending-count` devuelve 0,
  CUANDO se renderiza el nav,
  ENTONCES el badge NO se muestra (o muestra "0" solo si esa es la convención
  del resto de badges del nav).
- El badge se actualiza al navegar entre páginas (al menos en cada montaje del
  componente nav).

#### E-S4 — Favicon persistente

- DADO que el usuario ha configurado un favicon personalizado y recarga la
  página,
  CUANDO `ThemeInitializer` se ejecuta,
  ENTONCES el favicon del navegador refleja el valor almacenado (localStorage
  o DB) sin resetear al favicon por defecto entre sesiones.
- El favicon por defecto es `front/assets/3A_sin_fondo.png` cuando no hay valor
  configurado.
- La precedencia es: localStorage (si existe y es válido) > DB (`SystemConfig`)
  > default.
