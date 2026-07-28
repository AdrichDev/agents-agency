# Proposal — aa-backend-datos-switch-y-ayuda

Dos mejoras del bloque "Backend de datos del negocio" (`BusinessDataPanel`), a raíz de la
confusión del operador.

## F1 — Poder pasar de `none_yet` a BD gestionada post-creación (hueco funcional)

Hoy, desde `none_yet`, el panel SOLO ofrece el CTA "Usar API externa"
(`BusinessDataPanel.tsx:255-264`). **No hay forma de pasar a `managed_db` (nuestra BD)**
salvo elegirlo al crear el agente o regenerándolo. El PATCH `/:id/backend` acepta el switch
a `external_api` (H6) pero **no a `managed_db`** (`agents.ts`). Gap real: un agente creado
como "solo informa" no puede activar la BD gestionada.

**Cambio:**
- **Backend**: `updateBackendSchema` acepta `mode: "external_api" | "managed_db"`. El
  handler permite el switch a `managed_db` desde `none_yet`/`external_api`; sigue
  bloqueando salir de `managed_db` (400, no romper una BD ya aprovisionada). Cambiar a
  `managed_db` solo fija el modo (NO aprovisiona — eso es el botón/endpoint `provision`
  existente).
- **Front**: en la sección `none_yet`, añadir un segundo CTA **"Usar base de datos
  gestionada"** → PATCH `{mode:"managed_db"}` → recarga → aparece la UI de `managed_db`
  existente (capacidades + "Pendiente de aprovisionar" + botón Aprovisionar).

## F2 — Texto de ayuda en el formulario `external_api`

Los campos (URL base, API key, Business ID, Location ID) no explican qué son ni que
`external_api` requiere un contrato concreto. **Cambio (solo copy en el front):**
- Nota arriba del formulario: "Conecta el agente a un sistema externo (p.ej. otro CRM) que
  exponga los endpoints `/api/public/leads`, `/api/public/availability`,
  `/api/public/bookings`. No es una base de datos cruda."
- Ayudas por campo: URL base ("base del sistema del cliente; el agente le añade
  `/api/public/…`"), API key ("token Bearer que emite ese sistema"), Business ID ("qué
  negocio dentro de ese sistema, si es multi-tenant"), Location ID ("qué sede; obligatorio
  para operar reservas").

## Fuera de scope
- Reordenar los 3 conceptos (backend datos / estado pedidos / Slack handoff) — otro change.
- Switch `managed_db → otro` (bloqueado a propósito para no tirar la BD aprovisionada).

## Risks
- Bajo. F1 backend: el switch a managed_db solo fija el modo (no aprovisiona → sin coste
  hasta que el operador pulse Aprovisionar). Guard mantiene el bloqueo de salir de
  managed_db. F2: solo texto.

## Dependencies
- `back/src/routes/agents.ts` (updateBackendSchema + handler), `front/components/agents/BusinessDataPanel.tsx`.
