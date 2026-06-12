# Design — Landing Builder (P6)

> Estado: **design** · Nivel: **3-4** · Fuente: `proposal.md` + `spec.md` (R1-R7, 20 escenarios, asunciones 1-7 confirmadas).
> Aislamiento: este change toca SOLO el dominio Landing. No reutiliza `Agent`, `/api/chat`, ni el wizard de agentes.

## 1. Arquitectura y aproximación

Patrón general: **dominio aislado vertical** (screaming module `landing/`) sobre la base Express + Prisma + Next.js existente. Capas:

```
Front (Next app router)                     Back (Express)
─────────────────────────                   ──────────────────────────────
app/landing-builder/page.tsx  ──┐
app/landing-builder/[id]/page ──┤  HTTP    routes/landing.ts  (thin router, zod)
components/landing/*           ──┘  JSON →        │
  (Chat, PromptPicker,                            ▼
   FileTree, CodeEditor,                  lib/landing/   (lógica de dominio)
   LivePreview, MobilePanel)                ├─ interview.ts    (DEFAULT_MODEL)
                                            ├─ prompt-master.ts(DEFAULT_MODEL + skill DB)
lib/api.ts (fetch helper)                   ├─ generator.ts    (STRONG_MODEL)
jszip / monaco (client-side)               └─ mobile.ts       (STRONG_MODEL)
                                                   │
                                            lib/openai.ts (DEFAULT_MODEL, STRONG_MODEL)
                                            prisma → LandingProject
```

Principio rector: **el router es delgado** (validación zod + orquestación + persistencia); toda la lógica de IA y construcción vive en `lib/landing/`. Esto mantiene testeable el dominio (mock de `openai`) sin levantar Express.

### Decisión: router dedicado, NO endpoints en index.ts

`back/src/index.ts` ya supera 500 líneas. Se crea `back/src/routes/landing.ts` (export `landingRouter = Router()`) siguiendo el patrón ya establecido por `routes/channels.ts`. En `index.ts` solo se añade el mount:

```ts
import { landingRouter } from "@/routes/landing";
app.use("/api/landing", landingRouter);
```

Esta es la ÚNICA línea (más el import) que el design exige tocar en `index.ts`. Reconcilia el tasks.md original que ubicaba endpoints en `index.ts`.

### Dos modelos por fase (rationale del proposal)

- Decálogo + prompt master → `DEFAULT_MODEL` (mini, barato, conversacional, frecuente).
- Generación de código + scaffold móvil → `STRONG_MODEL` (caro, crítico en calidad).

---

## 2. lib/openai.ts — STRONG_MODEL (resuelve R1)

Añadir export, sin tocar nada existente:

```ts
export const STRONG_MODEL =
  process.env.STRONG_MODEL || (useGemini ? "gemini-2.5-pro" : "gpt-5.4");
```

Decisión R1: el fallback se condiciona a `useGemini`. Si la cuenta usa Gemini y no hay `STRONG_MODEL` explícito, se usa `"gemini-2.5-pro"` (modelo potente válido en ese provider) en lugar de `"gpt-5.4"` (inexistente allí). Cuando el fallback Gemini se activa, `generator.ts`/`mobile.ts` registran `console.warn` (escenario "STRONG_MODEL no configurado con Gemini activo" exige log en servidor).

---

## 3. Backend — módulos `back/src/lib/landing/`

### 3.1 `interview.ts` — decálogo conversacional (R1)

Responsabilidad: conducir las 10 áreas, una pregunta a la vez, adaptando orden/repreguntas y soportando "decide tú".

**Las 10 áreas (constante `DECALOGUE_AREAS`)**: `purpose, businessName, palette, style, images, sections, cta, contact, database, language`.

**Contrato de la función**:

```ts
interface InterviewTurn {
  answers: Record<string, { value: string; assumedByAI: boolean }>;
  question: string | null;        // null ⇒ decálogo completo
  done: boolean;
  area: string | null;            // área que se acaba de capturar/pregunta actual
}

async function runInterviewTurn(
  answers: Record<string, ...>,   // acumulado previo
  userMessage: string | null      // null en el primer turno (arranca)
): Promise<InterviewTurn>
```

