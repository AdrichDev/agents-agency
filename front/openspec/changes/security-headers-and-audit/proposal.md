# Propuesta — Security Headers & Supply-chain Audit

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 6 (seguridad)

## Intención

Pilar 6: reducir superficie de vulnerabilidad. El **backend** ya tiene una postura
razonable (helmet, CORS allowlist, SSRF guard, rate limiting, cookie de sesión
`httpOnly`+`sameSite=lax`+`secure` en prod). Dos huecos:

1. **El frontend (Next.js) no envía cabeceras de seguridad.** Las respuestas del
   dashboard salen sin `X-Frame-Options`, `X-Content-Type-Options`,
   `Referrer-Policy` ni `Permissions-Policy`.
2. **Sin visibilidad de vulnerabilidades en dependencias** (supply-chain): nada
   avisa si una dependencia tiene un CVE conocido.

Se añade:

1. **Cabeceras de seguridad en Next** vía `next.config` `headers()`:
   `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
2. **Auditoría de dependencias en CI** (`npm audit`) en back y front, **no
   bloqueante** (`continue-on-error`) → da visibilidad sin romper el pipeline ni
   generar notificaciones de fallo.

Además se confirma la **higiene de secretos**: ningún `.env` con secretos está
rastreado (`front/.env.local` solo contiene `NEXT_PUBLIC_API_URL`, una URL pública).

**Éxito**: el dashboard responde con cabeceras de seguridad; CI reporta CVEs de
dependencias sin bloquear; sin secretos en el repo.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| CSP estricta en el front | Rompe el script inline de tema y el widget cross-origin; requiere nonces (cambio propio) |
| Hardening de cuenta cloud / WAF | No hay deploy en prod todavía |
| Auditoría bloqueante en CI | Generaría rojos/notificaciones por CVEs preexistentes; se deja informativa |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `front/next.config.mjs` | Modificado | `async headers()` con cabeceras de seguridad |
| `.github/workflows/ci.yml` | Modificado | Paso `npm audit` (no bloqueante) en back y front |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| `X-Frame-Options: DENY` rompe previews embebidos | Media | Se usa `SAMEORIGIN` (permite iframes del mismo origen) |
| `npm audit` rojo bloquea merges | Media | `continue-on-error: true` → informativo, no gate |
| CSP rompe la app | — | No se añade CSP en este change (diferida) |

## Criterios de éxito

- [x] `next build` aplica las cabeceras de seguridad a todas las rutas (4 verificadas en vivo).
- [x] CI ejecuta `npm audit` en back y front sin bloquear el pipeline (`continue-on-error`).
- [x] Confirmado: ningún `.env` con secretos rastreado.
- [x] `next build` (front) y YAML del workflow válidos.
