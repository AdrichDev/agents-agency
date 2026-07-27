# Diseño — H6 aa-stripe-suscripciones

## §D1 — El catálogo es la fuente del importe; Stripe es quien lo ejecuta

`schema.prisma:138` dice hoy: *"El importe que se cobra DE VERDAD es el que está en Stripe"*. Esa
frase acertaba en la conclusión (AA no debe tener columna de precio) y se equivocaba en la premisa.

Stripe **cobra** el importe, pero no puede ser su fuente, porque el mismo número se anuncia en
`/tarifas`. Dos sitios editables a mano con el mismo número divergen — es exactamente lo que acaba de
pasar entre los dos catálogos de este repo, y por lo que existe
`aa-catalogo-precios-fuente-unica`. Que uno de los dos sitios esté en un SaaS ajeno no cambia la
aritmética: la cambia a peor, porque el de Stripe se edita desde un panel web sin revisión de código
y sin dejar diff.

**Decisión:** misma arquitectura que el espejo del back, extendida un salto más.

```
front/lib/service-catalog.json          ← FUENTE ÚNICA (se edita aquí)
        ├─→ front: SERVICES_CATALOG      (deriva en import)
        ├─→ back/src/lib/service-catalog.ts  (generado, `npm run catalog:sync`)
        └─→ Stripe Product/Price          (sembrado, `npm run stripe:sync`)
```

`npm run stripe:sync` lee el catálogo y, por cada servicio con `maintPrice > 0`, garantiza un
`Product` y un `Price` recurrente mensual por unidad con ese importe. Guarda el mapa en
`StripePriceMap` (§D2). Es idempotente: si el `Price` activo ya tiene el importe del catálogo, no
toca nada.

**Los `Price` de Stripe son inmutables.** Subir 99 € a 109 € no edita el `Price`: crea uno nuevo y
hay que reapuntar el `Product` y **migrar las suscripciones firmadas**, que siguen en el viejo hasta
que se migran una a una. `stripe:sync` por tanto: crea el `Price` nuevo, lo marca como el vigente en
el mapa, archiva el anterior, y **deja las suscripciones existentes intactas** informando por consola
de cuántas quedan en la tarifa vieja. Migrarlas es una decisión comercial (¿se le sube el precio a un
cliente que ya firmó?), no una consecuencia automática de editar un JSON.

**Tripwire:** `stripe:check` compara el importe de cada `Price` vigente con el del catálogo y falla
si divergen. No puede ser un test unitario porque necesita red; es un comando de despliegue y una
tarea de verificación humana.

## §D2 — `Plan.codigo` es el `serviceId`, y el mapa a Stripe vive en su propia tabla

`Plan.codigo` ya está declarado *"usado por código y por H6"*. Se fija que su valor **es** el `id` del
catálogo (`chatbot_basic`, `chatbot_plus`, `chatbot_pro`, `web_chatbot`, …). Un solo identificador
recorre catálogo → plan → Stripe, y no hay tabla de traducción que mantener.

Los ids de Stripe **no** van en `Plan`. Van en tabla aparte:

```prisma
model StripePriceMap {
  serviceId String   @map("servicio_id")       // = catálogo.id = Plan.codigo
  mode      String   @map("modo")              // "test" | "live"
  productId String   @map("producto_id")
  priceId   String   @map("precio_id")         // el Price VIGENTE
  amount    Int      @map("importe_centimos")  // espejo del catálogo, para el tripwire
  ...
  @@id([serviceId, mode])
}
```

La clave es **compuesta**, no `serviceId` solo: es lo que dice el párrafo siguiente y lo que se
implementó en T1.2. Con `serviceId` como `@id` y `mode` como campo suelto, un `stripe:sync` en test
pisaría la fila de producción — exactamente lo que la separación pretende evitar.

Motivo de la separación: los ids de Stripe son **distintos en `test` y en `live`**, y meterlos en
`Plan` obligaría a duplicar los planes o a que un despliegue de test pisara los ids de producción.
Con `mode` en la clave del mapa, los dos entornos conviven. Y `Plan` sigue sin saber nada de Stripe,
que era el punto del comentario original.

## §D3 — `isActive` no lo escribe el webhook. Nunca.

El hallazgo central de este change.

`token-metering.ts:82` dice hoy: *"`isActive` es ya SÓLO estado administrativo (impago o suspensión
manual)"*. Ahí ya hay **dos hechos en una columna**, y hoy no molesta porque nada automático la
escribe. En cuanto un webhook la escriba:

- El propietario suspende a un cliente a mano (`isActive = false`). Llega `invoice.paid`. El webhook
  pone `true`. **La suspensión manual se deshace sola y sin dejar rastro.**
- El propietario reactiva a mano a un moroso. Llega el siguiente `invoice.payment_failed` y lo vuelve
  a cortar, o no llega ninguno y el moroso queda servido indefinidamente.

