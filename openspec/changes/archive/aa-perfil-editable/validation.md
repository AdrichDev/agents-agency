# Validación — aa-perfil-editable

Historia: como usuario de agents-agency quiero editar mi nombre, apellido y teléfono, y cambiar mi contraseña (con la antigua, o pidiendo reset), sin poder tocar datos de otro usuario.

## Criterios de aceptación
- **AC1**: Existe una página "Mi Cuenta" accesible desde el sidebar.
- **AC2**: Puedo editar nombre/apellido/teléfono; persiste y recarga correcto.
- **AC3**: Cambiar la contraseña exige la **antigua** correcta; si es incorrecta, no cambia.
- **AC4**: Hay "¿No recuerdas tu contraseña?" que dispara el reset (mensaje neutro).
- **AC5**: La nueva contraseña respeta la política del proyecto.
- **AC6**: El endpoint de perfil solo afecta a MI usuario; ignora ids del body. Sin logs de contraseñas.
- **AC7**: typecheck + tests verde.

## Por tarea (Given-When-Then)
### A.2 — PATCH perfil
- **Given** sesión válida, **When** PATCH `{firstName,phone}`, **Then** 200 + User actualizado. _Test._
- **Given** sin auth, **When** PATCH, **Then** 401. _Test._
- **Given** id de otro en el body, **When** PATCH, **Then** se ignora. _Test._

### C.2 — contraseña
- **Given** antigua incorrecta, **When** cambio, **Then** error, no cambia. _Test._
- **Given** antigua correcta + nueva válida, **When** cambio, **Then** login con la nueva funciona. _Integración._
- **Given** nueva débil, **When** cambio, **Then** rechazo por política. _Test._

### B — front
- **Given** usuario logado, **When** abre "Mi Cuenta" desde el sidebar, **Then** ve sus datos precargados. _Manual._
