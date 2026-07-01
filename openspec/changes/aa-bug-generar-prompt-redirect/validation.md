# Validación — aa-bug-generar-prompt-redirect

Historia: como usuario con sesión activa en Landing Builder quiero pulsar "Generar prompt" sin que la app me tire a "/" sin sesión, y si mi sesión de verdad expiró, quiero un aviso claro en vez de perder mi contexto en silencio.

## Criterios de aceptación
- **AC1**: Con sesión válida, pulsar "Generar prompt" completa la petición `POST /api/landing/:id/prompts` sin disparar `signOut` ni redirect.
- **AC2**: Si la sesión expiró de verdad, el usuario ve un aviso ("sesión expirada") en vez de un hard-redirect silencioso a "/".
- **AC3**: Tras reautenticar (si aplica el patrón `returnTo`), el usuario vuelve al Landing Builder donde estaba, no al homepage genérico.
- **AC4**: El interceptor 401 de `lib/api.ts` sigue protegiendo el resto de la app (no se elimina el manejo de 401, se refina).
- **AC5**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### T0 — investigación backend
- **Given** sesión supuestamente válida, **When** se llama `POST /api/landing/:id/prompts`, **Then** se documenta la causa real del 401 (log/reproducción). _Investigación, no test automatizado; adjuntar evidencia (request/response) en el reporte de T0._

### Front — interceptor `lib/api.ts:64-73`
- **Given** un 401 real de sesión expirada, **When** el interceptor lo captura, **Then** muestra aviso y preserva la ruta actual (no `window.location.href="/"` ciego). _Test Playwright: simular 401 y verificar aviso + URL preservada._
- **Given** sesión válida y token fresco, **When** se genera un prompt, **Then** no hay `signOut` ni navegación. _Test Playwright: flujo completo "Generar prompt" con sesión mockeada válida._
- **Given** el usuario reautentica tras el aviso, **When** vuelve, **Then** aterriza en `/landing-builder/{id}` con la pestaña Prompts, no en "/". _Test Playwright, dependiente del patrón `returnTo` de `aa-bug-acceso-sin-sesion`._

### Manual
- **Given** entorno real con backend `:4000` corriendo, **When** se reproduce el flujo íntegro, **Then** se confirma visualmente el fix. _Manual, con Playwright MCP o navegador._
