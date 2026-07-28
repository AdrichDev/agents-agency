# H6 · aa-stripe-suscripciones

> Hijo P2.2 del eje `aa-agentes-entrega-monetizacion`. Depende de H4 (`Plan`) y H3 (recuento
> facturable). **Dinero real: human gate obligatorio antes de aplicar cualquier tarea.**

## Intención

Cobrar la suscripción. Hoy la plataforma sabe **cuánto se consume** (H1), **quién puede consumir**
(H3), **cuánto le toca** (H4/H7) y **se lo enseña al cliente** (H5) — pero no cobra nada. El agente
se sirve gratis y el kill switch por impago existe como columna sin nada que lo accione.

Este change cierra el circuito: alta de suscripción, cobro recurrente por agente activo, y corte
automático cuando el cliente deja de pagar.

## Contexto de partida (verificado, no supuesto)

- **No hay cuenta de Stripe.** Confirmado por el propietario el 27/07/2026. Nada de este change se
  puede verificar contra la API real, y el spec asume que los `Product`/`Price` se crean desde cero.
- No existe ni una línea de código de Stripe en el repo. Las 26 apariciones de "stripe" son
  comentarios que reservan el hueco (`schema.prisma:138`, `quota.ts:12`, `portal.ts:58`,
  `clients.ts:34`) y un patrón de clasificación de skills que no viene al caso.
- `Plan.codigo` ya está declarado como *"identificador estable usado por código y por H6"*
  (`schema.prisma:153`). El hueco del mapa a Stripe ya está previsto.
- `Tenant.periodStart` / `periodAnchorDay` / `tokensUsedPeriod` y la renovación perezosa
  (`billing-period.ts`, `renewPeriodIfDue`) **ya existen** desde H4 T3.
- `countBillableAgents()` ya devuelve el entero que Stripe necesita como `quantity`
  (`quota.ts:245`, definición en `@/lib/agent/lifecycle`).
- El patrón de webhook ya está resuelto en el repo: `rawBody` se captura en
  `express.json({ verify })` (`index.ts:104`) y `/service/*` se monta **fuera** del gate de usuario
  con su propio token (`index.ts:118`, `index.ts:123`).

## Alcance

**Dentro:**

1. **El catálogo sigue siendo la fuente del importe.** Los `Price` de Stripe se siembran desde
   `front/lib/service-catalog.json` con un comando, y un tripwire falla si divergen. Ver §D1 de
   `design.md` — esto **corrige** el comentario de `schema.prisma:138`.
2. **`Tenant.subscriptionStatus`**, campo nuevo y separado de `isActive`. El webhook escribe uno; el
   humano, el otro. Nunca al revés.
3. **Alta**: `POST /api/clients/:id/subscription/checkout` → sesión de Stripe Checkout en modo
   `subscription`. Recibe el `serviceId`; el importe lo resuelve el servidor.
4. **Webhook idempotente** en `/service/stripe/webhook`, con verificación de firma HMAC y una tabla
   `StripeEvent` que hace de registro de eventos ya procesados.
5. **Sincronización del ciclo**: `periodAnchorDay` pasa a tomarse del `current_period_start` de la
   suscripción, para que el cupo se reinicie el mismo día que se cobra.
6. **Cantidad facturable**: al renovar, AA reporta `countBillableAgents()` como `quantity`.
7. **Impago → corte**: `subscriptionStatus` en `past_due`/`unpaid`/`canceled` corta el servicio con
   402, reutilizando `checkClientBalance`.

**Fuera, con motivo:**

- **Implantación** (`implPrice`: 540 / 1290 / 1730 €). **Decidido el 27/07/2026: se factura con el
  módulo de facturas que ya existe en AA, no con Stripe.** Es un pago único y no recurrente, así que
  no gana nada por pasar por una pasarela de suscripciones: metido en el mismo Checkout obligaría al
  webhook a distinguir un `checkout.session.completed` que a veces crea suscripción y a veces no, y a
  Stripe a ser la fuente de un importe que la factura ya registra como snapshot
  (`BudgetLine.implPrice`). Stripe queda por tanto para **una sola cosa**: el cobro recurrente.
- **Recargas de tokens** (`tokens_5m` 17 €, `tokens_10m` 30 €). No es un olvido y no es trivial:
  el único sitio donde hoy cabría sumar una recarga es `Tenant.tokenBalance`, que es el **override**
  del cupo — escribir ahí convertiría al tenant en `source: "override"` y **desactivaría su plan de
  forma permanente e invisible** (`quota.ts:88`). Una recarga necesita su propia columna acumulable
  por periodo, y eso es un change de cupo, no de cobro.
- **Portal de facturas del cliente.** H5 cerró con la regla "cero importes en el payload" (AC9) y
  este change no la toca. Las facturas las sirve el Customer Portal de Stripe, no AA.
- **Prorrateo y cambios de plan a mitad de periodo.** Stripe lo hace solo; AA no debe replicar esa
  aritmética.

## Riesgos

| Riesgo | Por qué duele | Mitigación |
|---|---|---|
| **El webhook pisa una suspensión manual** | El propietario bloquea a un cliente a mano (`isActive = false`); llega `invoice.paid` y el webhook lo reactiva. El bloqueo se deshace solo y sin rastro. | Campo separado (§D3). Ningún webhook escribe `isActive`. |
| **Cobrar dos veces** | Stripe reintenta los webhooks. Un `invoice.paid` procesado dos veces podría renovar dos periodos o duplicar un ajuste. | Idempotencia por `event.id` con inserción previa al proceso (§D5). |
| **Webhook falsificado** | El endpoint está fuera del gate de auth por necesidad. Sin verificar la firma, cualquiera activa suscripciones ajenas. | HMAC con `STRIPE_WEBHOOK_SECRET` sobre `rawBody`; sin firma válida, 400 y no se procesa (§D6). |
| **Precio anunciado ≠ precio cobrado** | `/tarifas` dice 99 € y la tarjeta se carga 109 €. Lo descubre el cliente. | El catálogo siembra Stripe y un tripwire compara los dos (§D1). |
| **Cupo y cobro desfasados** | Se cobra el día 1 y el cupo se reinicia el día 7: seis días de servicio sin cupo o de cupo sin cobro. | El ancla se toma de la suscripción (§D4). |
| **Nada verificable en vivo** | Sin cuenta Stripe no hay forma de probar contra la API real. | Puerto `StripeGateway` con doble de test; los webhooks se prueban con fixtures firmados de verdad (§D8). El smoke real queda como tarea de gate humano. |
| **`isTest` y agentes de prueba** | Un agente de pruebas propio no debe generar cargo. | `countBillableAgents()` ya excluye lo que no es facturable; se añade test negativo. |

## Dependencias

- **H4** ✅ — `Plan.codigo`, `tokenQuotaPerAgent`, periodo de facturación.
- **H3** ✅ — `BILLABLE_STATUSES` y `countBillableAgents()`.
- **`aa-catalogo-precios-fuente-unica`** ✅ — sin fuente única del importe, sembrar Stripe sería
  elegir a mano cuál de los dos catálogos tenía razón.
- **Cuenta de Stripe** ❌ — **no existe**. Bloquea T6 (smoke real) y el despliegue, no el resto.
- **Gate humano** — obligatorio antes de T1 y otra vez antes de pasar a claves `live`.

## Nivel

**4 — Crítico.** Coste financiero real (2) + persistencia irreversible en un tercero (2) + superficie
de autenticación nueva (3) + cruza dominios cobro/cupo/ciclo de vida (2). Requiere Devil's Advocate y
aprobación humana explícita por tarea que toque claves o datos de producción.
