# Proposal — aa-agent-external-crm-and-lead-qualification

## Intent

Cablear las dos únicas piezas que faltan para que un agente de producto de AA
(canal WhatsApp/Telegram, motor y memoria ya construidos) trabaje un lead de
punta a punta contra un **CRM externo** (`creador_CRM`) y lo **califique**:

1. **F1 — Backend `external_api`.** Hoy `AgentDataBackend` soporta el modo
   `managed_db` (Postgres aprovisionado por agente); el modo `external_api`
   (HTTP + Bearer contra `apiBaseUrl`) quedó como backlog en
   `aa-agent-backend-foundation` (`agent-backend/types.ts:9`,
   `managed-db.ts` `resolveAgentBackendAdapter` → `null` para `external_api`,
   `service.ts` `createAgent` rechaza el modo, `enabledBackendCapabilities`
   `engine.ts:82` gatea solo `managed_db`). Este cambio implementa el adapter
   HTTP para que el agente lea/escriba en el `creador_CRM` real (crear lead,
   consultar disponibilidad, crear reserva) sin aprovisionar una BD paralela.

2. **F2 — Calificación de lead.** Hoy `Lead.status` (`schema.prisma:400`) solo
   toma `new`/`handoff`, sin scoring. El agente clasifica cada lead
   **hot/warm/cold** según una rúbrica explícita del prompt, lo persiste, y en
   **hot** avisa al dueño ("contacto que atender") vía el dispatcher ya
   construido (`notify-dispatcher.ts:113`).

Visión de fondo (usuario): sistemas agénticos autónomos ya cableados
(instalación + ejecución + datos) donde lo único que se enchufa al final es el
modelo LLM. Este cambio cablea la capa **datos externos + calificación** de esa
visión, y desbloquea el caso 3A: lead entra por landing → se carga en el CRM →
el agente conversa por WhatsApp → califica → agenda o deja en seguimiento →
avisa al dueño.

## Caso de referencia (3A Estudio, single-tenant)

Lead deja mail+tel en la landing → `guardar_lead` crea `Contacto` en
`creador_CRM` → el agente conversa (memoria por teléfono, ya construida) →
pregunta preferencia de contacto/cita → `consultar_disponibilidad` +
`crear_reserva` contra el CRM si acepta → `calificar_lead` (hot/warm/cold) →
si hot, avisa al dueño. Todo con `runtime` y canal WhatsApp existentes.

## Problemas que resuelve

1. **El agente no puede tocar el CRM real.** `resolveAgentBackendAdapter`
   devuelve `null` salvo `managed_db` (`managed-db.ts` §resolver). Un agente
   configurado con `mode="external_api"` no monta ninguna tool de datos: no
   crea leads, no consulta huecos, no reserva. El `creador_CRM` queda
   inalcanzable para el agente.
2. **`createAgent` rechaza el modo.** `CreateAgentDataBackendInput` (`service.ts`)
   solo acepta `managed_db | none_yet`; no hay forma de dar de alta un agente
   apuntando a un CRM externo.
3. **Sin calificación.** El agente captura leads pero no distingue interesado de
   no interesado. `Lead.status` no expresa temperatura; el dueño no sabe a quién
   atender primero. La rúbrica de "hot lead" es una decisión de negocio que hoy
   no existe en código.

## Scope

### Sí — F1: backend `external_api` (HTTP + Bearer)

- **Adapter nuevo** `back/src/lib/agent-backend/external-api.ts`:
  `ExternalApiAdapter implements AgentBackendAdapter` (mismo contrato de 6
  métodos que `managed-db.ts`). Config desde `AgentDataBackend`:
  `apiBaseUrl` + `decryptToken(apiKeyEncrypted)` (Bearer opcional) +
  `businessId` (identidad del negocio en el CRM; v1 en `dbSchema` JSON
  `{ businessId }`).
- **Mapeo método → endpoint público del CRM** (lane `/api/public/*`,
  sin auth, `businessId` en el cuerpo — verificado en el mapa del CRM):
  - `guardarLead` → `POST {apiBaseUrl}/api/public/leads`
  - `consultarDisponibilidad` → `GET {apiBaseUrl}/api/public/availability`
  - `crearReserva` → `POST {apiBaseUrl}/api/public/bookings`
- **Wire-in**: rama `external_api` en `resolveAgentBackendAdapter`; alta del modo
  en `createAgent`/`CreateAgentDataBackendInput` (cifra `apiKey` al escribir,
  patrón `enc:v1:` de `oauth.ts`); ampliar `enabledBackendCapabilities`
  (`engine.ts:82`) para incluir `external_api`.
- **Capabilities v1 para `external_api`**: `reservas`, `leads`. `pedidos`
  queda fuera (el CRM público no expone pedidos).
- Invariantes del contrato (`types.ts:79-85`): valida capability por método;
  el input del LLM viaja SOLO como dato (query/body), nunca interpolado en URL;
  `notificar` best-effort (nunca lanza).

