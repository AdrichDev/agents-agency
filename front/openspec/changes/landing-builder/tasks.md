# Tasks — Landing Builder (P6)

> Granular, con rutas. Estado inicial: todas pendientes.
> Orden sugerido: datos → back (decálogo, prompt master, generación) → front IDE → móvil → tests.
> Reconciliado con `design.md`: endpoints en `back/src/routes/landing.ts` (NO en index.ts),
> módulos `interview/prompt-master/generator/mobile/llm-files`, edición vía `PATCH /:id/files`,
> nuevo endpoint `POST /:id/db-provider`, componentes en `front/components/landing/`.

## 1. Datos / Prisma

- [x] 1.1 Añadir modelo `LandingProject` a `back/prisma/schema.prisma`
  (`id, name, business, answers Json, generationPrompt, dbProvider, files Json,
  mobileFiles Json, mobileStack, status, createdAt, updatedAt`).
- [x] 1.2 Crear migración manual `back/prisma/migrate-landing-project.sql`
  (CREATE TABLE + índices).
- [x] 1.3 Aplicar con `prisma db push` y regenerar cliente Prisma.

## 2. Backend — configuración de modelo

- [x] 2.1 Añadir `STRONG_MODEL` en `back/src/lib/openai.ts`:
  `process.env.STRONG_MODEL || (useGemini ? "gemini-2.5-pro" : "gpt-5.4")` (R1, ADR-3).
- [x] 2.2 Crear `back/src/routes/landing.ts` (`landingRouter = Router()`) y montarlo en
  `index.ts` con `app.use("/api/landing", landingRouter)` (única línea + import en index.ts, ADR-1).
- [x] 2.3 Helper compartido `back/src/lib/landing/llm-files.ts`
  (parseo `{path→content}`, validación, 2 reintentos, límite `MAX_FILES_BYTES = 300_000`).

## 3. Backend — flujo conversacional (decálogo)

- [x] 3.1 `back/src/lib/landing/interview.ts`: `runInterviewTurn(answers, message)`
  con `DECALOGUE_AREAS` (10), `DEFAULT_MODEL`, JSON estricto, "decide tú" →
  `assumedByAI`, fallback determinista si JSON inválido (R1, escenarios decálogo).
- [x] 3.2 Endpoint `POST /:id/chat` en `routes/landing.ts`: zod, persiste `answers`
  (y `business` al capturar businessName), devuelve `{ question, done, answers, area }`.
  NO usa Agent ni `/api/chat`.

## 4. Backend — prompt master

- [x] 4.1 `back/src/lib/landing/prompt-master.ts`: `buildGenerationPrompts(answers)`.
  Carga skill `findFirst({ name: { contains: "prompt-master" } })`; `FALLBACK_PROMPT_MASTER_GUIDE`
  embebido si no existe (R4). Devuelve `{ generationPrompt, alternatives[2-3] }`.
- [x] 4.2 Endpoint `POST /:id/prompts` en `routes/landing.ts` (usa `answers` del registro).

## 5. Backend — generación de código

- [x] 5.1 `back/src/lib/landing/generator.ts`: `generateFiles(generationPrompt, dbProvider, opts)`
  con `STRONG_MODEL`, usa `llm-files.ts`. Landing responsive (viewport + breakpoints,
  Tailwind CDN, JS vanilla, picsum si sin imágenes).
- [x] 5.2 `DATA_LAYER_HINTS` por `dbProvider` (firebase / supabase / local-postgres);
  inyectados al prompt si `dbProvider !== "none"`.
- [x] 5.3 Endpoint `POST /:id/generate`: persiste `files`, `status→generated`;
  422 `{ error, raw }` si no parseable; `truncated` si > 300KB (ADR-2).
- [x] 5.4 Regeneración con feedback: `opts.previous + opts.feedback` → modelo devuelve
  delta → merge `{...previous, ...delta}`. Endpoint `POST /:id/regenerate` (ADR-4).
- [x] 5.5 Edición manual: endpoint `PATCH /:id/files` (persiste `files`, respeta límite).
- [x] 5.6 Regeneración parcial de capa de datos: `opts.onlyDataLayer`. Endpoint
  `POST /:id/db-provider` con `{ dbProvider, confirm? }`; `409 { collisions, diff }`
  si el delta pisa archivos existentes y `!confirm` (R7, ADR-5).
