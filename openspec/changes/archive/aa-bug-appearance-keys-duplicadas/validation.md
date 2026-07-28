# Validación — aa-bug-appearance-keys-duplicadas

Historia: como desarrollador quiero que la lista de presets de color secundario no dispare el warning de React por keys duplicadas, para mantener la consola limpia y evitar renders inconsistentes.

## Criterios de aceptación
- **AC1**: Al renderizar el selector de color secundario en Appearance, no aparece el warning "two children with same key" en consola.
- **AC2**: Cada `<option>` generado por `SECONDARY_PRESETS.map()` tiene una key única.
- **AC3**: El selector sigue mostrando todos los presets con su nombre y color correctos (sin regresión visual).
- **AC4**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### Fix de key
- **Given** el array `SECONDARY_PRESETS` con posible duplicado de `value`, **When** se renderiza el selector, **Then** cada `<option>` usa una key única (`p.name` u otra propiedad garantizada única). _Test Playwright: abrir Appearance, capturar consola del navegador, verificar ausencia del warning de key duplicada._
- **Given** el selector renderizado, **When** se listan las opciones, **Then** todos los presets originales siguen visibles con nombre y color correctos. _Test Playwright: snapshot de opciones del `<select>`._
