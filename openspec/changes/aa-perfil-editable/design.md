# Design — aa-perfil-editable

**Nivel Gru: 3.** Toca auth/seguridad. Requiere exploración del sistema de auth de AA antes de fijar el flujo de contraseña.

## 0. Hechos confirmados (tras devil's advocate 2026-06-26 — NO hay T0 bloqueante)
- **Auth = Supabase Auth.** `schema.prisma:16`: "Phase 4: passwordHash dropped (Supabase Auth owns credentials)". `routes/auth.ts:15-22`: `/login` → 410 "use Supabase SDK". `/me` verifica `verifySupabaseToken`. NO hay bcrypt (grep cero). → mismo flujo que el CRM.
- **`User.phone` ya existe** (`schema.prisma:34`, `@map telefono`). NO hay migración pendiente.
- **Contraseña = idéntico contrato server-side que CRM** (ver `crm-perfil-editable/design.md` §2): verificar antigua con cliente Supabase efímero `persistSession:false`, luego `admin.updateUserById`.
- **Único delta real de AA**: su `auth.ts` solo tiene login/logout/me — NO existe `change-password`. Hay que CREARLO, clon del endurecido del CRM.
- Front: usuario actual vía `useAuthUser()` + `api`.

## 1. Datos de perfil (nombre/apellido/teléfono)
### Back
- Endpoint `PATCH /api/profile` (o el patrón de rutas de AA) autenticado: zod `{ firstName, lastName?, phone? }`; actualiza el `User` del usuario de la sesión (nunca por id del body).
- Endpoint/me amplía con `phone` si falta.

### Front
- Página "Mi Cuenta": form precargado, guardar → PATCH → refresca.

## 2. Cambio de contraseña (con antigua)
- Según T0:
  - **bcrypt propio**: `POST /api/change-password` `{ oldPassword, newPassword }` → `bcrypt.compare` la antigua; si OK → hash + update. Nunca loguear contraseñas.
  - **Supabase**: flujo SDK (verify old con signInWithPassword + updateUser).
- Política de contraseña: alinear con la del proyecto (mín. longitud + complejidad).

## 3. "¿No recuerdas tu contraseña?"
- Dispara el reset del sistema de AA (token + email vía el emisor existente del proyecto). Mensaje neutro.

## 4. Front: dónde vive
- Nueva ruta (ej. `app/cuenta/page.tsx`) + entrada en el `Sidebar.tsx` de AA (footer/menú del usuario).

## 5. Seguridad
| Riesgo | Mitigación |
|---|---|
| Cambiar pass sin la antigua | Verificación obligatoria (bcrypt.compare o reautenticación). |
| Editar perfil ajeno | Endpoint usa el usuario de la sesión; ignora id del body. |
| Logs de contraseña | Nunca loguear old/new. |
| phone/nombre inyección | zod + escape. |

Clasificación: toca credenciales → revisión cybersec + aprobación antes de habilitar.

## 6. Plan
- T0 exploración (auth AA + phone).
- A back: PATCH perfil + /me phone + tests.
- B front: página Mi Cuenta + entrada sidebar.
- C contraseña con antigua + reset + tests.
