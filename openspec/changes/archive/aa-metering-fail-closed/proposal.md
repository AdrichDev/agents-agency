# Proposal — aa-metering-fail-closed

Hijo **H1 (P0.1)** de `aa-agentes-entrega-monetizacion`.

## Intent

Cerrar todas las vías por las que un agente consume LLM de la plataforma **sin cupo, sin
registro y sin posibilidad de corte**. Es el prerequisito de vender: en modelo `platform`
la plataforma paga el coste variable, así que consumo no medido es pérdida directa e
invisible.

## Problema (ampliado respecto al plan maestro)

El plan maestro documentó **un** fail-open. La auditoría de este hijo encontró **dos**, y el
segundo es mayor:

### P1 — Fail-open por tenant nullable (documentado)

```ts
// back/src/routes/ai.ts:69
if (agent.tenantId) { await checkClientBalance(agent.tenantId); }
```

`Agent.tenantId` es `String?` y opcional al crear (`back/src/routes/agents.ts:86`) ⇒ agente
huérfano = consumo ilimitado sin registro.

### P2 — Fail-open por canal (NUEVO, más grave)

`chatWithAgent` tiene **tres** llamadores y el metering está en uno:

| Puerta | `checkClientBalance` | `deductTokens` | Fila en `uso_tokens` |
|---|---|---|---|
| `back/src/routes/ai.ts:79` (widget/API) | sí (fail-open) | sí | sí |
| `back/src/lib/channels/telegram-webhook.ts:113` | **no** | **no** | **no** |
| `back/src/lib/channels/whatsapp-webhook.ts:119` | **no** | **no** | **no** |

Y hay un **cuarto** camino al LLM que no pasa por `chatWithAgent` en absoluto —descubierto en
la verificación, ver `design.md` §C.8—: `back/src/lib/automations/engine.ts:114` llama a
`runAgent` directo. Mismo agujero en su segundo eje: consumo real, cero registro.

| Puerta | `checkClientBalance` | `deductTokens` | Fila en `uso_tokens` |
|---|---|---|---|
| `back/src/lib/automations/engine.ts:114` (schedule/cron) | **no** | **no** | **no** |

Los webhooks llaman `chatWithAgent(agentId, text, conversationId, "telegram")` — sin el 5º
parámetro `clientId`. Y dentro:

```ts
// back/src/lib/agent/engine.ts:720
if (clientId && reply.tokensUsed) { await deductTokens(clientId, ...); }
```

Sin `clientId` no se descuenta ni se registra, y nunca se comprobó saldo.

**Impacto de negocio:** un agente vendido en Telegram o WhatsApp consume gratis e ilimitado,
y `Tenant.isActive = false` **no lo corta** — el kill switch no existe en esos canales. El
consumo es invisible: cero filas en `uso_tokens`.

Origen: decisión consciente cuando AA era uso interno, documentada en
`back/src/lib/token-metering.ts:11` — *"Agente sin clientId → sin metering (uso interno,
ilimitado)"*. Vender invalida esa premisa.

## Approach

**El gate no va en las rutas.** Parchear tres llamadores garantiza que el cuarto nazca otra vez
sin metering — y de hecho el cuarto ya existía (automatizaciones, §C.8) y ya estaba sin medir.
Va en el **cuello único**: `runAgent` (`back/src/lib/agent/engine.ts:513`), paso obligado al LLM
desde todos los canales, que ya carga el agente con `findUniqueOrThrow` (línea 524) ⇒
`agent.tenantId` disponible **sin query nueva**.

Advertencia que este change se ganó a pulso: "cuello único" es una afirmación que hay que
**verificar enumerando llamadores**, no suponer. Se supuso mal dos veces (§C.6 y §C.8).

1. `assertUsageAllowed(tenantId, { isTest })` en `token-metering.ts`: decisión pura, sin
   query. Fail-closed — `tenantId == null` ⇒ 402.
2. Llamada en `runAgent` tras cargar el agente, **antes** de construir tools y de gastar
   tokens. `isTest` como parámetro aditivo al final de la firma (retrocompatible).
3. `AgentReply.meteredTenantId` propaga el tenant resuelto ⇒ `chatWithAgent` descuenta con
   el valor de BD, no con el que le pase el llamador.
4. `ai.ts`: se elimina el guard redundante y el `catch` mapea `HttpError.status` (hoy
   devuelve 500 fijo en `ai.ts:89`, convertiría un 402 en error interno).
5. Webhooks Telegram/WhatsApp: mensaje específico al usuario final si el motivo es 402
   (hoy dicen "ha ocurrido un error", que es falso y no accionable).

**Exención declarada:** conversaciones de la consola de pruebas (`isTest`) quedan exentas del
gate de saldo. El operador está autenticado y necesita probar agentes **antes** de asignarles
tenant — si no, se rompe el flujo crear → probar → asignar → publicar. `ChatTester.tsx:185`
manda `test: true` en cada turno, así que el flag es fiable en toda la conversación. El
control de coste de la consola es responsabilidad de **H4** (cuota de plataforma), no un
olvido.

## Scope

- Fase 1 (este change): **fail-closed en runtime. Sin migración.**
- Fase 2 (fuera de este change): `Agent.tenantId` a `NOT NULL`, sólo después de sanear los
  huérfanos de producción. Se separa a propósito: una migración `NOT NULL` con filas `NULL`
  falla, y saldría a prod sin red.

Fuera de scope: planes y precios (H4), ciclo de vida y publicación (H3), BYOK (H2).

## Risks

- **Agentes huérfanos en producción dejan de responder.** Es el riesgo real. Mitigación:
  `scripts/inventory-orphan-agents.ts` (sólo lectura) inventaría antes de desplegar; si
  devuelve filas, se les asigna tenant **antes** del deploy. Sin ese inventario, no se
  despliega.
- **Ruta caliente**: `runAgent` sirve todo el tráfico de agentes. Mitigación: tests de
  regresión por canal + exención `isTest` explícita; ningún cambio de comportamiento para
  agentes que ya tienen tenant con cupo.
- **Contrato de tests existente**: los suites que mockean `@/lib/token-metering` con sólo
  `deductTokens` fallan al añadirse un export nuevo. Se actualizan en este change.
- **Telegram y reintentos**: el webhook debe seguir respondiendo `200` ante 402, o Telegram
  reintenta en bucle. Ya lo hace en su `catch`; se preserva.

## Dependencies

- Plan maestro `aa-agentes-entrega-monetizacion` (§B.1, §C).
- Existente y reutilizado, no reescrito: `checkClientBalance`, `deductTokens`
  (`back/src/lib/token-metering.ts`), `HttpError` (`back/src/lib/http.ts`).
- Bloquea: H3 (publicar exige tenant), H4 (cuotas sobre datos de consumo fiables).
