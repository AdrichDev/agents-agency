# Tasks — aa-bug-mobile-zip-deshabilitado

## Fase A — Investigación (bloqueante parcial)
- [x] A.0 Confirmar en backend `:4000` si `/api/landing/:id/mobile` existe y responde correctamente; documentar hallazgo. — **hallazgo: la hipótesis del proposal era FALSA. El endpoint existe.** `back/src/routes/landing.ts:370-403`: `POST /:id/mobile`, con `validate.body(mobileSchema)`, persistencia (`data: { mobileFiles: result.files, mobileStack: data.stack }`) y salida `{ mobileFiles, truncated }`; el 422 sólo salta si el scaffold no se genera. Tampoco hay problema de recarga: `GET /:id` (`landing.ts:139`) hace `findUnique` **sin `select`**, así que devuelve `mobileFiles` entero y el botón se rehabilita solo al volver a entrar. **No hay bloqueante backend**, así que Fase B se hace completa.
  - Por tanto el botón deshabilitado NO es un fallo: `hasMobile = Object.keys(mobileFiles).length > 0` (`MobilePanel.tsx:60`) es correcto. El fallo real es de comunicación — ver B.1.

## Fase B — Fix de feedback (front)
- [x] B.1 `MobilePanel.tsx`: explicar por qué está deshabilitado cuando `hasMobile === false`. — hecho 28/07/2026. La asimetría era visible en el código: la landing **sí** decía por qué (`{!hasLanding && <p>Genera la landing primero para descargar</p>}`) y el móvil no decía nada, así que parecía un botón muerto. Añadidos `title` en el botón y línea de ayuda (`hasLanding && !hasMobile`) para no apilar dos avisos cuando aún no hay ni landing.
- [x] B.2 `MobilePanel.tsx` (catch de `generate()`): mostrar el error en vez de fallar en silencio. — hecho. El `catch {}` descartaba la excepción y pintaba un genérico; ahora propaga el mensaje de `ApiError`, que ya trae el `error` del cuerpo (`lib/api.ts:15`), así que el 422 del backend llega al usuario.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio. — `npx tsc --noEmit` en `front/`, exit 0 (28/07/2026).
- [ ] C.2 `npm run test:e2e` verde (tests nuevos de tooltip y error visible). — **no ejecutable aquí**: Playwright necesita el front levantado y no se arranca `next dev` en la carpeta del usuario. No se escriben tests a ciegas.
- [ ] C.3 Verificación manual con backend real. — gate humano. A.0 ya confirma que el endpoint funciona.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
