# SDD: Imágenes en Supabase Storage — versión recortada por valor

> Reescrita tras revisión Devil's Advocate. Regla: mover a Storage **solo** los
> assets con un problema real demostrado. No migrar por estética.

## Contexto y evidencia (no suposiciones)

Inventario real de imágenes y dónde están hoy:

| Asset | Hoy | ¿Problema real? | Decisión |
| --- | --- | --- | --- |
| Imágenes landing builder | back **disco local** `public/landing-assets/<id>/` vía `POST /api/landing/:id/assets` | **SÍ**: disco efímero → se pierden en redeploy / no sirve en multi-instancia | **MIGRAR** |
| Avatar widget | `Agent.widgetAvatarBase64`, servido **base64 inline** en config del widget público (`ai.ts`) en cada load de sitios de terceros | **SÍ**: reenvío de bytes en cada carga, sin caché CDN | **MIGRAR** |
| Favicon / logo sidebar | base64 en `SystemConfig`, servido en `/api/config` (solo panel admin) | **NO**: ~80KB, admin-only, una request | **NO TOCAR** |
| Docs RAG (.pdf/.docx) | otro flujo | no son imágenes | fuera |

Justificación medible: el caso landing tiene **pérdida de datos** en redeploy
(disco efímero) y el avatar tiene **coste de ancho de banda** en páginas públicas.
Favicon/logo no mueven ninguna métrica → quedan como están. Sin migración masiva.

## Nivel

TASK_LEVEL: 2 (recortado desde 3)
RISK_LEVEL: 2

Reversible: campos nuevos son aditivos; el front/widget renderiza URL **o** base64
(coexistencia), así que no hay big-bang ni reescritura destructiva.

Gates humanos:
- Crear bucket + política en Supabase.
- (Sin migración masiva de datos → sin backup-gate de datos. Assets viejos en
  disco se siguen sirviendo; los nuevos van a Storage.)

## Prioridad PREVIA (bloqueante, antes de esto)

El **bucle de login** sigue con fix pendiente: `front/lib/api.ts` debe hacer
`signOut({ scope: 'local' })` en el 401 (limpia sesión local sin depender de red).
Eso bloquea ENTRAR → va **primero**. Storage es secundario.

## Objetivo

Los assets servidos en páginas públicas (landing, widget) viven en Supabase
Storage (durable, cacheable). BD guarda la URL. Sin migración masiva: coexistencia
URL/base64. Favicon/logo intactos.

No objetivo:
- Migrar favicon/sidebarLogo (no aporta).
- Reescribir base64 existente en lote (se deja; opcional lazy).
- Upload directo cliente→Supabase (se mantiene back-mediado; ver §Aceptado).

## Diseño

### 1. Bucket
- `public-assets`, **público**. Justificado: estos assets se muestran en
  páginas anónimas (widget en sitios de clientes, landings publicadas) → son
  públicos por naturaleza, no se fuerza nada privado a público.
- Paths: `widget-avatars/<agentId>.<ext>`, `landing/<projectId>/<cuid>.<ext>`.
- Política: lectura pública; escritura solo service role (back). SQL en gate humano.

### 2. Back — subida
- **Landing**: modificar el endpoint existente `POST /api/landing/:id/assets`:
  hoy `fs.writeFile` a disco → cambiar a `supabaseAdmin.storage.upload` →
  devolver la **URL pública** de Storage (mismo shape `{ ok, path|url }`).
  El front (`BuilderChat`) ya referencia la URL devuelta → cambio mínimo.
- **Avatar widget**: nuevo `POST /api/agents/:id/avatar` (autenticado, dueño):
  sube a `widget-avatars/<agentId>` → guarda URL en nueva columna
  `Agent.widgetAvatarUrl` (aditiva).
