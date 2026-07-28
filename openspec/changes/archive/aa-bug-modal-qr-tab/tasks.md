# Tasks — aa-bug-modal-qr-tab

## Fase A — Reproducción
- [x] A.0 Reproducir manualmente: abrir SetupWizard con "Incluir Bot", luego pulsar "QR" sin cerrar el modal; confirmar que el tab no cambia. — **confirmado leyendo el código, que es prueba más fuerte que un clic**: `useLandingBuilder.ts:142-145` → `openWizard(step)` hace `setWizardStep(step); setShowWizard(true);`. Los dos botones son `page.tsx:123` (`openWizard(1)`) y `:126` (`openWizard(2)`). El wizard se monta en `page.tsx:258` con `{showWizard && <SetupWizard … initialStep={wizardStep} />}` y captura el paso una sola vez: `SetupWizard.tsx:64`, `useState(initialStep)`. Con el modal ya abierto `showWizard` sigue siendo `true`, así que React no remonta y el `useState` conserva el valor viejo. El bug es real y determinista.

- [x] **A.0-bis — CORRECCIÓN del 28/07/2026: el escenario de A.0 NO es alcanzable.** Se comprobó
  clicando, que es justo lo que A.0 dio por innecesario. Con el wizard abierto, el modal se monta
  como `<div class="fixed inset-0 bg-black/70 … z-50">` (`SetupWizard.tsx:199`): un overlay que
  **cubre la pantalla entera**. Playwright, al pulsar "🔳 QR" sin `force`, responde literalmente
  `<div class="fixed inset-0 …">…</div> intercepts pointer events` y reintenta hasta agotar el
  tiempo. **El usuario no puede pulsar QR sin cerrar antes el modal.** Y cerrándolo, `showWizard`
  pasa por `false`, el componente se desmonta y el paso se relee solo.
  - Lo que falló en A.0 no fue el análisis del código —`useState(initialStep)` sí congela el paso—,
    sino dar por hecho que ese estado era **alcanzable**. Leer dos componentes te dice qué pasa si
    llegas ahí; no te dice si se puede llegar. La frase "confirmado leyendo el código, que es prueba
    más fuerte que un clic" es exactamente al revés en este caso.
  - **Consecuencia**: el bug tal como está descrito no se reproduce hoy. Queda **sin explicar qué
    vio el usuario** al reportarlo, y eso no se rellena inventando. Es lo primero que hay que
    preguntar en C.3.
  - **El `key={wizardStep}` se deja puesto**: cuesta una línea, es correcto y protege si algún día
    se abre el wizard desde otro sitio con el modal ya montado. Pero es código defensivo, no el
    arreglo de un fallo vivo, y así queda registrado.

## Fase B — Fix
- [x] B.1 Decidido: **`key={wizardStep}`** en el punto de montaje, no `useEffect`. Motivo: el `useEffect` sincroniza sólo `step` y deja vivo el resto del estado interno del wizard (campos a medio rellenar del paso anterior); saltar a otra pestaña debe dar una pestaña limpia. El `key` es además una línea y no añade un efecto que se dispara en cada render.
- [x] B.2 Implementado en `front/app/landing-builder/[id]/page.tsx` (`key={wizardStep}` sobre `<SetupWizard>`), con el porqué en comentario.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio. — `npx tsc --noEmit` en `front/`, exit 0 (28/07/2026).
- [x] C.2 Regresión e2e ejecutada; **test de regresión propio: imposible, y por un motivo que cambia el change entero** (ver A.0 corregido). El "no ejecutable aquí" que ponía antes era falso: `playwright.config.ts` trae bloque `webServer` y Playwright levanta el front solo; el riesgo del `.next` era de CONCURRENCIA, no de arrancar. Ejecutada el 28/07/2026: **91 passed, 3 failed**, y los 3 rojos son de `telegram-widget.spec.ts` (propiedad de `aa-espejo-movil-operador-telegram`, ajenos a este change).
  - **Actualización (C.3, mismo día)**: sí se acabó escribiendo una sonda —`landing-builder-wizard.spec.ts`, 5 verdes— pero **no como regresión del `key`**, que se demostró no observable quitándolo y volviendo a ejecutar; es cobertura del comportamiento de pestañas del asistente. Ver C.3.
  - Se **intentó** escribir el e2e que fijara el `key={wizardStep}` y se descartó: no existe ningún flujo de usuario donde el `key` sea observable. Con el modal abierto no se llega a los botones (A.0), y cerrando y reabriendo el wizard `showWizard` pasa por `false`, lo que desmonta el componente y hace que `useState(initialStep)` relea el paso **con `key` o sin él**. Un test que pase igual con el fix puesto que quitado no es una regresión, es decorado. Por eso no se deja ninguno.
