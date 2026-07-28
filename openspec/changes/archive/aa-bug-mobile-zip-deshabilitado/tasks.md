# Tasks — aa-bug-mobile-zip-deshabilitado

## Fase A — Investigación (bloqueante parcial)
- [x] A.0 Confirmar en backend `:4000` si `/api/landing/:id/mobile` existe y responde correctamente; documentar hallazgo. — **hallazgo: la hipótesis del proposal era FALSA. El endpoint existe.** `back/src/routes/landing.ts:370-403`: `POST /:id/mobile`, con `validate.body(mobileSchema)`, persistencia (`data: { mobileFiles: result.files, mobileStack: data.stack }`) y salida `{ mobileFiles, truncated }`; el 422 sólo salta si el scaffold no se genera. Tampoco hay problema de recarga: `GET /:id` (`landing.ts:139`) hace `findUnique` **sin `select`**, así que devuelve `mobileFiles` entero y el botón se rehabilita solo al volver a entrar. **No hay bloqueante backend**, así que Fase B se hace completa.
  - Por tanto el botón deshabilitado NO es un fallo: `hasMobile = Object.keys(mobileFiles).length > 0` (`MobilePanel.tsx:60`) es correcto. El fallo real es de comunicación — ver B.1.

## Fase B — Fix de feedback (front)
- [x] B.1 `MobilePanel.tsx`: explicar por qué está deshabilitado cuando `hasMobile === false`. — hecho 28/07/2026. La asimetría era visible en el código: la landing **sí** decía por qué (`{!hasLanding && <p>Genera la landing primero para descargar</p>}`) y el móvil no decía nada, así que parecía un botón muerto. Añadidos `title` en el botón y línea de ayuda (`hasLanding && !hasMobile`) para no apilar dos avisos cuando aún no hay ni landing.
- [x] B.2 `MobilePanel.tsx` (catch de `generate()`): mostrar el error en vez de fallar en silencio. — hecho. El `catch {}` descartaba la excepción y pintaba un genérico; ahora propaga el mensaje de `ApiError`, que ya trae el `error` del cuerpo (`lib/api.ts:15`), así que el 422 del backend llega al usuario.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio. — `npx tsc --noEmit` en `front/`, exit 0 (28/07/2026).
- [x] C.2 Regresión e2e ejecutada. — el "no ejecutable aquí" era falso: `playwright.config.ts` trae bloque `webServer` y Playwright levanta el front él mismo; el riesgo del `.next` era de CONCURRENCIA, no de arrancar. Ejecutada el 28/07/2026: **91 passed, 3 failed**, y los 3 rojos son de `telegram-widget.spec.ts` (propiedad de `aa-espejo-movil-operador-telegram`, ajenos a este change).
  - **Sin test nuevo, y aquí sí es una decisión defendible**: lo que este change añade es un `title` y una línea de texto condicionada. Un e2e que compruebe que un `<p>` contiene la frase que acabamos de escribir sólo verifica que el texto sigue ahí — se rompe al reescribir la frase y no detecta ninguna regresión funcional, porque no hay lógica que regresionar. El comportamiento real (`hasMobile` habilita el botón) ya era correcto antes del change, según A.0.
- [x] C.3 **CERRADO el 28/07/2026**: el propietario pidió sondear con Playwright y continuar si no salía ningún fallo. Sonda escrita y verde.
  - `front/tests/landing-builder-mobile.spec.ts`, **3 tests verdes**: (1) sin `mobileFiles` el botón está `disabled` y el motivo se ve **en texto**, sin que se apile encima el aviso de la landing (que sí existe) y con `landing.zip` habilitado; (2) con `mobileFiles` presentes el botón se habilita solo al cargar el proyecto —confirma A.0: `GET /:id` devuelve `mobileFiles` entero, no hace falta regenerar—; (3) un **422** del backend llega al usuario con su detalle (`Failed to generate mobile scaffold`), que es exactamente lo que el `catch {}` anterior se tragaba.
  - **Rectifica el "sin test nuevo" de C.2**: aquel argumento valía para un test que sólo comprobase la frase del `<p>`; el (3) no es eso —fija que el detalle del error se propaga, que es lógica— y el (1) comprueba la condición `hasLanding && !hasMobile`, es decir que los dos avisos no se apilen. Ambos se ponen rojos si se revierte el fix.
  - Lo que sigue sin cubrirse: que un backend REAL genere el scaffold; aquí la respuesta se mockea. Eso ya lo verificó A.0 leyendo `back/src/routes/landing.ts:370-403`, y lo que este change tocó es front.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [x] Agentic Runtime **PASS** — revisión hecha el 28/07/2026.

  **Fix verificado en código**: `front/components/landing/MobilePanel.tsx` — `title` en el botón
  cuando `!hasMobile` (`:136`), línea de ayuda condicionada a `hasLanding && !hasMobile` (`:146`)
  para no apilar dos avisos cuando aún no hay ni landing, y el `catch` (`:33-39`) que ya propaga el
  detalle del error en vez de un mensaje mudo. La simetría con la landing (`:141`) queda cerrada.

  **Sobre la accesibilidad del aviso**: un `title` sobre un botón `disabled` es poco fiable — según
  el navegador no recibe foco y el tooltip no llega por teclado ni siempre por lector de pantalla.
  Aquí **no importa**, porque el motivo también se dice en texto visible en `:146`; el `title` es
  refuerzo, no el único canal. Si algún día se quita esa línea, el aviso se vuelve invisible para
  parte de los usuarios.

  **Lo importante de este change no fue el código, fue A.0**: la hipótesis del proposal era falsa —
  el endpoint existía y funcionaba. Se comprobó antes de escribir el fix, y por eso el fix acabó
  siendo de comunicación y no de backend. Ese orden es el correcto.