- Validación compartida (`lib/uploads` back): MIME allowlist
  (`png/jpeg/webp`), **magic bytes**, ≤2MB. Landing ya convierte a webp en cliente.
  SVG: **no aplica** aquí (avatar=raster; landing=webp). Favicon SVG sigue en
  base64-BD intacto → **sin regresión**.

### 3. BD (aditivo, reversible)
- `Agent.widgetAvatarUrl String? @map("widget_avatar_url")` (nueva).
- `widgetAvatarBase64` se conserva. Resolución de avatar:
  `avatarUrl ?? avatarBase64 ?? emoji`. Coexistencia → migración opcional, nunca
  obligatoria.
- Landing: el campo ya guarda una path/URL → sin cambio de schema.

### 4. Front / widget
- `ai.ts` (config widget público): devolver `avatarUrl` además de
  `avatarBase64`/emoji; el widget usa `avatarUrl || avatarBase64 || emoji`.
- `ChannelStep.tsx` / `DeployPanel.tsx`: subir avatar a `/api/agents/:id/avatar`
  → setState(url). (Si el agente aún no existe en wizard, mantener base64 hasta
  crear y subir tras crear — o subir post-creación.)
- **Resiliencia render** (Devil §6): `<img onError>` → fallback default/emoji.

### 5. GC de huérfanos (Devil §5)
- Al **reemplazar** avatar: borrar blob anterior (best-effort).
- Al **borrar** agente/proyecto: borrar sus blobs (best-effort en el handler).
- Sweep periódico opcional: script que lista blobs sin referencia en BD y los
  elimina (dry-run primero). No en fase 1; documentado como deuda.

### 6. Egress / coste (Devil §8)
- Storage público de landings/widget incurre **egress de Supabase**. Riesgo si
  una landing escala. Acción: monitorizar uso; documentar límites del plan;
  considerar caché/CDN si crece. No bloqueante ahora, sí vigilado.

### 7. Aceptado explícitamente (deuda consciente)
- **Back-mediado** (cliente→back→Storage): doble salto. Aceptado por bajo volumen
  y control de validación/auth. Futuro: signed upload URL directo. (Devil §7.)
- **No** migramos base64 existente. Coexistencia indefinida. (Devil §4.)

## Seguridad
- Bucket público solo para assets de naturaleza pública.
- Subida: auth + allowlist MIME + magic bytes + tamaño. Nombre generado por
  servidor (no del cliente) → sin path traversal.
- Sin SVG en estos flujos → sin XSS por SVG.

## Testing (strict_tdd)
- Back vitest: validación (rechaza no-imagen, >2MB, mime falso por magic bytes;
  exige auth). Mock de storage para unidad.
- **Integración real** (Devil §9): 1 test que sube contra Storage (o local
  supabase) y lee la URL → detecta bucket/policy/content-type mal puestos. El
  mock solo NO basta.
- e2e playwright: avatar en wizard → guarda URL → widget lo muestra.
- Typecheck front+back verdes.

## Fases
0. (Previo) Fix login `signOut({scope:'local'})`.
1. Bucket + política + test de integración (gate humano).
2. Landing endpoint disco→Storage (mínimo, alto valor).
3. Avatar widget: columna `widgetAvatarUrl` + endpoint + front + render fallback.
4. GC en reemplazo/borrado.
5. Verificar + archivar. (Favicon/logo: sin cambios.)

Rollback: columnas aditivas + coexistencia → revertir = dejar de escribir URLs;
los datos viejos siguen válidos. Bucket se puede vaciar/borrar.

## Cerrado (ya no abierto)
- BuilderChat: **persiste** (ya usa `/api/landing/:id/assets`). Incluido en fase 2.
- Favicon/logo: **fuera** (sin valor).
- Multipart vs base64-json: landing ya usa base64-json (`dataUrl`) → **mantener
  base64-json** para consistencia; avatar igual. (No multipart.)
- widgetAvatarBase64→Url: **columna nueva aditiva**, sin renombrar.
