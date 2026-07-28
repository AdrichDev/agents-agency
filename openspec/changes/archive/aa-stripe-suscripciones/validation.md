# Validación — H6 aa-stripe-suscripciones

## Historia de usuario

> Como propietario de la plataforma, quiero que la suscripción de cada cliente se cobre sola cada mes
> según los agentes que tenga activos, y que el que deja de pagar deje de ser servido, **sin que ese
> corte automático pueda deshacer una decisión que yo tomé a mano**.

> Como cliente, quiero que el precio que se me carga sea el que leí en la página de tarifas, y que si
> hay un problema con mi pago se me diga que es un problema de pago y no un fallo del asistente.

## Importes vigentes (del catálogo, no de aquí)

Esta tabla **no** es una fuente: es lo que el catálogo dice hoy, copiado para poder afirmar en un test
que la siembra de Stripe usó esos números y no otros. Si cambia el catálogo, cambia esta tabla — nunca
al revés.

| `serviceId` | Suscripción (€/mes, sin IVA) |
|---|---|
| `chatbot_basic` | 39 |
| `chatbot_plus` | 99 |
| `chatbot_pro` | 149 |
| `web_basic` | 59 |
| `web_chatbot` | 180 |
| `automation` | 49 |
| `crm` | 99 |

`hours` (75 €/hora) no genera suscripción: `maintPrice = 0`. `tokens_5m` / `tokens_10m` son recargas y
quedan fuera (ver `proposal.md`, §fuera de alcance).

**La implantación (`implPrice`) no aparece en esta tabla a propósito**: se factura con el módulo de
facturas de AA y no pasa por Stripe (§D9). Ningún `Price` se siembra con ella.

## Criterios de aceptación

- **AC1** — Ningún importe se escribe en código de H6. Todos salen de `SERVICE_CATALOG`, que es el
  espejo generado del catálogo canónico.
- **AC2** — `stripe:sync` es idempotente: dos ejecuciones seguidas sin cambios en el catálogo no
  crean ni modifican nada en Stripe.
- **AC3** — Al subir un importe en el catálogo, `stripe:sync` crea un `Price` nuevo, lo marca vigente
  en `StripePriceMap`, archiva el anterior y **no altera ninguna suscripción firmada**, informando de
  cuántas quedan en la tarifa vieja.
- **AC4** — `Plan.codigo` de un plan de suscripción es siempre un `id` presente en el catálogo.
- **AC5** — **Ningún manejador de webhook escribe `Tenant.isActive`.** Verificable por lectura del
  código y por test de comportamiento.
- **AC6** — El gate corta si `isActive === false` **o** si `subscriptionStatus ∈ {past_due, unpaid,
  canceled}`. `subscriptionStatus === null` **no** corta.
- **AC7** — Un cliente cortado por impago recibe un mensaje que habla de pago; uno cortado por
  suspensión manual, el de administrador; uno sin cupo, el de cuota. Tres mensajes distintos.
- **AC8** — El webhook rechaza con 400 cualquier petición sin firma válida, con firma de otro
  secreto, o con timestamp de más de 5 minutos. No registra el evento ni cambia estado.
- **AC9** — El mismo `event.id` entregado dos veces produce **un** único procesamiento.
- **AC10** — Un evento cuyo procesamiento falla queda con `processedAt = null` y se **reintenta** en
  la siguiente entrega; uno con `processedAt` puesto se descarta.
- **AC11** — El checkout ignora por completo cualquier `amount`, `priceId` o `quantity` que llegue en
  el body. Sólo lee `serviceId`.
- **AC12** — El checkout exige rol de staff. Un usuario `client` recibe 403.
- **AC13** — `quantity` enviada a Stripe es exactamente `countBillableAgents(tenantId)`. Los agentes
  en `draft` y los `isTest` no cuentan.
- **AC14** — Tras `customer.subscription.created`, `periodAnchorDay` es el día UTC del
  `billing_cycle_anchor` de la suscripción, y `periodStart` es el `current_period_start` de sus items
  (el mínimo si hay más de uno). **Corregido en T2.1:** el diseño decía
  `subscription.current_period_start`, campo que la API `2026-06-24.dahlia` ya no tiene en el objeto
  `Subscription` — vive en `SubscriptionItem`.
