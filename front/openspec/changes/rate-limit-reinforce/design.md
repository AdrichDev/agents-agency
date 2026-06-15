# Design — Rate Limit Reinforce

## Decisiones

### ADR-1 — `heavyLimiter` separado del `aiLimiter`
`aiLimiter` (20/min) cubre chat/prompt interactivos. Las operaciones de batch
(scraping de 1000 repos, generación completa de estudio) son más caras y menos
frecuentes → un limitador propio más estricto (default 10/min) evita quemar saldo
sin estorbar el chat.

### ADR-2 — Límites por entorno con helper
Un helper `num(env, default)` parsea `RATE_LIMIT_*` y cae al default si la env no
es un número válido > 0. Aplica a todos los limitadores (API, login, leads, AI,
heavy). Permite tunear en cada entorno sin tocar código.

### ADR-3 — Aplicar como middleware previo
`heavyLimiter` se monta antes del handler en cada ruta costosa. No cambia la
lógica del handler. En `market-studies` (no migrado, con tests de handler directo)
es seguro: los tests invocan el handler directo y saltan el middleware.

## Rollback
Aditivo. Rollback = revertir el commit (quitar heavyLimiter y env).
