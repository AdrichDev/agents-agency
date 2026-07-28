# Tasks — aa-deuda-p3-fase2

> **Esta change no tenía `tasks.md`.** Se escribe el 28/07/2026 recogiendo el estado REAL,
> medido contra el código, no contra el proposal. Hallazgo principal: **el frente #6 ya
> estaba hecho y nadie lo apuntó.**

## #6 — front: páginas mantenibles

- [x] **HECHO antes de esta sesión, sin registrar.** Los cinco ficheros del proposal encogieron,
  y no por casualidad: está exactamente el patrón que pedía la propuesta (hooks + subcomponentes).

  | fichero | proposal | hoy | |
  |---|---|---|---|
  | `app/landing-builder/[id]/page.tsx` | 480 | 287 | −40% |
  | `app/contactos/page.tsx` | 440 | 199 | −55% |
  | `components/AutomationsPanel.tsx` | 430 | 115 | −73% |
  | `app/skills/page.tsx` | 428 | 198 | −54% |
  | `app/agents/[id]/page.tsx` | 357 | 242 | −32% |

  El LOC por sí solo no prueba nada (un fichero puede encoger por borrar cosas), así que se
  comprobó a dónde fue el código:
  - **Hooks**: `front/hooks/useResource.ts` —el patrón que nombraba el proposal— más
    `useLandingBuilder`, `useContactos`, `useAutomations`, `useSkillsMarketplace` y
    `useAgentDetail`. Uno por página de la lista.
  - **Subcomponentes**: `components/contactos/{ContactRow,ContactFormModal,ContactInfoModal,ConvertConfirmModal}.tsx`,
    `components/automations/{AutomationItem,AutomationForm,AutomationImportForm}.tsx`,
    `components/skills/SkillCard.tsx`.

## #7 — back: rutas finas restantes

- [x] **`routes/agents.ts`** — hecho 28/07/2026. **Ojo, el diagnóstico del proposal estaba
  desfasado**: decía 358 LOC, pero el fichero había CRECIDO a 570 mientras la change dormía.
  - La mayor parte ya delegaba en `lib/` (lifecycle, oauth, telegram-pairing, webhook-shared).
    El bulto real era un solo handler: `PATCH /:id/backend`, 84 líneas con tres cosas mezcladas
    —reglas de cambio de modo, validación de capabilities y dos merges de campos JSON.
  - Extraído a **`lib/agent/backend-config.ts`** (lógica pura, sin red ni BD): el handler queda
    en 13 líneas. `agents.ts` 570 → 512.
  - Refactor SIN cambio de comportamiento, como exigía el proposal: mismos mensajes, mismos
    códigos, misma forma del payload. De paso, el `as any` sobre `dbSchema` pasa a un
    `Prisma.InputJsonValue` acotado.
  - **Verificado con la red de seguridad que pedía el proposal**: `tests/agent-backend-panel.test.ts`
    cubre este endpoint (11 casos). Suite entera verde: **146 ficheros, 1726 tests, 3 skipped**,
    el mismo número que antes de tocar nada. `tsc --noEmit` exit 0.
- [x] **`routes/contacts.ts`** — **revisado handler por handler el 28/07/2026: NO necesita refactor.**
  Creció 272 → 294 LOC, pero no por lógica inline. Ya cumple el patrón que pide el proposal:
  - Funciones puras extraídas y exportadas en el propio fichero: `defaultContactado` (:34),
    `buildContactsWhere` (:60), `contactedAtPatch` (:74). Testeables sin montar un router.
  - Handlers exportados uno a uno (`listContactsHandler`… `deleteContactHandler`), rutas al final.
  - Lo pesado ya vive fuera: `lib/convert-to-tenant.ts` (atomicidad + ventana TOCTOU) y
    `lib/codes.ts` (`nextContactCode`, `nextClientCode`, `withCodeRetry`).
  - El handler más largo, `convertToClientsHandler` (~70 líneas), es bucle best-effort + mapeo de
    errores a respuesta HTTP. Eso ES trabajo de ruta; sacarlo sería mover código, no adelgazar.

  El crecimiento son comentarios y los filtros `deletedAt: null` del soft delete. **Refactorizarlo
  sería churn**, así que se cierra sin tocar código: mejor eso que un diff que no arregla nada.
- [x] `booking`/`automations` — OPCIONALES en el proposal ("solo si hay lógica claramente inline").
  **Ya no la tienen**: `booking.ts` importa `lib/booking/{appointments,sync}` y su propio comentario
  de cabecera dice que mapea los errores de dominio "con el mismo status/mensaje que exponía antes
  la logica inline del router"; o sea la extracción ya se hizo. `automations.ts` importa
  `lib/automations/{engine,import}` y `lib/n8n/{client,workflow-builder}`. Nada que extraer.

## Verificación
- [x] `back`: `tsc --noEmit` exit 0 y `vitest run` 1726 verdes (28/07/2026).
- [ ] `front`: `next build`. **No se ejecuta aquí** — no se arranca el build de Next en la carpeta
  del usuario (corrompe `.next` si hay otra instancia). El `tsc --noEmit` del front sí está verde,
  pero no sustituye al build.

## Estado (28/07/2026)

**Trabajo: terminado. Change: ACTIVA por una sola casilla**, la de arriba.

Los dos frentes están cerrados: #6 estaba hecho de antes y ahora consta con evidencia; #7 cierra con
un refactor real (`agents.ts`) y con dos "no procede" argumentados (`contacts.ts`, `booking`/`automations`)
— que no es lo mismo que dejarlos sin mirar, que es como estaban esta mañana.

Lo único que falta es un `next build` del front, y no se corre aquí por la norma de no arrancar Next
en la carpeta del usuario. Se archiva en cuanto alguien lo pase en un entorno donde sí se pueda.