**Estrategia LLM**: una llamada a `DEFAULT_MODEL` con system prompt que lista las 10 áreas, el estado `answers` actual, y pide devolver **JSON estricto** (no markdown), parseado con el mismo patrón que `web-import.ts` (strip de ```json y `JSON.parse` en try/catch):

```json
{ "capturedArea": "purpose" | null,
  "capturedValue": "...", "assumedByAI": false,
  "nextArea": "businessName" | null,
  "nextQuestion": "¿Cómo se llama el negocio?" | null,
  "done": false }
```

- "decide tú" / "decide tu" / "lo que veas" → el modelo genera valor razonable y marca `assumedByAI: true` (escenario Delegación).
- Cuando todas las áreas tienen valor → `done: true`, `nextQuestion: null` (escenario Decálogo completado). El front, al ver `done`, dispara prompt master.
- El modelo decide `nextArea` dinámicamente (puede reordenar/repreguntar) → cubre "adapta el orden".

`max_completion_tokens` modesto (~800). Parseo robusto: si JSON inválido, fallback determinista que pregunta la siguiente área pendiente del orden por defecto (la conversación nunca se atasca).

### 3.2 `prompt-master.ts` — paso intermedio (R4)

Responsabilidad: cargar la skill `prompt-master` de DB como guía y producir el prompt de generación + alternativos.

```ts
async function buildGenerationPrompts(
  answers: Record<string, ...>
): Promise<{ generationPrompt: string; alternatives: string[] }>
```

- Carga skill: `prisma.skill.findFirst({ where: { name: { contains: "prompt-master" } } })`. Usa `description` (+ `tools` si hay) como guía del system prompt.
- **Fallback embebido** (`FALLBACK_PROMPT_MASTER_GUIDE`, constante) si no existe la skill: misma calidad observable, sin error visible (escenario fallback). El uso del fallback se loguea en servidor, no se expone al usuario.
- Salida via `DEFAULT_MODEL`, JSON `{ generationPrompt, alternatives: [2-3] }`. Mismo parseo robusto.
- El `generationPrompt` enmarca: landing estática responsive, `index.html` + Tailwind CDN + JS vanilla, placeholders picsum.photos salvo imágenes propias, y la instrucción de capa de datos según `dbProvider`.

### 3.3 `generator.ts` — generación multi-archivo (R2, R3)

Responsabilidad: producir `files Json { path → content }` con `STRONG_MODEL`, validarlo y reintentar.

```ts
interface GenerateResult { files: Record<string, string>; truncated: boolean }

async function generateFiles(
  generationPrompt: string,
  dbProvider: DbProvider,
  opts?: { previous?: Files; feedback?: string; onlyDataLayer?: boolean }
): Promise<GenerateResult>
```

Reglas de diseño:

- **System prompt** exige SOLO JSON `{ "path": "content" }`. Incluye reglas: responsive obligatorio (viewport meta + breakpoints), Tailwind CDN, JS vanilla, picsum si sin imágenes.
- **Capa de datos condicional** (escenario Firebase/Supabase): si `dbProvider !== "none"`, el prompt añade el bloque de instrucciones del provider (`firebase` → snippet config + `addDoc`; `supabase` → `createClient` + insert; `local-postgres` → `fetch` a `/api/...`). Snippets guía como constantes en el módulo (`DATA_LAYER_HINTS`).
- **Validación de estructura**: `parseAndValidateFiles(raw)` — strip markdown, `JSON.parse`, comprobar que es objeto plano `string→string` y que existe `index.html`.
- **2 reintentos** (escenario no parseable): si la validación falla, re-llamada con mensaje de corrección de formato adjuntando el texto crudo. Tras 2 fallos → lanza error con el texto crudo para que el router lo devuelva al usuario.
- **Límite de tamaño** (R3, escenario excede límite): `MAX_FILES_BYTES = 300_000`. Si `JSON.stringify(files).length` lo supera → `truncated: true`; el router persiste hasta donde admite y devuelve aviso claro (no silencia). `max_completion_tokens` alto (~16000) para minimizar truncamiento del modelo.

**Regeneración con feedback** (escenario Regeneración): `opts.previous` + `opts.feedback`. El system prompt recibe los `files` actuales y el feedback NL, e instruye devolver SOLO los archivos a cambiar. `generator.ts` hace el **merge**: `{ ...previous, ...delta }` — los archivos no tocados (incluidas ediciones manuales) se conservan. Esto materializa "conserva los archivos que el usuario no haya solicitado cambiar".

**Regeneración parcial de capa de datos** (R7, cambio de `dbProvider` post-generación): `opts.onlyDataLayer = true`. El modelo genera solo los archivos de la capa de datos para el nuevo provider. `generator.ts` devuelve el `delta`; **la decisión de colisión se resuelve en el router** (ver 4): si algún `path` del delta ya existe en `previous`, el router NO sobrescribe directamente — devuelve un **diff** y exige `confirm: true` en una segunda llamada (escenario Colisión con edición manual).

### 3.4 `mobile.ts` — scaffold Expo / Flutter (R5 dominio)

```ts
async function generateMobileScaffold(
  answers, branding, target: "android" | "ios", stack: "expo" | "flutter"
): Promise<{ files: Record<string, string>; truncated: boolean }>
```

- `STRONG_MODEL`. Mismo parseo/validación/límite/reintentos que `generator.ts` (factorizar `parseAndValidateFiles` y la lógica de retry en un helper compartido `back/src/lib/landing/llm-files.ts` para no duplicar — DRY).
- Plantillas base como constantes guía (`EXPO_SCAFFOLD_HINT`, `FLUTTER_SCAFFOLD_HINT`): estructura mínima válida (`App.tsx`/`app.json`/`package.json` para Expo; `lib/main.dart`/`pubspec.yaml` para Flutter) que el modelo rellena con secciones y paleta de la landing.
- `branding` se deriva de `answers` (palette, style, businessName, sections).

---

## 4. Backend — Prisma, migración y router

### 4.1 Modelo Prisma `LandingProject`

```prisma
model LandingProject {
  id               String   @id @default(cuid())
  name             String
  business         String?
  answers          Json     @default("{}")
  generationPrompt String?
  dbProvider       String   @default("none")  // none | local-postgres | firebase | supabase
  files            Json     @default("{}")     // { path → content }
  mobileFiles      Json     @default("{}")     // { path → content }
  mobileStack      String?                     // expo | flutter
  status           String   @default("draft")  // draft | generated
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([updatedAt])
}
```

### 4.2 Migración manual `back/prisma/migrate-landing-project.sql`

Idempotente, siguiendo la convención de `migrate-skill-type-use.sql` (`CREATE TABLE IF NOT EXISTS`, comentario con `npx prisma db execute --file ...` + `npm run db:push`). Crea tabla `"LandingProject"` con las columnas y un índice en `updatedAt`.

### 4.3 Router `back/src/routes/landing.ts` — contratos

`export const landingRouter = Router();` Todos validan con **zod** y devuelven JSON. Códigos: 200/201 ok, 400 validación, 404 no encontrado, 422 generación no parseable, 409 colisión sin confirm.

| Método | Ruta | Request body | Response |
|---|---|---|---|
| POST | `/` | `{ name }` | `201 LandingProject` (status `draft`) |
| GET | `/` | — | `200 LandingProject[]` (orden `updatedAt desc`) |
| GET | `/:id` | — | `200 LandingProject` \| 404 |
| POST | `/:id/chat` | `{ message: string \| null }` | `200 { question, done, answers, area }` — persiste `answers` (y `business` al capturar businessName) |
| POST | `/:id/prompts` | — (usa `answers` del registro) | `200 { generationPrompt, alternatives[] }` |
| POST | `/:id/generate` | `{ generationPrompt, dbProvider }` | `200 { files, truncated }` (persiste, `status→generated`) \| 422 `{ error, raw }` |
| PATCH | `/:id/files` | `{ files: Record<string,string> }` | `200 { ok, truncated }` (edición manual) |
| POST | `/:id/regenerate` | `{ feedback: string }` | `200 { files, truncated }` (merge delta) \| 422 |
| POST | `/:id/mobile` | `{ stack: "expo"\|"flutter", target: "android"\|"ios" }` | `200 { mobileFiles, truncated }` (persiste `mobileFiles`,`mobileStack`) |
| POST | `/:id/db-provider` | `{ dbProvider, confirm?: boolean }` | `200 { files, truncated }` \| `409 { collisions: string[], diff }` si colisión y `!confirm` |
| DELETE | `/:id` | — | `204` |

Notas de contrato:

- **`PATCH /:id/files`** sustituye al `PUT /api/landing/:id` que mencionaba el spec; es semánticamente la edición manual y respeta el límite de 300KB (devuelve `truncated`). El spec menciona `PATCH/PUT` indistintamente; se fija **PATCH** por convención del repo (`app.patch("/api/agents/:id")`).
- **`/:id/db-provider`**: orquesta el flujo de colisión. Primera llamada sin `confirm`: si el delta de capa de datos pisa archivos existentes (p.ej. `index.html` editado), responde `409` con `collisions` + `diff`. El front muestra el aviso; segunda llamada con `confirm: true` aplica el merge.
- Validación zod por endpoint: `dbProvider ∈ {none,local-postgres,firebase,supabase}`, `stack ∈ {expo,flutter}`, `target ∈ {android,ios}`, `message`/`feedback` longitud acotada.

---

## 5. Frontend

### 5.1 Páginas

- **`front/app/landing-builder/page.tsx`** (lista): server o client component que hace `api("/api/landing")` → cards `.card` con nombre, `status`, `updatedAt`, acciones Abrir / Borrar (`DELETE` + refresh sin recargar) y botón "Nuevo proyecto" (`POST /` → navega a `/landing-builder/[id]`).
- **`front/app/landing-builder/[id]/page.tsx`** (builder): `"use client"`. Layout dos columnas: **izquierda** panel chat decálogo + prompt picker; **derecha** editor (FileTree + CodeEditor + LivePreview) y MobilePanel. Mantiene el estado central del proyecto.

### 5.2 Componentes `front/components/landing/`

| Componente | Responsabilidad | Notas técnicas |
|---|---|---|
| `BuilderChat` | Render del decálogo, input, "decide tú". Llama `POST /:id/chat`. Al `done` muestra CTA a prompt master | reutiliza estilos de chat existentes |
| `PromptPicker` | Muestra `generationPrompt` + alternativos; selección + edición libre; botón Generar (`POST /:id/generate`) | textarea editable |
| `FileTree` | Árbol de `files` (y `mobileFiles`), selección de archivo activo | deriva árbol de las keys `path` |
| `CodeEditor` | Monaco editor del archivo activo; onChange → estado; guardar → `PATCH /:id/files` | `dynamic(() => import("@monaco-editor/react"), { ssr: false })` (R5) |
| `LivePreview` | `<iframe srcdoc={index.html-resuelto} sandbox="allow-scripts">` | sin `allow-same-origin` (R6) |
| `MobilePanel` | Botones Android/iOS + select stack; `POST /:id/mobile`; descarga zip (landing y móvil por separado, jszip) | `jszip` client-side |

### 5.3 Estados y flujo de datos (builder)

Estado central en `[id]/page.tsx`: `{ project, answers, question, generationPrompt, alternatives, files, mobileFiles, activePath, busy, error }`.

Flujo:
```
chat (loop) → done → prompts → [usuario edita] → generate → files
   → FileTree/CodeEditor (edición manual → PATCH) ⇄ LivePreview
   → regenerate(feedback) → merge files
   → db-provider(change) → [409 diff → confirm] → merge data layer
   → mobile(stack,target) → mobileFiles
   → download zip (landing | mobile)
```
LivePreview recomputa `srcdoc` cuando cambian `files["index.html"]` (refleja edición sin recargar página, escenario Edición manual).

---

## 6. Dependencias

- **Front (nuevas)**: `@monaco-editor/react`, `jszip`. `recharts` lo instala P7 (no tocar).
- **Back**: ninguna nueva (reutiliza OpenAI SDK, zod ya presente).

---

## 7. Seguridad

- **iframe**: `sandbox="allow-scripts"` SIN `allow-same-origin` → el JS generado por IA no accede a cookies/origin de la app. `srcdoc` evita servir archivos.
- **Servidor nunca ejecuta** los archivos generados: solo los almacena como texto en `files Json`. No hay `eval`, no hay escritura a disco, no hay child_process.
- **Límites de tamaño**: `MAX_FILES_BYTES = 300_000` en generación/edición/móvil; evita inflar la fila Postgres y respuestas gigantes.
- **Validación zod** en TODOS los endpoints (boundary del sistema). Acotar longitudes de `message`/`feedback`/`name`.
- `max_completion_tokens` por endpoint para acotar coste y respuesta.

---

## 8. Tests (back, unit con mock de `openai`)

- `back/tests/landing-interview.test.ts`: parsing de respuestas (JSON válido, "decide tú" → `assumedByAI`, JSON inválido → fallback determinista, `done` cuando todas las áreas).
- `back/tests/landing-generator.test.ts`: validación de `files` (objeto string→string con `index.html`), reintentos (mock devuelve basura 2 veces → 3ª válida; basura 3 veces → error con raw), límite de tamaño → `truncated`, merge de regeneración conserva archivos no tocados.
- `back/tests/landing-prompt-master.test.ts`: usa skill DB si existe; fallback embebido si no (sin throw, devuelve `generationPrompt` + alternativos).
- `back/tests/landing-mobile.test.ts`: estructura del scaffold Expo y Flutter (paths esperados presentes).
- **Front**: sin unit (deuda Playwright registrada). No bloquea.

Restricción de verificación: no romper los 100 tests existentes (`npm test` en back, typecheck back+front).

---

## 9. ADRs (decisiones con alternativas rechazadas)

**ADR-1 — Router dedicado `routes/landing.ts` vs endpoints en `index.ts`.**
Elegido: router dedicado montado en index. Rechazado: añadir ~10 endpoints a `index.ts` (ya >500 líneas, viola límite de 500 líneas del repo y empeora el merge con P7 que también toca index.ts). Tradeoff: un archivo más, a cambio de aislamiento y menor conflicto.

**ADR-2 — JSON completo `{path→content}` por llamada vs un archivo por llamada (R2).**
Elegido: JSON completo con validación + 2 reintentos + `max_completion_tokens` alto + límite 300KB. Rechazado: una llamada por archivo (N llamadas, más coste/latencia, requiere primero pedir el índice de archivos). Para landings estáticas el volumen es pequeño; el riesgo de truncamiento se mitiga con el límite de tokens y el flag `truncated`.

**ADR-3 — `STRONG_MODEL` condicionado por `useGemini` (R1).**
Elegido: `process.env.STRONG_MODEL || (useGemini ? "gemini-2.5-pro" : "gpt-5.4")`. Rechazado: default fijo `"gpt-5.4"` (rompe en cuentas Gemini). Coherente con el patrón ya existente de `DEFAULT_MODEL`.

**ADR-4 — Merge de regeneración en servidor (`{...previous, ...delta}`).**
Elegido: el modelo devuelve solo archivos cambiados; el servidor mergea. Rechazado: pedir al modelo el proyecto completo en cada regeneración (caro, riesgo de perder ediciones manuales por reescritura total). El merge preserva ediciones manuales de archivos no tocados (R6 spec).

**ADR-5 — Flujo de colisión de capa de datos via 409 + confirm (R7).**
Elegido: `POST /:id/db-provider` devuelve `409 { collisions, diff }` si el delta pisa archivos existentes; el cliente reintenta con `confirm: true`. Rechazado: sobrescribir siempre (pierde ediciones del usuario) o resolver merges en cliente (lógica duplicada, inconsistente). El servidor es la fuente de verdad del diff.

---

## 10. Reconciliación con tasks.md

El orden de implementación se mantiene (datos → back decálogo/prompt/generación → front IDE → móvil → tests) pero se ajustan rutas y nombres:

1. Endpoints van a `back/src/routes/landing.ts`, NO a `index.ts` (solo mount). 
2. Módulos: `interview.ts` (no `questions.ts`), `prompt-master.ts`, `generator.ts` (no `generate.ts`), `mobile.ts`, + helper `llm-files.ts` (parseo/retry/límite compartido).
3. Edición manual: `PATCH /:id/files` (no `PUT /:id`).
4. Nuevo endpoint `POST /:id/db-provider` (cubre R7, ausente en tasks.md original).
5. Componentes front en `front/components/landing/` (no `landing-builder/`), nombres: `BuilderChat`, `PromptPicker`, `FileTree`, `CodeEditor`, `LivePreview`, `MobilePanel`.
6. Item nav `/landing-builder` (🎨) lo añade P7/este change en `front/lib/navigation.ts`.
