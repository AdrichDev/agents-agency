# Validación — aa-bug-mobile-zip-deshabilitado

Historia: como usuario que genera una app Android/iOS quiero saber por qué el botón "Descargar mobile.zip" está deshabilitado, y si algo falló al generar, quiero ver el error en vez de un botón muerto sin explicación.

## Criterios de aceptación
- **AC1**: El endpoint `/api/landing/:id/mobile` fue verificado en T0 (existe/no existe, responde/falla) y queda documentado.
- **AC2**: El botón "Descargar mobile.zip" deshabilitado muestra un tooltip explicando la condición ("Genera la app primero").
- **AC3**: Si `generate()` falla (catch), el usuario ve un mensaje de error visible, no un fallo silencioso.
- **AC4**: Cuando `mobileFiles` se puebla correctamente (generación OK), el botón se habilita como hoy (sin regresión).
- **AC5**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### T0 — confirmación backend
- **Given** una llamada real a `POST /api/landing/:id/mobile`, **When** se ejecuta contra el backend `:4000`, **Then** se documenta si responde OK o falla (y con qué error). _Investigación, no test automatizado; adjuntar evidencia._

### Front — tooltip y feedback de error
- **Given** `hasMobile === false`, **When** el usuario pasa el cursor sobre el botón deshabilitado, **Then** ve un tooltip explicando la condición. _Test Playwright._
- **Given** `generate()` lanza error (mock de fallo de red o 500), **When** el usuario pulsa Android/iOS, **Then** ve un mensaje de error visible en la UI, no un fallo silencioso. _Test Playwright con mock de API fallando._
- **Given** `generate()` responde OK, **When** `mobileFiles` se puebla, **Then** el botón "Descargar mobile.zip" se habilita. _Test Playwright (regresión)._