Es el mismo error que H4/T1 deshizo al separar "cupo agotado" de "cuenta desactivada", y el que el
propio `schema.prisma:180` describe como *"meter dos hechos distintos en un solo sitio"*.

**Decisión:**

```prisma
subscriptionStatus String? @map("estado_suscripcion")  // null | active | past_due | unpaid | canceled | trialing
stripeCustomerId   String? @unique @map("stripe_cliente_id")
stripeSubscriptionId String? @unique @map("stripe_suscripcion_id")
```

- `isActive` → **sólo decisión humana**. Kill switch del propietario. Ningún webhook lo toca.
- `subscriptionStatus` → **sólo hecho de Stripe**. Ninguna pantalla del panel lo edita.
- El gate corta con **OR**: `!isActive || subscriptionStatus ∈ {past_due, unpaid, canceled}`.

`null` es **"sin suscripción"** y **no corta**, deliberadamente: los 15 tenants de producción no
tienen suscripción y el día del despliegue no pueden quedarse mudos. Fail-open **sólo aquí**, sólo
para este campo, y sólo porque el corte por impago sin ningún cobro configurado cortaría a todos los
clientes actuales a la vez. El fail-closed de H1 no se afloja: `isActive` y el cupo siguen cortando.

**Mensaje al cliente:** el motivo importa, igual que en H4 T1.3. Un cliente en `past_due` tiene que
leer que hay un problema con el pago, no "contacta con el administrador" — porque el que tiene que
actuar es él. Constante propia, `MSG_IMPAGO`.

## §D4 — El ancla del periodo se toma de Stripe

Si `periodAnchorDay` sigue siendo el día en que se creó el tenant y Stripe cobra el día de alta de la
suscripción, cupo y cobro se desfasan. Un cliente que se suscribe el 7 y tiene ancla el 1 pasa seis
días de cada mes con el cupo ya reiniciado y la factura sin emitir.

Al recibir `customer.subscription.created` / `.updated`, se escribe el `periodAnchorDay` y se fuerza
`periodStart` al inicio del periodo de Stripe. La aritmética de `billing-period.ts` no se toca — sigue
siendo suya la decisión de cuándo vence. Sólo se le da el ancla correcta.

**CORRECCIÓN (verificada contra `stripe@22.3.2`, API `2026-06-24.dahlia`, T2.1).** Este párrafo decía
`subscription.current_period_start`. **Ese campo ya no existe en el objeto `Subscription`.** Migró a
cada `SubscriptionItem` (`cjs/resources/SubscriptionItems.d.ts:58`); en `Subscription` sólo sobrevive
como parámetro de filtrado del `list`. Escrito como estaba, el manejador de T4 habría leído `undefined`
y guardado un ancla basura — y el fallo no habría salido hasta producción, porque sin cuenta de Stripe
no hay payload real contra el que chocar. Las dos lecturas correctas, que además son dos campos
distintos para dos cosas distintas:

- `periodAnchorDay` ← día UTC de **`subscription.billing_cycle_anchor`**. Es el campo canónico del
  ancla, está en el propio `Subscription`, nunca es `null`, y su semántica es literalmente la de esta
  columna: *"the reference point that aligns future billing cycle dates… sets the day of month for
  `month` intervals"*.
- `periodStart` ← **`subscription.items.data[0].current_period_start`**. Con un solo item —una
  suscripción de AA es un `Price` × `quantity`— es inequívoco; el manejador toma el **mínimo** de los
  items para no depender de ese supuesto si algún día hay más de uno.

Ojo: eso **reinicia `tokensUsedPeriod`** por la vía normal (`renewPeriodIfDue`). Es lo correcto — el
periodo nuevo empieza — pero hay que escribirlo en el spec para que no parezca un efecto colateral.

## §D5 — Idempotencia por `event.id`, insertando antes de procesar

Stripe reintenta hasta que recibe un 2xx, y puede entregar el mismo evento más de una vez incluso
tras un 200. Procesar dos veces un `invoice.paid` podría renovar dos periodos.

```prisma
model StripeEvent {
  id          String    @id                    // el event.id de Stripe
  type        String    @map("tipo")
  receivedAt  DateTime  @default(now()) @map("recibido_en")
  processedAt DateTime? @map("procesado_en")
  error       String?   @map("error")
}
```

Orden **obligatorio**: `create()` primero. Si viola el unique, el evento ya se vio → 200 y salir sin
procesar. Sólo después se procesa y se marca `processedAt`.

Al revés (procesar y luego registrar) no sirve: dos entregas concurrentes pasarían las dos el "¿ya
existe?" antes de que ninguna registre. El unique de la base de datos es la única primitiva de
exclusión que hay aquí.

**Un evento que falla al procesar se marca con `error` y devuelve 500**, para que Stripe reintente.
Pero la fila ya existe, así que el reintento choca con el unique y se descartaría. Por tanto: el
reintento se admite si `processedAt IS NULL` — "visto pero no terminado" no es "ya hecho".

