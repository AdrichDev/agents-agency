# Design — Content Security Policy (Report-Only)

## Decisiones

### ADR-1 — Report-Only como primer paso seguro
`Content-Security-Policy-Report-Only` evalúa la política y reporta violaciones
sin bloquear. Es el patrón recomendado para introducir CSP en una app existente
sin riesgo de romperla. Se añade vía `next.config` `headers()` (estático, sin
middleware ni nonces), junto a las cabeceras de seguridad ya existentes.

### ADR-2 — Política inicial pragmática
`default-src 'self'` + `frame-ancestors 'none'` + `object-src 'none'` +
`base-uri 'self'` cubren los vectores principales. Se permite `'unsafe-inline'`
en script/style (el tema inline y los estilos de React/Next) y el host del widget
`http://localhost:4000` en `script-src`/`connect-src`. `img-src` admite `data:`
(avatares base64) y `blob:`/`https:`.

### ADR-3 — Enforcing + nonces como follow-up
Pasar a enforcing exige nonces por request (middleware) para eliminar
`'unsafe-inline'`, y verificación en navegador (consola sin violaciones). Se deja
documentado como change posterior; este change entrega la visibilidad sin riesgo.

## Rollback
Aditivo (una cabecera). Rollback = quitar la entrada de `headers()`.