### Sí — F2: calificación de lead

- **Migración aditiva** en `Lead`: `qualification String @default("unknown")
  @map("calificacion")` (`hot|warm|cold|unknown`) + `qualificationReason
  String? @map("motivo_calificacion")`. String, no enum (coherente con
  `Lead.status`).
- **Tool `calificar_lead`** (`executor.ts`): el LLM la invoca con
  `{ qualification, reason }` → actualiza el `Lead` de la conversación
  (keyed por `conversationId`, ya único). Gate por capability `leads`.
- **Rúbrica en el prompt** (`buildSystemPrompt`, `engine.ts`): criterios
  HOT/WARM/COLD explícitos cuando `leads` está habilitado (v1 rúbrica por
  defecto; per-agente editable = follow-up).
- **Aviso al dueño en HOT**: reusa `notify-dispatcher.ts` (evento `nuevo_lead`
  con `qualification`), best-effort, canal telegram existente.

### No — fuera de scope

- **Auto-conversión lead→cliente en el CRM.** El endpoint de convertir
  (`/api/contactos/convert`) es autenticado (JWT), no público. v1 califica y
  avisa; convertir lo hace el dueño o un follow-up con credencial de servicio.
- **Campo de calificación en el CRM (`Contacto`).** v1 guarda la temperatura
  AA-side; propagarla al `Contacto` del CRM es follow-up (exige campo/endpoint
  en `creador_CRM`).
- **VAPI (llamada de voz "llámame ahora").** Configuración y disparo de VAPI =
  cambio aparte.
- **Hardening de scoping multi-tenant del lane público del CRM** (ver Risks).
- **Provisión de plantillas WhatsApp / ventana 24h** (canal ya construido; las
  plantillas Meta se preparan fuera de este cambio).
- `cancelarReserva`/`consultarPedido` sobre `external_api` (el CRM público no
  los expone; el método existe en el contrato pero v1 responde "no soportado"
  de forma honesta).

## Risks

- **Lane público del CRM sin auth.** `/api/public/*` identifica por `businessId`
  en el cuerpo, sin credencial (solo rate-limit + tenantGate). El adapter hereda
  esa superficie: cualquiera con el `businessId` puede crear leads/reservas.
  Para 3A (CRM propio) es aceptable; para vender a tenants, el CRM debe gatear el
  lane público o añadir auth por API-key (follow-up, no bloquea 3A). El
  `apiKeyEncrypted` (Bearer) del adapter ya deja el hueco para cuando el CRM lo
  exija.
- **Idempotencia en reintentos.** El adapter HTTP puede reintentar y duplicar
  lead/reserva. Mitigación: el `Lead` de AA es único por `conversationId`
  (dedup natural aguas arriba) y el `Contacto` del CRM deduplica por
  `codigo`/negocio; `crearReserva` del CRM tiene guarda de carrera
  (`ON CONFLICT DO NOTHING`, verificado). El adapter no reintenta escrituras no
  idempotentes salvo timeout confirmado.
- **Calificación errónea del LLM.** Puede clasificar mal. Mitigación: rúbrica
  explícita + `reason` persistido + el dueño SIEMPRE recibe aviso en hot para
  revisar; v1 NO borra ni descarta leads cold automáticamente (nada
  destructivo).
- **Secreto del CRM en claro.** `apiKey` del CRM se cifra `enc:v1:` con
  `encryptToken` (nunca en claro en BD ni logs), igual que OAuth/managed_db.
- **Inflado del contrato.** El adapter respeta la interface existente sin
  ampliarla; `notificar` sigue best-effort (no lanza) para no romper el chat.

## Dependencies

- **aa-agent-backend-foundation** — SHIPPED: `AgentDataBackend`, contrato
  `AgentBackendAdapter` (`agent-backend/types.ts`), `managed-db.ts` (referencia
  de implementación), `enabledBackendCapabilities` (`engine.ts:80-86`),
  `notify-dispatcher.ts` (aviso al dueño), `executor.ts` `withBackendAdapter`
  (`:55-66`) y `BACKEND_TOOLS_BY_CAPABILITY` (`engine.ts:148-155`).
- **creador_CRM** — endpoints públicos existentes (verificados): `POST
  /api/public/leads` (`routes/public/leads.ts:23`), `POST /api/public/bookings`
  (`public/bookings.ts:25`), `GET /api/public/availability`
  (`public/availability.ts`). Shapes exactos de campos se confirman en T1.2.
- `encryptToken`/`decryptToken` (`back/src/lib/integrations/oauth.ts`) — cifrado
  de `apiKeyEncrypted`.
- Motor/executor: `runToolLoop`/`buildAgentTools`/`buildSystemPrompt`
  (`engine.ts`), `executeTool` (`executor.ts`).
- `runtime` (openai|openclaw) y canal WhatsApp (Meta Graph API) — SHIPPED, sin
  cambios en este scope.