## §D6 — El webhook va fuera de `/api`, con firma verificada

`/api` lleva `apiLimiter`, el gate de token Supabase y `clientScopeGate` (`index.ts:113-198`). Un
webhook de Stripe no tiene sesión de usuario y no puede pasar por ahí. Precedente exacto en el repo:
`/service/operator` y `/service/telegram`, montados fuera del gate con su propio token
(`index.ts:118`, `index.ts:123`).

Ruta: **`POST /service/stripe/webhook`**.

La autenticación **no** es un service token: es la firma de Stripe. Se verifica con HMAC-SHA256 del
header `stripe-signature` contra `STRIPE_WEBHOOK_SECRET`, usando **`req.rawBody`** — que el repo ya
captura en `express.json({ verify })` (`index.ts:104`) precisamente para esto. Con el body parseado
la firma no se puede verificar, porque `JSON.stringify` no reproduce byte a byte el original.

Se valida además la **antigüedad del timestamp** del header (tolerancia 5 min) para que una petición
capturada no se pueda reproducir indefinidamente. Sin firma válida: **400 y no se procesa**, sin
registrar nada en `StripeEvent` — un evento no autenticado no es un evento.

## §D7 — El checkout no acepta importes del navegador

`POST /api/clients/:id/subscription/checkout` recibe **`{ serviceId }`** y nada más. El servidor:

1. Resuelve el importe desde `SERVICE_CATALOG` (el espejo generado) vía `StripePriceMap`.
2. Calcula `quantity = countBillableAgents(tenantId)`.
3. Crea la sesión con ese `priceId` y esa `quantity`.

Si el endpoint aceptara `amount`, `priceId` o `quantity` del cliente, cualquiera se suscribiría a
1 céntimo. No es una precaución teórica: es la primera cosa que se prueba contra un checkout.

Requiere `requireRole()` de staff — es el propietario quien da de alta la suscripción de un cliente,
no el cliente. El portal de H5 no gana ningún endpoint de cobro.

## §D8 — Verificación sin cuenta de Stripe

No hay cuenta. La consecuencia no es "no se puede probar": es que hay que separar lo que necesita red
de lo que no.

**Puerto `StripeGateway`** — interfaz estrecha con lo único que se usa: `createCheckoutSession`,
`retrieveSubscription`, `updateSubscriptionQuantity`, `ensureProduct`, `ensurePrice`. Implementación
real con el SDK; doble de test en memoria. Ningún test toca la red, y el día que haya cuenta el
smoke real es un cambio de implementación, no de spec.

**Los webhooks se prueban de verdad**, no simulados: el fixture se firma localmente con HMAC y un
secreto de test. Eso ejercita el camino completo —verificación de firma, idempotencia, escritura de
estado— sin un solo byte de red. Lo que **no** se puede probar es que el payload de Stripe tenga la
forma que asumimos; para eso están los tipos del SDK y el smoke con cuenta real (T6, gate humano).

## §D9 — La implantación no pasa por Stripe

Decidido el 27/07/2026: `implPrice` (540 / 1290 / 1730 €) se factura con el **módulo de facturas que
ya existe en AA**. Stripe se queda con **una sola responsabilidad**: el cobro recurrente.

Es la decisión correcta y conviene registrar por qué, porque la tentación de "ya que está la pasarela,
cóbralo todo por ahí" volverá:

- **No es recurrente.** Un `mode: "payment"` no tiene ciclo, ni renovación, ni `quantity` que
  reportar. Comparte con la suscripción el proveedor y nada más.
- **Ensuciaría el webhook.** Un `checkout.session.completed` que a veces trae suscripción y a veces no
  obliga a ramificar el manejador por el modo de la sesión. Cada rama de un webhook es una rama que
  hay que probar y que puede fallar en producción sin que nadie mire.
- **El importe ya tiene dueño.** La factura guarda `BudgetLine.implPrice` como **snapshot** de lo
  facturado, que es lo que debe ser: una factura emitida no se reescribe porque suba la tarifa.
  Mandarlo a Stripe pondría el mismo número en un tercer sitio sin ganar nada.

Consecuencia práctica en el código: `checkout.session.completed` sólo tiene que atender sesiones de
suscripción. Si llega una de `mode: "payment"`, se registra y se ignora (§D5, misma política que un
evento no manejado) — no es un error, es que ese cobro no es de aquí.

## §D10 — Lo que NO se toca

- **`Plan` no gana columna de precio.** El comentario del schema acertaba en eso.
- **`front/lib/service-catalog.json` no gana campos de Stripe.** Es un catálogo comercial, no un
  fichero de configuración de un proveedor de pagos. El mapa vive en la base de datos.
- **`BudgetLine.implPrice/maintPrice`** sigue siendo el snapshot de lo facturado. Una factura emitida
  no se reescribe porque suba la tarifa.
- **El payload del portal (H5) sigue sin importes.** AC9 de H5 se mantiene y se re-verifica.
