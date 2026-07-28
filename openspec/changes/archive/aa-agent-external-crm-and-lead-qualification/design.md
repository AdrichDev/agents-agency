# Design — aa-agent-external-crm-and-lead-qualification

## §A. Enfoque técnico

Dos bloques independientes que comparten el mismo agente:

- **F1** implementa una segunda variante del contrato `AgentBackendAdapter` ya
  definido (`agent-backend/types.ts:87-94`), esta vez sobre HTTP. No se toca el
  contrato ni el executor: se añade una implementación y se enchufa en el
  resolver. El agente no sabe si habla con `managed_db` o `external_api` — las
  tools son las mismas (`consultar_disponibilidad`, `crear_reserva`,
  `guardar_lead`).
- **F2** añade un campo aditivo al `Lead`, una tool nueva `calificar_lead` y una
  rúbrica en el system prompt. No depende de F1: funciona con `managed_db` o
  `external_api` indistintamente.

Principio rector: **extender, no sustituir.** El adapter `managed_db`, el
contrato, el dispatcher de avisos y el loop del agente quedan intactos.

## §B. F1 — Adapter `external_api`

### B.1 Fichero y firma

`back/src/lib/agent-backend/external-api.ts`:

```ts
export interface ExternalApiConfig {
  apiBaseUrl: string;       // AgentDataBackend.apiBaseUrl
  apiKey?: string;          // decryptToken(apiKeyEncrypted) — Bearer opcional
  businessId: string;       // dbSchema.businessId (v1) — cuid del negocio en el CRM
  locationId?: string;      // dbSchema.locationId — REQUERIDO si capability `reservas` (el CRM lo exige en availability/bookings)
  capabilities: BackendCapability[];
  fetchImpl?: typeof fetch; // inyectable para test
}

export class ExternalApiAdapter implements AgentBackendAdapter {
  constructor(private cfg: ExternalApiConfig) {}
  // 6 métodos del contrato
}
```

**Nota de config**: `reservas` sin `locationId` → el adapter rechaza al construir
(o al primer método de reservas) con error claro. `businessId`+`locationId`
viven en `AgentDataBackend.dbSchema` JSON en v1 (`{ businessId, locationId }`).

### B.2 Mapeo método → endpoint (lane público del CRM)

Shapes exactos ya verificados en T1.1 (leídos de `creador_CRM/back/src/routes/public/{leads,bookings,availability}.ts`):

| Método | HTTP | Endpoint CRM | Request → Response |
|---|---|---|---|
| `guardarLead(contacto, intencion)` | POST | `/api/public/leads` | body `{businessId, nombre, email?, telefono?, peticion: intencion}` → `201 {id, message}`. Adapter → `LeadGuardado{id: resp.id, creadoEn: new Date().toISOString()}` |
| `consultarDisponibilidad(servicio, rango)` | GET | `/api/public/availability` | **1 día por request**: iterar `rango.desde..rango.hasta`, por cada día `query {businessId, date:"YYYY-MM-DD", serviceId: servicio, locationId}` → array de slots → concatenar y mapear a `Slot[]{startTime,endTime}` (leer shape real de `daySlotsWithAvailability`) |
| `crearReserva(servicio, slot, contacto)` | POST | `/api/public/bookings` | body `{businessId, locationId, serviceId: servicio, start: slot.startTime (ISO), notes: contacto.notas, customer:{nombre, email?, telefono?}}` → `201 {id, message}` (409 conflicto). Adapter → `Reserva{id, servicioId: servicio, servicioNombre: servicio, startTime: slot.startTime, endTime: slot.endTime, estado:"PENDING"}` |
| `cancelarReserva(id)` | — | — | v1 NO soportado → lanza error honesto (el CRM público no expone cancel) |
| `consultarPedido(orderId)` | — | — | v1 NO soportado (capability `pedidos` no habilitable en external_api) → `EstadoPedido{encontrado:false, codigo:orderId}` |
| `notificar(evento, payload)` | — | — | delega en `notify-dispatcher.ts` (AA-side, telegram), best-effort, NUNCA lanza |

Notas de mapeo:
- El CRM valida `422` (zod) / `404` (negocio o location) / `409` (conflicto de
  reserva). El adapter traduce no-2xx a error de tool honesto (salvo `notificar`).
- `bookings` exige `locationId` y `start` (1 ISO); el CRM calcula `endAt` por
  duración del servicio. `availability` exige `date` (YYYY-MM-DD) + `locationId`.
- El businessId/locationId/datos viajan en query o body — nunca en el path.

### B.3 Reglas

- **Capability antes de operar**: cada método verifica que su capability
  (`leads`/`reservas`) esté en `cfg.capabilities`; si no, rechaza (invariante
  `types.ts:80-82`).
- **Input como dato**: `businessId`/`serviceId`/datos de contacto viajan en
  query o body; nunca se concatenan en el path. URL base validada (https / host
  esperado).
- **Bearer opcional**: si `cfg.apiKey` presente → header
  `Authorization: Bearer <key>`. El lane público hoy no lo exige; se envía para
  forward-compat cuando el CRM gatee.
- **Timeout + best-effort**: `fetch` con `AbortController` (timeout duro,
  patrón `notify-dispatcher.ts:152`). Errores de red → error de tool honesto
  (el LLM lo comunica), salvo `notificar` que traga.
