# Validación — aa-bug-modal-qr-tab

Historia: como usuario que tiene el modal SetupWizard abierto en un tab (p.ej. "Incluir Bot") y pulso "QR", quiero que el modal cambie al tab QR sin tener que cerrarlo y reabrirlo.

## Criterios de aceptación
- **AC1**: Con el modal ya abierto en un step, pulsar la acción que abre otro step (p.ej. "QR") cambia el tab mostrado de inmediato.
- **AC2**: El comportamiento de abrir el modal desde cerrado (primer open) sigue funcionando igual (sin regresión).
- **AC3**: Navegar con "Siguiente" dentro del wizard sigue funcionando igual (sin regresión).
- **AC4**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### Fix de resync de step
- **Given** el modal `SetupWizard` abierto en el step "Incluir Bot", **When** se pulsa la acción "QR" (`openWizard` con step distinto), **Then** el modal muestra el tab QR sin necesidad de cerrar/reabrir. _Test Playwright: abrir con un step, disparar cambio a otro step, verificar contenido visible del tab correcto._
- **Given** el modal cerrado, **When** se abre por primera vez con un `initialStep` dado, **Then** muestra ese step correctamente (regresión). _Test Playwright._
- **Given** el modal abierto en un step, **When** se pulsa "Siguiente", **Then** avanza al step siguiente normalmente (regresión). _Test Playwright._
