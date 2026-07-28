# Validación — aa-bug-wizard-atras-doble-click

Historia: como usuario creando un agente en el wizard, quiero que el botón "Atrás" funcione al primer click, no al segundo.

## Criterios de aceptación
- **AC1**: La causa raíz fue confirmada con evidencia (DevTools/replay) antes de aplicar cualquier fix — no se acepta un fix especulativo sin T0 confirmado.
- **AC2**: Pulsar "Atrás" en el paso 3 (ChannelStep, con "Plantilla del widget" visible) retrocede al paso 2 en el primer click.
- **AC3**: El comportamiento de "Atrás" en el resto de pasos del wizard (sin el bloque de plantilla) sigue funcionando igual (sin regresión).
- **AC4**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### T0 — confirmación de causa (bloqueante)
- **Given** el wizard en el paso 3 recién montado, **When** se mide con DevTools (Layout Shift/Performance) el momento del mount vs. la posición final del footer, **Then** se documenta si hay layout shift y su magnitud. _Investigación con evidencia adjunta (captura o métrica), no test automatizado._

### Fix (condicionado al resultado de T0)
- **Given** la causa confirmada es layout shift, **When** se aplica el fix (reserva de altura / estabilización del footer), **Then** el primer click en "Atrás" en el paso 3 retrocede correctamente. _Test Playwright: click único en "Atrás" justo tras montar el paso 3, verificar cambio de step._
- **Given** el fix aplicado, **When** se navega "Atrás" en otros pasos del wizard, **Then** sigue funcionando al primer click (regresión). _Test Playwright._