- **Sin reintento de escrituras no idempotentes** salvo timeout confirmado.

### B.4 Wire-in (3 puntos)

1. `resolveAgentBackendAdapter` (`managed-db.ts` §resolver): antes del
   `return null`, añadir
   ```ts
   if (backend.mode === "external_api") {
     const businessId = (backend.dbSchema as any)?.businessId;
     const apiKey = backend.apiKeyEncrypted ? decryptToken(backend.apiKeyEncrypted) : undefined;
     return new ExternalApiAdapter({ apiBaseUrl: backend.apiBaseUrl!, apiKey, businessId, capabilities: backend.capabilities as BackendCapability[] });
   }
   ```
   (Alternativa: mover el resolver a `agent-backend/resolver.ts` neutral; v1 se
   añade la rama en el sitio actual para minimizar el diff.)
2. `CreateAgentDataBackendInput` + `createAgent` (`service.ts`): aceptar
   `mode="external_api"` con `apiBaseUrl` (requerido) + `businessId` (requerido)
   + `apiKey` (opcional, se cifra al persistir). Validación: `managed_db` exige
   `dbUrl`; `external_api` exige `apiBaseUrl` + `businessId`.
3. `enabledBackendCapabilities` (`engine.ts:82`): cambiar el gate
   `mode === "managed_db"` por `mode === "managed_db" || mode === "external_api"`
   para que las tools se monten también en external_api.

### B.5 Flujo de datos

```
LLM (WhatsApp) → runToolLoop → executeTool("guardar_lead", args)
  → withBackendAdapter(agentId) → resolveAgentBackendAdapter
      mode=external_api → ExternalApiAdapter.guardarLead
        → POST creador_CRM /api/public/leads {businessId, ...}
        → Contacto creado en CRM (schema crm)
      ← LeadGuardado
  ← el LLM confirma al usuario
```

## §C. F2 — Calificación de lead

### C.1 Migración (aditiva)

`Lead` (`schema.prisma:390`):
```prisma
qualification       String  @default("unknown") @map("calificacion")        // hot | warm | cold | unknown
qualificationReason String? @map("motivo_calificacion")
```
SQL aditivo (patrón `agent-data-backend`), sin DROP, validado en BD local
desechable.

### C.2 Tool `calificar_lead`

- Declarada en `BACKEND_TOOLS_BY_CAPABILITY["leads"]` (`engine.ts:148-155`)
  junto a `guardar_lead`.
- Params: `{ qualification: "hot"|"warm"|"cold", reason: string }`.
- Handler (`executor.ts`): resuelve el `Lead` por `conversationId` de la
  conversación en curso y hace `prisma.lead.update` con `qualification` +
  `qualificationReason`. Si no hay lead aún → lo crea/upsert (coherente con el
  path `guardar_lead`).
- Best-effort en el aviso: si `qualification === "hot"` → dispara
  `dispatchNotification(agentId, "nuevo_lead", { ...lead, qualification:"hot" })`
  (`notify-dispatcher.ts`), sin bloquear ni lanzar.

### C.3 Rúbrica en el prompt

En `buildSystemPrompt` (`engine.ts`), cuando `leads` está habilitado, añadir un
bloque de criterio (v1 por defecto):
- **HOT**: pide precio/disponibilidad, acepta cita o llamada, expresa urgencia o
  intención de compra clara.
- **WARM**: interesado pero sin fecha/decisión; "me lo pienso", pide info.
- **COLD**: no encaja (fuera de zona/servicio), "solo miraba", rechaza contacto.
Instrucción: llamar `calificar_lead` cuando haya señal suficiente, con `reason`
citando la evidencia de la conversación. Las reglas de sistema
(honestidad/handoff) preceden y prevalecen.

## §D. Estrategia de test

- **F1 adapter (unit, sin red)**: `fetchImpl` inyectado (mock) → asserts de
  método→endpoint→shape, gate de capability, Bearer presente/ausente, input no
  interpolado en URL, timeout → error honesto, `notificar` no lanza. Patrón
  `node:test` del repo (no vitest).
- **F1 wire-in (unit)**: `resolveAgentBackendAdapter` devuelve `ExternalApiAdapter`
  con `mode=external_api`; `createAgent` acepta/valida el modo y cifra `apiKey`;
  `enabledBackendCapabilities` monta tools en external_api. Regresión:
  `managed_db` y `none_yet` sin cambios de comportamiento.
- **F2 (unit)**: migración aditiva en BD local desechable
  (`agent-data-backend.migration.test.ts` como patrón); `calificar_lead`
  actualiza el Lead por `conversationId`; hot dispara `notificar` (spy),
  warm/cold no; `buildSystemPrompt` incluye la rúbrica solo con `leads`
  habilitado (función pura).
- **Regresión cero**: un agente `managed_db` o sin backend produce las mismas
  tools y prompt que antes (asserts puros).
- **E2E local (opcional, `.env.test` → Supabase `_test_crm`)**: agente
  `external_api` apuntando a un `creador_CRM` local crea un lead real y lo
  califica. Aislado de prod por diseño.

Regla del repo: tarea DONE solo con su test verde; sin spec, cambios revertidos.
