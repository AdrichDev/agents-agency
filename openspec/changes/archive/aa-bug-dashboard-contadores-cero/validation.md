# Validación — aa-bug-dashboard-contadores-cero

Historia: como usuario que abre el dashboard, quiero ver un indicador de carga en los contadores mientras se obtienen mis datos, para no confundir "cargando" con "tengo cero agentes".

## Criterios de aceptación
- **AC1**: Mientras `agents === null` (carga en curso), los contadores muestran un skeleton/placeholder, no "0".
- **AC2**: Cuando la carga termina y el usuario realmente tiene 0 agentes, el contador muestra "0" de forma correcta (caso real distinto del de carga).
- **AC3**: Cuando la carga termina con datos, los contadores muestran los valores correctos (sin regresión).
- **AC4**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### Fix de estado de carga
- **Given** `agents === null` justo tras montar el dashboard, **When** se renderiza, **Then** los contadores muestran skeleton, no "0". _Test Playwright: interceptar/retrasar la respuesta de agentes y verificar el estado de carga visible._
- **Given** la carga resuelve con una lista vacía, **When** termina, **Then** el contador muestra "0" real (no skeleton). _Test Playwright: mock de respuesta vacía._
- **Given** la carga resuelve con N agentes, **When** termina, **Then** el contador muestra N. _Test Playwright (regresión)._
