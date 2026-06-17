# Design — Security Headers & Supply-chain Audit

## Decisiones de arquitectura

### ADR-1 — Cabeceras vía `next.config` `headers()`
Next aplica `async headers()` a nivel de servidor para todas las rutas (`source:
"/:path*"`), sin tocar componentes ni middleware. Cabeceras elegidas:
- `X-Frame-Options: SAMEORIGIN` — anti-clickjacking permitiendo iframes propios
  (p. ej. previews del landing-builder del mismo origen). `DENY` se descarta por
  ese motivo.
- `X-Content-Type-Options: nosniff` — evita MIME sniffing.
- `Referrer-Policy: strict-origin-when-cross-origin` — no filtra rutas completas
  a terceros.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — desactiva
  APIs sensibles que la app no usa.

### ADR-2 — Sin CSP en este change
Una CSP estricta rompería el `<script>` inline de inicialización de tema en
`app/layout.tsx` y el `<script src="http://localhost:4000/widget.js">`. Hacerla
bien exige nonces/hashes → se difiere a un change propio.

### ADR-3 — `npm audit` no bloqueante en CI
Se añade un paso `npm audit --audit-level=high` a cada job con
`continue-on-error: true`. Da visibilidad (queda en el log) sin convertir CVEs
preexistentes en un check rojo (que además dispararía notificaciones de fallo,
que el usuario no quiere). Subir a bloqueante es una decisión posterior, una vez
saneadas las dependencias.

### ADR-4 — Backend ya endurecido (no se toca)
El API ya tiene helmet, CORS allowlist, SSRF guard, rate limiting y cookie
`httpOnly`+`sameSite=lax`+`secure`(prod). No se modifica para no arriesgar el
embedding cross-origin del widget (CORP/helmet).

## Concerns front / back
- **Front**: solo `next.config.mjs` (config de servidor). Sin cambios de UI.
- **CI**: `.github/workflows/ci.yml`, un paso por job. Sin cambios de runtime del back.

## Plan de rollback
Aditivo. Rollback = quitar `headers()` de `next.config` y el paso de audit del
workflow. Sin impacto en datos ni en el comportamiento funcional de la app.