- **AC15** — Ningún test de este change abre una conexión de red.
- **AC16** — El payload de `/api/portal/me` sigue sin contener ni un importe (AC9 de H5, re-verificado).
- **AC17** — **`implPrice` no llega nunca a Stripe.** Ningún `Price` se siembra con él y ninguna sesión
  de Checkout lo usa. Un `checkout.session.completed` de `mode: "payment"` se registra y se ignora sin
  error.

## Escenarios Given-When-Then

### E1 (AC1, AC2) — La siembra usa el importe del catálogo
> **Given** un catálogo donde `chatbot_plus.maintPrice = 99`
> **When** se ejecuta `stripe:sync` contra el doble de test
> **Then** el `Price` creado para `chatbot_plus` es de `9900` céntimos, recurrente mensual, por unidad
> **And** una segunda ejecución no crea ni modifica nada.

### E2 (AC3) — Subir la tarifa no toca a quien ya firmó
> **Given** un `StripePriceMap` con `chatbot_plus` en 9900 y una suscripción activa con ese `Price`
> **When** el catálogo pasa a 109 y se ejecuta `stripe:sync`
> **Then** existe un `Price` nuevo de 10900 marcado como vigente
> **And** el anterior queda archivado
> **And** la suscripción existente sigue apuntando al `Price` de 9900.

### E3 (AC5, AC6) — El webhook no deshace una suspensión manual
> **Given** un tenant con `isActive = false` puesto a mano por el propietario
> **When** llega un `invoice.paid` válido para su suscripción
> **Then** `subscriptionStatus` pasa a `active`
> **And** `isActive` sigue siendo `false`
> **And** su agente sigue devolviendo 402.

### E4 (AC6, AC7) — Impago corta y lo dice
> **Given** un tenant con `isActive = true`, cupo de sobra y `subscriptionStatus = "past_due"`
> **When** su agente recibe un mensaje
> **Then** la respuesta es 402 con el mensaje de problema de pago
> **And** no es el mensaje de cuota agotada ni el de cuenta desactivada.

### E5 (AC6) — Sin suscripción no se corta a nadie
> **Given** un tenant con `subscriptionStatus = null` (los 15 de producción hoy)
> **When** su agente recibe un mensaje
> **Then** el gate no corta por suscripción
> **And** sigue aplicando el cupo y el `isActive` de siempre.

### E6 (AC8) — Firma inválida no entra
> **Given** un payload de `invoice.paid` firmado con un secreto que no es el configurado
> **When** llega a `/service/stripe/webhook`
> **Then** la respuesta es 400
> **And** no existe ninguna fila en `StripeEvent` para ese `event.id`
> **And** el tenant no cambió de estado.

### E7 (AC9) — Doble entrega, un solo efecto
> **Given** un `invoice.paid` con `event.id = "evt_1"` ya procesado
> **When** se entrega otra vez el mismo evento
> **Then** la respuesta es 200
> **And** sigue habiendo una sola fila `StripeEvent` con ese id
> **And** el periodo del tenant no se renovó por segunda vez.

### E8 (AC10) — Un fallo se reintenta
> **Given** un evento registrado con `processedAt = null` y un `error` guardado
> **When** Stripe lo reentrega
> **Then** se vuelve a procesar
> **And** al terminar bien queda con `processedAt` puesto y sin `error`.

### E9 (AC11) — El precio no viene del navegador
> **Given** una petición de checkout con `{ serviceId: "chatbot_plus", amount: 1, quantity: 99 }`
> **When** el servidor la atiende
> **Then** responde 400 y **no** se abre ninguna sesión de checkout.

> **Given** una petición de checkout con `{ serviceId: "chatbot_plus" }`
> **When** el servidor la atiende
> **Then** la sesión se crea con el `priceId` de `chatbot_plus` del mapa
> **And** con `quantity = countBillableAgents(tenantId)`.

