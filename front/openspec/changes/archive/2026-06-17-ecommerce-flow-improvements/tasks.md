# Tasks — ecommerce-flow-improvements

Orden (ver design §11): schema/migración → RAG prompt → firmas+metadata helper →
intención → handoff → order-status → API → front → gate.
`Conversation.metadata` para intención/handoff (sin migración). Única columna nueva:
`Agent.ecommerceConfig` con SQL manual idempotente + rollback (design §8).

## 0. Schema y migración (back)

- [x] 0.1 `schema.prisma`: añadir `Agent.ecommerceConfig Json @default("{}")`.
- [x] 0.2 `back/prisma/migrate-ecommerce-config.sql` idempotente
      (`ADD COLUMN IF NOT EXISTS`) + rollback documentado; `npm run db:push`.

## 1. RAG con citas: recomendación y FAQ (back) — prompt-only

- [x] 1.1 (Verificado en design AD1: `searchKnowledge` ya devuelve `source` por
      fila; NO se toca `embeddings.ts`.)
- [x] 1.2 `engine.ts`: contar chunks (`knowledgeChunk.count` o `_count.knowledge`);
      inyectar bloque de recomendación+citas en `systemParts` solo si hay chunks.
- [x] 1.3 `tools.ts`: enriquecer `KNOWLEDGE_TOOL.description` para citar `source`.
- [x] 1.4 Test unit: bloque presente con chunks / ausente sin chunks; description
      menciona `source`.

## 2. Firmas y helper de metadata (back) — base de R3/R4

- [x] 2.1 `executeTool(agentId, name, input, conversationId?)` y
      `runAgent(..., contextFacts?, conversationId?)` retrocompatibles; `chatWithAgent`
      propaga `conversation.id`.
- [x] 2.2 Helpers `mergeConversationMetadata`/`getConversationMetadata`.

## 3. Lead con intención (recuperación de carrito) (back)

- [x] 3.1 `INTENT_TOOL` (`record_lead_intent`) siempre disponible + fragmento de prompt.
- [x] 3.2 Handler: escribe `metadata.leadIntent` si hay `conversationId`; sin él
      `{recorded:false}`. NO toca `lead-flow.ts` ni columnas de `Lead`.
- [x] 3.3 Test unit: intención → `metadata.leadIntent`; sin conversationId no persiste.

## 4. Handoff a humano + horario comercial (back)

- [x] 4.1 `handoff.ts`: `isWithinBusinessHours(config, now)` pura (Intl, fallback
      24/7 en TZ inválida) y `buildConversationSummary(conversationId)`.
- [x] 4.2 `HANDOFF_TOOL` (`request_human_handoff`) siempre disponible + prompt.
- [x] 4.3 Handler: persiste `metadata.handoff` + `Lead.status="handoff"` (upsert,
      `customerName="Visitante"` si no hay lead); notifica Slack reusando
      `send_slack_message`/`getValidToken`; degradación silenciosa si falla.
- [x] 4.4 Test unit: metadata+lead+Slack mock; `getValidToken` lanza → degrada sin
      throw; horario malformado → 24/7.

## 5. Estado de pedido — placeholder (back)

- [x] 5.1 `order-status.ts` `fetchOrderStatus(cfg, orderId)`: HTTP genérico (Bearer,
      orderId por query, timeout), raw sin asumir formato.
- [x] 5.2 `ECOMMERCE_TOOL` (`get_order_status`) en `tools.ts`; registro
      `ECOMMERCE`/`ORDER_STATUS`→`ecommerce` en `skill-capabilities.ts`.
- [x] 5.3 Handler: lee `ecommerceConfig.orderStatusUrl`; sin config →
      `{configured:false}`; descifra apiKey con `decryptToken`. Unión de tool en
      `engine.ts` condicionada a `orderStatusUrl`. Prompt de honestidad + handoff.
- [x] 5.4 Test unit: con config → endpoint mock; sin config → mensaje claro;
      endpoint caído → respuesta honesta.

## 6. Backend API (back)

- [x] 6.1 `PATCH /api/agents/:id/ecommerce-config`: valida con zod, cifra apiKey con
      `encryptToken`, merge sin borrar secreto, enmascara en GET.
- [x] 6.2 `GET /api/agents/:id/leads`: leads + `metadata.leadIntent`/`handoff`.
- [x] 6.3 GET agente: incluir `ecommerceConfig` (apiKey enmascarada) e inyectar
      `ecommerce` en `buildSkillStatus` si `orderStatusUrl` presente.

## 7. Frontend (front)

- [x] 7.1 `LeadsPanel.tsx` + tab "leads" en `TABS`: tabla con intención y badge handoff.
- [x] 7.2 `EcommerceConfigPanel.tsx` (en tab integraciones): horario, canal Slack
      handoff, `orderStatusUrl`, apiKey (password, enmascarada).

## 8. Tests y verificación

- [x] 8.1 Vitest back: RAG prompt/desc, intención, handoff (con/sin Slack, horario),
      order-status (con/sin config), cifrado apiKey round-trip, GET /leads mapeo.
- [ ] 8.2 Playwright front: config ecommerce visible/editable (apiKey enmascarada),
      tab leads con intención y badge handoff (mockeado).
- [x] 8.3 `cd back && npm test`, `cd front && npm run build` y typechecks en verde.
