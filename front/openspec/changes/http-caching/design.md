# Design — HTTP Caching

## Decisiones de arquitectura

### ADR-1 — `setCache` (por respuesta) + `cacheControl` (middleware)
Dos formas del mismo helper. `setCache(res, opts)` se llama dentro del handler,
en la rama de éxito → evita cachear respuestas de error (un middleware fijaría la
cabecera antes de conocer el status). `cacheControl(opts)` como middleware sirve
para rutas cuyo GET siempre es 200 y estático (p. ej. `sectors`). Ambos comparten
`buildCacheControl(opts)`.

### ADR-2 — `public` solo para datos públicos
`Cache-Control: public` permite a proxies/CDN compartir la respuesta entre
usuarios → solo apto para `widget/config` (público, sin datos por-usuario).
`sectors` va tras auth → `private` (solo caché del navegador del usuario).

### ADR-3 — Apoyarse en el ETag por defecto de Express
Express genera un ETag débil para respuestas JSON. Con `Cache-Control` presente,
el navegador revalida con `If-None-Match` y recibe `304` cuando no hay cambios.
No se implementa ETag manual; se documenta el comportamiento por defecto.

### ADR-4 — `stale-while-revalidate` en widget/config
El widget tolera datos hasta ~1 min viejos. `max-age=60` + `stale-while-revalidate=300`
permite servir la versión cacheada al instante mientras se revalida en segundo
plano → percepción de rapidez sin sacrificar frescura razonable.

## Qué NO se cachea
Datos CRM mutables (clients, contacts, budgets, stats) NO llevan caché: una
mutación debe verse de inmediato. La caché se limita a lecturas estables o
públicas. Caché distribuida (Redis) y CDN quedan para el pilar 9 / deploy.

## Concerns front / back
- **Back**: `lib/cache.ts` (nuevo), `routes/ai.ts` (widget/config), `routes/sectors.ts`.
  Sin cambios de montaje en `index.ts`.
- **Front**: ninguno; el navegador aprovecha las cabeceras de forma transparente.

## Plan de rollback
Aditivo (solo cabeceras de respuesta + fichero nuevo). Rollback = revertir el
commit: desaparecen las cabeceras `Cache-Control`. Sin estado ni datos afectados.
