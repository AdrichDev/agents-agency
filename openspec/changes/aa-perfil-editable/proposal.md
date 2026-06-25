# Proposal — Editar perfil de usuario (aa-perfil-editable)

**Nivel Gru: 3 — Grande.** Toca auth + datos + seguridad (contraseña). Front + back de agents-agency.

## Contexto
agents-agency **no tiene** página de cuenta/perfil (rutas actuales: dashboard, clientes, contactos, estadísticas, facturación, landing-builder, skills, tarifas, configuración). El usuario quiere editar sus datos, igual que se pide en el CRM (`crm-perfil-editable`). Back AA: `routes/auth.ts` + `lib/auth.ts` (firstName/lastName), Prisma propio (`lib/generated/prisma`).

## Intención
Página "Mi Cuenta" / perfil donde el usuario edita:
- **Nombre** (y apellido) y **teléfono**.
- **Contraseña**: requiere la **antigua** + nueva + repetir; y botón **"¿No recuerdas tu contraseña?"** (reset).

## Alcance
- **Back AA**: endpoint para actualizar `firstName/lastName/phone` del usuario logado; endurecer cambio de contraseña para exigir la antigua. Verificar/añadir campo `phone` en el modelo `User`.
- **Front AA**: nueva página/ruta "Mi Cuenta" + entrada en el sidebar/menú. Form datos + sección contraseña + enlace reset.

## Fuera de alcance
- Cambiar email. Avatar.

## Open questions (resolver en T0)
- ¿AA usa Supabase Auth o auth propia (JWT en `lib/auth.ts`)? Determina cómo verificar la antigua y el reset.
- ¿`User` de AA tiene `phone`? Si no → migración aditiva.

## Riesgos
- Cambio de contraseña sin verificar la antigua = hueco. Verificación según el sistema de auth de AA (reautenticación / hash propio con bcrypt verify). Revisión seguridad antes de habilitar.
