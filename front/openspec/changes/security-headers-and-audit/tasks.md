# Tasks — Security Headers & Supply-chain Audit

## Fase 1 — Cabeceras de seguridad (front)
- [x] 1.1 `front/next.config.mjs`: `async headers()` con X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy

## Fase 2 — Audit en CI
- [x] 2.1 `.github/workflows/ci.yml`: paso `npm audit --audit-level=high` (continue-on-error) en job back y front

## Fase 3 — Higiene de secretos
- [x] 3.1 Verificar que ningún `.env` con secretos está rastreado (solo `back/.env.example` y `front/.env.local`=URL pública)

## Fase 4 — Verificación
- [x] 4.1 `front`: `tsc --noEmit` + `next build` verdes; 4 cabeceras verificadas en vivo (`next start` + curl)
- [x] 4.2 YAML del workflow válido (js-yaml parse OK)
