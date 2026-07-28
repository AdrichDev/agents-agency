# Validación — aa-deuda-p3

Regla: cada tarea OK SOLO con su verificación en verde. Refactor = no regresión.

## WU3 — rutas finas
Historia: como dev, quiero los handlers de landing/market-studies finos y la lógica en lib.
AC: mismas rutas, payloads y status; vitest 422 sigue verde; tsc limpio.
- Given las rutas de landing, When se llaman como antes, Then misma respuesta/status.
  (test: vitest existentes verdes)
- Given market-studies, When se generan/consultan estudios, Then mismo contrato.
  (test: vitest existentes verdes)
- Given el código, When tsc, Then limpio. (test: tsc)

## WU4 — front mantenibilidad
Historia: como dev, quiero páginas más pequeñas (hooks de datos) y sin `any` evitable.
AC: UI/comportamiento idénticos; tsc limpio; `next build` OK; e2e (si existe) verde.
- Given configuracion/clientes refactorizadas, When se cargan, Then renderizan y operan
  igual (sin regresión visible). (test: next build + e2e si existe + revisión)
- Given lib/api, When tsc, Then sin `any` evitable en shapes conocidos. (test: tsc)
- NOTA: sin unit tests en AA front → validación = tsc + build + e2e. El builder NO debe
  cambiar comportamiento; ante ambigüedad, parar y reportar.
