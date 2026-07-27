# Tareas — aa-catalogo-precios-fuente-unica

Orden crítico: primero el fichero de datos y el front (donde vive el canónico), después el generador
del back. Al contrario, el generador no tendría de dónde leer.

## T1 — Fuente canónica en el front

- [x] **T1.1** Crear `front/lib/service-catalog.json` con `planTokens`, `ivaRate` y los diez servicios
      con los importes exactos de la tabla congelada de `validation.md`, en ese orden. Todas las
      entradas llevan `includesPlanTokens` (también las `false`).
- [x] **T1.2** `front/components/presupuestos/types.ts` deriva `SERVICES_CATALOG`, `PLAN_TOKENS` e
      `IVA_RATE` del JSON. Quedan en el TS solo `selected`, `quantity` (10 para `hours`) y el mapeo de
      `includesPlanTokens` a `tokens`. Cero importes literales. −132/+79 líneas en el fichero.
- [x] **T1.3** `npx tsc --noEmit` verde en `front/`.
- [x] **T1.4** `front/tests/catalogo-fuente-unica.spec.ts`: 16 tests verdes — los diez importes contra
      la tabla, el orden, `PLAN_TOKENS`, `IVA_RATE`, y que en el TS no queda `implPrice:`/`maintPrice:`
      con número (E1, E2).

## T2 — Espejo generado del back

- [x] **T2.1** `back/scripts/service-catalog-codegen.ts`: `readCatalogSource()` +
      `renderCatalogModule()`. Determinista, campos en orden fijo. Valida al leer (ids duplicados,
      importes negativos, `includesPlanTokens` no booleano) y revienta en vez de generar un catálogo
      vacío.
- [x] **T2.2** `back/scripts/sync-service-catalog.ts` + script npm `catalog:sync` (una línea en
      `package.json`). Idempotente: si el espejo ya está al día no escribe.
- [x] **T2.3** Regenerado `back/src/lib/service-catalog.ts`: cabecera "FICHERO GENERADO", campo
      `tokens`, descripciones del front. La cabecera vieja decía "kept in sync manually" y apuntaba a
      `front/app/facturacion`, ruta que ya no existe.
- [x] **T2.4** `npx tsc --noEmit` verde en `back/`. Los tres consumidores de `market-study/*` siguen
      compilando sin tocarlos (el campo `tokens` es aditivo).

## T3 — Tripwires

- [x] **T3.1** `back/tests/catalogo-precios-fuente-unica.test.ts`: 12 tests verdes. **Comprobado que
      sabe fallar**: al cambiar a mano `maintPrice: 99` por `109` en el generado, dos tests en rojo
      nombrando el servicio. Restaurado y verde otra vez.
- [x] **T3.2** El test falla si no encuentra el JSON o el generado, en vez de pasar en silencio.
- [x] **T3.3** `back/tests/cupo-defecto-front-back-coherencia.test.ts` lee `planTokens` del JSON. Su
      expresión regular anterior (`export const PLAN_TOKENS = <dígitos>`) habría dejado de encontrar
      nada al volverse derivado `PLAN_TOKENS`: habría sido un rojo por la forma, no por el número.

## T4 — Verificación

- [x] **T4.1** Suite completa del back: **131 ficheros / 1465 tests verdes**, 3 skipped (venía de
      130/1452).
- [x] **T4.2** Playwright: `catalogo-fuente-unica` + `portal-tarifa-desde-catalogo` → 26/26 verdes.
      AC8 sigue en pie: el portal no gana ningún importe. **`navigation.spec.ts` NO se pudo correr**:
      9 de sus 10 tests hacen `page.goto` y necesitan servidor levantado; el único estructural pasa. No
      toca nada de este cambio (`lib/navigation.ts` no se modifica).
- [x] **T4.3** `npm run catalog:sync` dos veces seguidas: "ya al día", árbol sin ensuciar.
- [x] **T4.4** Revisión del diff + commit con rutas explícitas.
- [x] **T4.5** Resumen de scope caveman + guardado en Engram.

## Notas

- **Trampa de finales de línea.** El repo está con `core.autocrlf=true` y sin `.gitattributes`: el
  generador escribe LF y el siguiente checkout devuelve CRLF. Comparar el texto en crudo habría puesto
  el tripwire en rojo en un clon limpio sin que nadie tocara un precio. De ahí `normalizeEol` en el
  generador y en el CLI.
- **Deriva que ya existía y se corrigió:** al espejo del back le faltaba `tokens` y dos descripciones
  habían divergido (`hours` sin su "(precio por hora)", `web_basic` con distinto espaciado). Gana el
  front, que es lo que lee el cliente en `/tarifas`.
- **Nit no arreglado, a propósito:** la descripción de `crm` dice "CRM desde 2.000€" y su `implPrice` es
  2000. Son dos sitios para el mismo número, pero ahora los dos están en el mismo fichero y a la vista
  de quien edita. Cambiar texto de cara al cliente no entra en un change de estructura.