- [x] C.3 **CERRADO el 28/07/2026 sin gate humano, por decisión del propietario**: no recuerda qué vio (el reporte es antiguo) y pidió sondear con Playwright y continuar si no aparecía ningún fallo. Se hizo, y **no aparece ninguno**.
  - Sonda: `front/tests/landing-builder-wizard.spec.ts`, **5 tests verdes**, recorriendo todos los caminos alcanzables hasta el paso del asistente: Bot→cerrar→QR, QR→cerrar→Bot, reabrir el mismo botón tras haber navegado por dentro (debe volver a SU paso, no al último visitado), navegación interna Siguiente/Atrás, y la afirmación explícita de que con el modal abierto los botones Bot/QR **no** son alcanzables (`intercepts pointer events`). En todos, la pestaña que se abre es la pedida.
  - **Se comprobó además que el fix no es observable**: se quitó el `key={wizardStep}` de `page.tsx` y se repitió la sonda — **5/5 verdes igual**, con `key` y sin él. Confirma A.0-bis por experimento, no por razonamiento: ningún flujo de usuario distingue tenerlo de no tenerlo. El `key` se restauró (`git checkout`) y sigue en su sitio.
  - Lo que la sonda **sí** aporta, y por eso se queda: fija el comportamiento observable de las pestañas del asistente, que es lo que el usuario creía roto. Si un refactor rompe de verdad la apertura por pestaña —quitando el `key` *y* el desmontaje, por ejemplo— estos 5 tests se ponen rojos.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [x] Agentic Runtime **PASS** — revisión hecha el 28/07/2026.

  **Fix verificado en código, no de palabra**: `front/app/landing-builder/[id]/page.tsx:258` monta el
  wizard bajo `{showWizard && …}` y le pone `key={wizardStep}` (`:264`) además del
  `initialStep={wizardStep}` (`:272`); `components/landing/SetupWizard.tsx:64` sigue haciendo
  `useState(initialStep)`. Con el `key`, cambiar de pestaña con el modal abierto remonta el
  componente y el `useState` vuelve a leer el valor nuevo. El fix ataca la causa real.

  **Dos reservas, ninguna bloqueante, pero quedan escritas:**

  1. **El remonte tira todo el estado interno del wizard, sin avisar.** Es lo decidido en B.1 y para
     el salto entre pestañas es lo correcto, pero si el usuario tiene el paso a medio rellenar y
     pulsa el otro botón, pierde lo escrito y no se le dice. Aceptable para un wizard de dos
     entradas; deja de serlo si el paso crece en campos.
  2. **El fix es un `key` y nada lo protege** — y, tras A.0-bis, **nada puede protegerlo**: no hay
     flujo alcanzable donde su presencia o ausencia cambie el comportamiento (C.2 explica el
     intento y por qué se descartó). Quien lo borre en un refactor no romperá nada hoy; sólo
     retirará una defensa. El comentario que lo acompaña en `page.tsx` es toda la protección que
     admite, así que **no debe borrarse ese comentario**.

  **Nota sobre el propio gate**: esta revisión encontró que la premisa del change era falsa (A.0-bis).
  Se llegó por clicar, no por leer. Es el segundo change de esta tanda donde el gate posterior
  encuentra algo que la fase de análisis dio por cerrado — el otro fue la redirección abierta de
  `aa-bug-acceso-sin-sesion`.