- [x] 5.7 CRUD: `POST /` (crear, status draft), `GET /`, `GET /:id`, `DELETE /:id`.

## 6. Backend — app móvil

- [x] 6.1 `back/src/lib/landing/mobile.ts`: `generateMobileScaffold(answers, branding, target, stack)`
  con `STRONG_MODEL` + `llm-files.ts`. `EXPO_SCAFFOLD_HINT` / `FLUTTER_SCAFFOLD_HINT`.
- [x] 6.2 Endpoint `POST /:id/mobile` con `{ stack, target }`: persiste `mobileFiles`, `mobileStack`.

## 7. Frontend — navegación y página

- [x] 7.1 Añadir item `{ href: "/landing-builder", label: "Landing Builder",
  icon: "🎨" }` en `front/lib/navigation.ts`.
- [x] 7.2 Página `front/app/landing-builder/page.tsx`: lista de proyectos
  (cards `.card`) + entrada al builder. Usa `@/lib/api`.

## 8. Frontend — builder conversacional

- [x] 8.1 `front/app/landing-builder/[id]/page.tsx`: estado central, layout 2 columnas.
- [x] 8.2 `front/components/landing/BuilderChat.tsx`: decálogo contra `POST /:id/chat`,
  soporte "decide tú", CTA a prompt master al `done`.
- [x] 8.3 `front/components/landing/PromptPicker.tsx`: `generationPrompt` editable +
  alternativos (aceptar/editar) → `POST /:id/generate`.

## 9. Frontend — editor IDE

- [x] 9.1 Instalar deps front: `@monaco-editor/react`, `jszip` (recharts ya lo instala P7).
- [x] 9.2 `front/components/landing/FileTree.tsx` (árbol derivado de keys `path`).
- [x] 9.3 `front/components/landing/CodeEditor.tsx`: Monaco con
  `dynamic(() => import("@monaco-editor/react"), { ssr: false })` (R5).
- [x] 9.4 `front/components/landing/LivePreview.tsx`: `<iframe srcdoc
  sandbox="allow-scripts">` sin `allow-same-origin` (R6).
- [x] 9.5 Botón regenerar con feedback → `POST /:id/regenerate`.
- [x] 9.6 Guardado de ediciones manuales (`PATCH /:id/files`).

## 10. Frontend — móvil y descarga

- [x] 10.1 `front/components/landing/MobilePanel.tsx`: botones Android/iOS + select stack
  (Expo / Flutter) → `POST /:id/mobile`.
- [x] 10.2 Cargar `mobileFiles` al mismo `FileTree`/`CodeEditor`.
- [x] 10.3 Descarga zip client-side con `jszip` (landing y móvil por separado, Q1).
- [x] 10.4 Cambio de BD post-generación: UI que llama `POST /:id/db-provider`,
  muestra diff y reintenta con `confirm: true` (R7, ADR-5).

## 11. Frontend — lista y navegación

- [x] 11.1 Item `{ href: "/landing-builder", label: "Landing Builder", icon: "🎨" }`
  en `front/lib/navigation.ts`.
- [x] 11.2 `front/app/landing-builder/page.tsx`: lista (cards `.card`), crear/abrir/borrar.

## 12. Tests y verificación

- [x] 12.1 `back/tests/landing-interview.test.ts` (parsing, "decide tú", JSON inválido, done).
- [x] 12.2 `back/tests/landing-generator.test.ts` (validación files, reintentos, límite, merge).
- [x] 12.3 `back/tests/landing-prompt-master.test.ts` (skill DB vs fallback embebido).
- [x] 12.4 `back/tests/landing-mobile.test.ts` (estructura scaffold Expo / Flutter).
- [x] 12.5 `cd back && npm run typecheck && npm test` (sin romper los 100 tests). → 182 tests pass
- [x] 12.6 `cd front` build limpio + typecheck.
- [ ] 12.7 (Deuda) Playwright E2E del flujo decálogo → generación (mock).
