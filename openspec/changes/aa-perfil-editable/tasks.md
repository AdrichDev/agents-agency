# Tasks — aa-perfil-editable (Nivel 3)

## T0 — Exploración (BLOQUEANTE)
- [x] T0.1 Determinar el sistema de auth de AA: Supabase vs propia (JWT + bcrypt en `User`). Mira `back/src/lib/auth.ts`, `routes/auth.ts`, `lib/generated/prisma/models/User.ts`.
- [x] T0.2 ¿`User` tiene `phone`? Si no → planear migración Prisma aditiva. (NO tenía phone — migración realizada)
- [x] T0.3 Cómo verificar la contraseña antigua y cómo hacer reset (emisor de email del proyecto). (Supabase: cliente efímero signInWithPassword)

## Fase A — Back: datos de perfil
- [x] A.1 (Si falta) migración aditiva `User.phone`. (schema.prisma + prisma generate + migrate-user-phone.sql)
- [x] A.2 `PATCH /api/auth/profile` autenticado: zod `{firstName,lastName?,phone?}`; actualiza el usuario de la sesión. Ignora id del body.
- [x] A.3 `GET /api/auth/me` devuelve phone.
- [x] A.4 Tests back: update OK; sin auth → 401; inválido → 422; no toca otro usuario. (11 tests — todos verdes)

## Fase B — Front: "Mi Cuenta"
- [x] B.1 Nueva ruta `app/cuenta/page.tsx` con form (nombre/apellido/teléfono, email read-only).
- [x] B.2 Entrada en `components/Sidebar.tsx` (menú/footer del usuario) → "Mi Cuenta" (también en nav via navigation.ts).
- [x] B.3 Guardar → PATCH → refresca + feedback.

## Fase C — Contraseña (con antigua) + reset
- [x] C.1 Sección contraseña (antigua/nueva/repetir) con política del proyecto (mín. 12 chars, letra + número).
- [x] C.2 Verificación de la antigua con cliente Supabase efímero signInWithPassword (server-side ONLY); si falla → 401 wrong_password.
- [x] C.3 Botón inline "No recuerdo mi contraseña" → POST /api/auth/forgot-password (nuevo endpoint, anti-enumeración). Mensaje neutro.
- [x] C.4 Tests back: antigua mala → 401; nueva débil → 422; sin letra → 422; mismatch → 422; éxito → 204; forgot-password (3 casos). (15 tests totales en profile.test.ts)

## Seguridad
- [x] S.1 Revisión cybersec del flujo de contraseña. Aprobación Ruflo 2026-06-26. Correcciones aplicadas: AuthUser.phone/lastName tipados, forgot-password inline (no link muerto), política contraseña completa (letra+número), tests completos.

## Verificación
- [x] V.4 typecheck + tests verde. (back tsc clean, vitest 444/444 pass; front tsc clean)
- [ ] V.1 Editar nombre/apellido/teléfono persiste. (requiere DB real — manual)
- [ ] V.2 Cambio de contraseña exige la antigua correcta. (requiere DB real — manual)
- [ ] V.3 "No recuerdo" envía reset. (requiere Supabase SMTP — manual)

## Tras verde: gate Ruflo antes de commit.