> **CORRECCIÓN (27/07/2026, al implementar T6.4).** La redacción original decía que la sesión se creaba
> y que el `amount: 1` y el `quantity: 99` "no aparecían en la llamada". Eso contradice T6.1, que exige
> Zod con `.strict()`. Con `.strict()` el cuerpo sucio es un **400 sin sesión**, que es estrictamente
> más fuerte: "se ignoró el campo" y "se rechazó la petición" se parecen desde fuera, pero sólo el
> segundo deja rastro. Un 201 ante un cuerpo con `amount` le dice a quien lo pruebe que el campo fue
> aceptado, y el día que alguien añada un campo legítimo al esquema el ataque pasaría a estar vivo sin
> que ningún test cambiara de color. El escenario se parte en dos: cuerpo sucio → 400; cuerpo limpio →
> sesión con el precio del servidor.

### E10 (AC13) — Sólo lo facturable cuenta
> **Given** un tenant con 2 agentes `published`, 1 en `draft` y 1 `archived`
> **When** se abre el checkout
> **Then** `quantity` es 2.

> **Given** un tenant con 1 agente `published` y 1 `suspended`
> **When** se abre el checkout
> **Then** `quantity` es 2: un agente suspendido sigue ocupando su plaza.

> **CORRECCIÓN (27/07/2026, al implementar T6.4).** La premisa original ("1 agente con `isTest = true`")
> es imposible: `Agent` no tiene columna `isTest`. Ese campo vive en `Conversation`
> (`schema.prisma:579`, `es_prueba`) y marca la conversación de la consola de pruebas del operador, no
> el agente. Escrito tal cual, el test habría filtrado por una propiedad inexistente — habría contado 3
> donde esperaba 2, o peor, habría pasado en verde con un filtro roto. Lo que decide el recuento es
> `status`, vía `BILLABLE_STATUSES = ["published", "suspended"]` (`lib/agent/lifecycle.ts`), de ahí el
> segundo escenario: `suspended` **sí** cuenta.

### E11 (AC14) — Cupo y cobro en el mismo día
> **Given** una suscripción con `billing_cycle_anchor` en día 7 y un item cuyo
> `current_period_start` es ese mismo instante
> **When** llega `customer.subscription.created`
> **Then** `periodAnchorDay` del tenant es 7
> **And** `periodStart` es el `current_period_start` del item.

### E12 (AC12) — El cliente no cobra
> **Given** un usuario con rol `client` autenticado en el portal
> **When** llama al endpoint de checkout de su propio tenant
> **Then** recibe 403.

### E13 (AC17) — La implantación no es de Stripe
> **Given** un catálogo donde `chatbot_plus.implPrice = 1290`
> **When** se ejecuta `stripe:sync`
> **Then** ningún `Price` creado tiene importe `129000`
> **And** el único `Price` de `chatbot_plus` es el recurrente de `9900`
> **And** un `checkout.session.completed` de `mode: "payment"` se registra y se ignora sin error.

## Mapa test ↔ tarea

| Tarea | Test | Escenarios |
|---|---|---|
| T1 (migración + campos) | `stripe-estado-separado.test.ts` | — (sólo forma: ver nota) |
| T2 (`StripeGateway` + `stripe:sync`) | `stripe-sync-catalogo.test.ts` | E1, E2, E13 |
| T3 (webhook: firma + idempotencia) | `stripe-webhook-firma.test.ts`, `stripe-webhook-idempotencia.test.ts` | E6, E7, E8 |
| T4 (manejadores de estado) | `stripe-webhook-estado.test.ts` | E3, E11, E13 |
| T5 (gate por impago) | `stripe-gate-impago.test.ts` | E4, E5, E7 |
| T6 (checkout) | `stripe-checkout-precio-servidor.test.ts` | E9, E10, E12 |

**Nota sobre T1.** La versión inicial de esta tabla asignaba E3 y E5 a T1. Era falso: los dos son
escenarios de comportamiento y T1 sólo añade columnas. Sin manejadores (T4) ni gate (T5) no hay nada
que ejecutar, y AC5 —"ningún manejador escribe `isActive`"— tampoco se puede comprobar escaneando un
directorio que aún está vacío: pasaría en vacío. E3 y AC5 van a T4.6; E5, a T5.4. Lo que T1 sí
verifica es la **forma** que sostiene el diseño: `estado_suscripcion` nullable y sin default (un
`DEFAULT 'unpaid'` dejaría mudos de golpe a los 15 tenants de producción), migración sin backfill, y
`activo` intacta.

**Regla del repo:** una tarea está DONE sólo con su test verde. Sin spec, se revierte.
