# Tareas — H6 aa-stripe-suscripciones

> **GATE HUMANO ANTES DE T1.** Nivel 4: dinero real. Ninguna tarea arranca sin aprobación explícita.
> **No hay cuenta de Stripe** (confirmado 27/07/2026): T1-T5 y T7 se implementan y verifican contra el
> doble de test; T6.4 y el despliegue quedan bloqueados hasta que exista cuenta y claves.

Orden crítico: primero separar el estado (T1), porque todo lo demás escribe en él. El webhook antes
del checkout (T3-T4 antes de T6): un checkout que crea suscripciones sin nada que procese sus eventos
deja al cliente pagando sin que AA se entere.

## T0 — Gate y decisiones previas

- [ ] **T0.1** Aprobación humana del `proposal.md` y del nivel 4.
- [ ] **T0.2** Confirmar el modelo de cobro: **por agente activo**, `Price` por unidad × `quantity`.
      Ya decidido en H4 (`aa-cobro-por-agente-activo`); se re-confirma porque aquí se vuelve real.
- [x] **T0.3** ~~Decidir si la implantación se cobra por la plataforma o se factura aparte.~~
      **Resuelto el 27/07/2026: se factura con el módulo de facturas que ya existe.** La implantación
      no pasa por Stripe y T7 se cae del change (§D9). Stripe se queda con una sola responsabilidad:
      el cobro recurrente.
- [ ] **T0.4** Crear cuenta de Stripe y obtener claves de **test**. Bloquea T2.5 en adelante para
      verificación real, no para implementación.

## T1 — Separar el estado de suscripción del kill switch manual

- [x] **T1.1** `schema.prisma`: `Tenant` gana `subscriptionStatus`, `stripeCustomerId` (unique),
      `stripeSubscriptionId` (unique). Comentario que fije la regla de §D3: `isActive` es humano,
      `subscriptionStatus` es de Stripe, y ninguno de los dos entra en el territorio del otro.
      Incluye la corrección del comentario de `Plan` (§D1: el catálogo es la fuente, Stripe el ejecutor).
- [x] **T1.2** Modelos `StripeEvent` y `StripePriceMap` (§D2, §D5).
- [x] **T1.3** Migración **escrita y no aplicada**: `20260727060000_stripe_estado_suscripcion`.
      Aplicarla es gate humano aparte (G1) — es la lección de `crm-migraciones-sin-aplicar-gotcha` y de
      H3 T1.3. `prisma validate` OK y `prisma generate` OK (Prisma Client 7.8.0).
- [x] **T1.4** `stripe-estado-separado.test.ts` — **sólo forma de schema y migración**, no
      comportamiento. Afirma que `estado_suscripcion` nace nullable y SIN DEFAULT, que la migración no
      escribe ni una fila y que no roza `activo`, y que el cliente generado conoce los campos nuevos.
      **Corrección de alcance:** esta tarea decía "E3 y E5 + el test de lectura de AC5". Estaba mal.
      E3 (el webhook no deshace una suspensión manual) y E5 (sin suscripción no se corta) son
      escenarios de comportamiento que necesitan los manejadores (T4) y el gate (T5), que aún no
      existen; y AC5 no se puede verificar escaneando un directorio de manejadores vacío — pasaría en
      vacío, que es peor que no tener test (regla ya aplicada en
      `catalogo-precios-fuente-unica.test.ts`). E3 → T4.6, E5 → T5.4, AC5 → T4.6.
- [x] **T1.5** `npx tsc --noEmit` verde en `back/`.

## T2 — El catálogo siembra Stripe

- [x] **T2.1** `back/src/lib/stripe/gateway.ts`: interfaz `StripeGateway` (§D8), estrecha y con sólo
      lo que se usa. Implementación real con el SDK (`stripe@22.3.2`, API `2026-06-24.dahlia`).
      Dos decisiones que no estaban en el diseño y conviene fijar: `Product.id` **determinista**
      (`aa_<serviceId>`), así "garantizar el producto" es un `retrieve`-o-`create` y no hay que buscar
      por nombre —que es texto comercial y cambia—; y el **modo se deriva del prefijo de la clave**, no
      de una `STRIPE_MODE` aparte, porque una variable independiente podría contradecir a la clave y
      escribir ids de producción en la fila `test` del mapa.
- [x] **T2.2** `back/tests/helpers/fake-stripe.ts`: doble en memoria. Modela la **inmutabilidad de los
      `Price`** — el puerto no expone ningún `updatePriceAmount`, ni aquí ni en la implementación real.
      Lleva contador de llamadas porque la idempotencia se comprueba por AUSENCIA de `createPrice` /
      `archivePrice`: dos pasadas que crean y archivan dejan el mismo estado final que una que no toca
      nada.
- [x] **T2.3** `back/src/lib/stripe/sync-catalog.ts` (lógica) + `back/scripts/sync-stripe-catalog.ts`
      (CLI) + `npm run stripe:sync`. Lee `SERVICE_CATALOG`, salta los `maintPrice = 0`, garantiza
      `Product`/`Price`, escribe `StripePriceMap`. La lógica va aparte del script para que se ejecute
      de verdad en los tests contra el doble.
      **Exclusión que el diseño no había cerrado:** además de `maintPrice = 0` (`hours`) se saltan
      `tokens_5m` y `tokens_10m`. Sí son mensuales, pero son recargas de cupo y hoy AA **no sabe
      aplicarlas** (`tokenBalance` es el override y escribir ahí desactivaría el plan del tenant de
      forma invisible). Cobrar algo que la plataforma no puede aplicar es peor que no venderlo.
- [x] **T2.4** `stripe-sync-catalogo.test.ts`: E1, E2 y E13. Contra el doble, sin red. 13 tests verdes.
- [x] **T2.5** `npm run stripe:check` — tripwire de deriva catálogo ↔ Stripe, con código de salida ≠ 0.
      **Escrito; su ejecución real sigue bloqueada por T0.4** (necesita cuenta y clave).

## T3 — Webhook: autenticidad e idempotencia

- [x] **T3.1** `back/src/lib/stripe/webhook-signature.ts`: verificación HMAC-SHA256 sobre `rawBody`,
      con tolerancia de 5 min al timestamp. Función pura y testeable sin servidor.
      Sin instancia del SDK, así que los tests firman fixtures reales sin red (AC15).
      Dos decisiones: (a) el **timestamp se comprueba antes** del HMAC — una firma legítima capturada
      sigue siendo criptográficamente válida para siempre, sólo la ventana la invalida; (b) se acepta si
      **cualquiera** de las `v1` del header coincide, no la primera: durante una rotación de secreto
      Stripe manda las dos, y quedarse con `[0]` rechazaría tráfico legítimo justo entonces.
- [x] **T3.2** `back/src/routes/service-stripe.ts` montado en `/service/stripe`, **fuera de `/api`**
      (§D6, patrón `service-telegram.ts`). Firma inválida → 400 sin registrar nada.
      El evento se parsea de `req.rawBody`, los mismos bytes firmados, no de `req.body`.
      El motivo del rechazo va al log y **no** a la respuesta: distinguir "timestamp fuera de ventana" de
      "HMAC incorrecto" sería un oráculo. Falta `STRIPE_WEBHOOK_SECRET` → 500, no 200: aceptar a ciegas
      sería un endpoint abierto capaz de marcar morosos como pagados.
- [x] **T3.3** Registro idempotente: `create()` **antes** de procesar; unique violation con
      `processedAt` puesto → 200 y salir; con `processedAt` null → reintentar (§D5).
      `back/src/lib/stripe/event-log.ts`. Un fallo del manejador devuelve **500 a propósito** y deja la
      fila con `processedAt = null`: es lo que hace que Stripe reintente.
      Ventana residual declarada en el fichero: dos entregas *concurrentes* de un evento aún sin procesar
      pueden ambas procesar. Aceptable porque los manejadores son idempotentes en efecto (escriben un
      estado, no incrementan). Cerrarla exigiría un claim con `FOR UPDATE`; queda como deuda anotada.
- [ ] **T3.4** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en `back/.env.example`. **Sólo el nombre,
      nunca un valor.**
      **BLOQUEADA — no por diseño, por permisos.** Un hook del entorno deniega el acceso a
      `back/.env.example`. Es el mismo bloqueo que tiene pendiente T2.6 de H2 (`ANTHROPIC_API_KEY`).
      No se reintenta: lo tiene que desbloquear o aplicar el propietario. Las dos variables **sí** están
      documentadas en el encabezado de `gateway.ts` y `service-stripe.ts`, así que el conocimiento no se
      pierde; lo que falta es el recordatorio en el fichero de ejemplo.
- [x] **T3.5** `stripe-webhook-firma.test.ts` (E6) y `stripe-webhook-idempotencia.test.ts` (E7, E8).
      Fixtures firmados localmente de verdad.
      **30 tests verdes.** El almacén de `stripeEvent` del test es un `Map` con estado y su `create`
      lanza `P2002` como PostgreSQL: con un mock sin estado la segunda entrega no encontraría la fila de
      la primera y el test de idempotencia no probaría nada. Se cubre el ciclo completo
      fallo → 500 → reentrega → 200 → tercera entrega descartada, y que una firma inválida no llega ni a
      crear la fila.

## T4 — Manejadores de estado

- [x] **T4.1** `customer.subscription.created` / `.updated` / `.deleted` → `subscriptionStatus`,
      `stripeSubscriptionId`, y el ancla del periodo desde `current_period_start` (§D4).
      **Corregido sobre lo escrito arriba:** el ancla sale de `billing_cycle_anchor` y el inicio de
      periodo del **mínimo de `items.data[].current_period_start`**. En la API `2026-06-24.dahlia` el
      objeto `Subscription` ya no tiene `current_period_start` (ver la CORRECCIÓN de §D4). Tal como
      estaba especificado, este manejador habría leído `undefined` y guardado un ancla basura,
      indetectable sin cuenta de Stripe.
      `.deleted` escribe el estado pero **no** mueve el ciclo de cupo: una suscripción cancelada no debe
      reiniciar el periodo de un cliente que sigue existiendo.
- [x] **T4.2** `invoice.paid` → `subscriptionStatus = "active"`. **No toca `isActive`.**
- [x] **T4.3** `invoice.payment_failed` → `past_due`. **No toca `isActive`.**
      El estado se guarda **tal como lo dice Stripe**, sin traducir a un enum propio: así `incomplete` o
      `paused` quedan registrados de forma fiel y la política de corte la decide una sola lista en T5.
- [x] **T4.4** Evento de tipo no manejado → 200 y registrado. Un 4xx haría que Stripe reintentara
      indefinidamente algo que nunca vamos a procesar. **Incluye `checkout.session.completed` de
      `mode: "payment"`**: la implantación se factura fuera de Stripe (§D9), así que ese cobro no es de
      aquí y no es un error (AC17).
- [x] **T4.5** Evento de un `stripeCustomerId` desconocido → 200, registrado, **sin crear tenant**.
      Fail-closed: un webhook no da de alta clientes.
      Orden de resolución: `metadata.tenantId` → `stripeSubscriptionId` → `stripeCustomerId`. Los
      metadatos van primero porque los pone AA al abrir el checkout y son el único vínculo que existe
      antes de que la suscripción tenga id guardado.
- [x] **T4.6** `stripe-webhook-estado.test.ts`: E3, E11. **Y AC5 aquí, no en T1**: con los manejadores
      ya escritos, el test de lectura tiene algo que leer y su fallo significa algo.
      **22 tests verdes.** AC5 se comprueba de dos formas complementarias: recorriendo
      `HANDLED_EVENT_TYPES` y afirmando que ninguna rama escribe `isActive`, y leyendo el fuente de los
      tres ficheros (sin comentarios, que sí nombran la columna) para cubrir también al manejador que
      alguien añada mañana. Con un tercer test de que sí escribe `subscriptionStatus`, para que "no
      escribe `isActive`" no pase por ser trivialmente cierto. Y uno de que no escribe `tokenBalance`,
      que es el override manual del cupo (`quota.ts:88`).
      También cubierto: `Date.now()` no participa en el ancla, `customer` expandido como objeto, y un
      payload sin ancla ni items que degrada a escribir sólo el estado.

## T5 — Corte por impago

- [x] **T5.1** `MSG_IMPAGO` en `token-metering.ts`, tercera constante junto a `MSG_SUSPENDIDO` y
      `MSG_CUOTA` (§D3, criterio de H4 T1.3).
      Texto: *"El servicio está suspendido porque hay un pago pendiente. Regulariza la suscripción para
      reactivarlo."* Deliberadamente **no** dice "contacta con el administrador": eso mandaría a esperar
      a otro a quien puede resolverlo él mismo, y alargaría el corte sin motivo.
- [x] **T5.2** `checkClientBalance` lee `subscriptionStatus` y corta con 402 en `past_due`/`unpaid`/
      `canceled`. **Antes** del cupo: si no está pagando, el cupo no es el problema que hay que
      contarle. `null` no corta.
      La lista vive en **una sola** constante, `SUBSCRIPTION_BLOCKING_STATUSES`, aquí y en ningún otro
      sitio: los manejadores guardan el estado tal cual y no deciden nada. Así "¿qué corta hoy?" se
      responde leyendo un sitio.
      `trialing`, `incomplete` y `paused` **no** cortan (dentro de lo pactado / alta en curso / lo pausa
      el propietario, que ya tiene `isActive` si quiere cortar). Un estado desconocido tampoco corta.
      **Efecto colateral corregido:** el comentario de `isActive` afirmaba ser "el kill switch del
      IMPAGO". Era cierto mientras fueron el mismo booleano; ahora contradecía a §D3 y estaba a dos
      líneas del corte nuevo. Reescrito para que diga qué es cada columna y por qué se separaron.
- [x] **T5.3** Aplica **a los dos modos de credencial**, igual que `isActive`: traer tu clave no es
      dejar de pagar la suscripción (`token-metering.ts:85`).
      El corte va antes de la bifurcación por `credentialMode`, así que byok no puede esquivarlo.
- [x] **T5.4** `stripe-gate-impago.test.ts`: E4, E5. Incluye byok. **12 tests verdes.**
      Además de E4/E5: que los **tres** mensajes son textos distintos (AC7 — si el impago reutilizara el
      de suspensión todos los tests de comportamiento pasarían igual y el cliente seguiría sin saber que
      tiene que pagar); que el impago gana al cupo pero **pierde** contra la suspensión manual; que con
      `null` siguen cortando `isActive` y el cupo (el fail-open está acotado a esa columna); y que un
      `select` viejo sin la columna (`undefined`) tampoco corta.
- [x] **T5.5** Suite completa del back verde (hoy: 131 ficheros / 1465 tests).
      **137 ficheros / 1559 tests pasando, 3 skipped.** Los 2 fallos de la primera pasada
      (`market-study.test.ts`, `market-study-pro.test.ts`) son **timeouts de 5 s bajo carga**, no fallos
      reales: los dos ficheros pasan en aislamiento (2,4 s y 5,3 s) y no tocan nada de este eje.
      Preexistentes y ajenos a H6.

## T6 — Alta de suscripción

- [x] **T6.1** `POST /api/clients/:id/subscription/checkout`. Body: **sólo `serviceId`**. Zod con
      `.strict()` para que un `amount` colado sea un 400, no un campo ignorado en silencio.
      La lógica vive en `lib/stripe/checkout.ts`, separada de la ruta igual que `sync-catalog.ts` de su
      CLI: así los tests ejercitan el alta de verdad y no un handler con cinco dobles alrededor.
- [x] **T6.2** `requireRole("admin", "member")` (§D7). Es trabajo comercial, así que `member` entra;
      `client` queda fuera y el portal de H5 no gana ningún endpoint de cobro.
- [x] **T6.3** `quantity = countBillableAgents(tenantId)`; `priceId` del mapa. Sin fila en
      `StripePriceMap` → 409 fail-closed que dice ejecutar `npm run stripe:sync`; crear el `Price` al
      vuelo convertiría cada alta en una siembra silenciosa de tarifas en Stripe. Con 0 agentes
      facturables → 409: una suscripción de 0 € habría que corregirla a mano después.
      El `stripeCustomerId` se persiste **antes** de abrir la sesión (un checkout abandonado si no
      dejaría el historial del cliente partido entre dos `Customer`).
- [x] **T6.4** `stripe-checkout-precio-servidor.test.ts`: E9, E10, E12. 19 verdes.
      **Dos defectos de spec corregidos en `validation.md` antes de escribir el test** (notas de
      corrección con fecha en E9 y E10):
      · **E9 contradecía a T6.1** — decía que la sesión se creaba ignorando el `amount`; con `.strict()`
        es un 400 sin sesión, que es más fuerte.
      · **E10 era imposible** — premisa "1 agente con `isTest = true`", pero `Agent` no tiene esa
        columna: `isTest` está en `Conversation` (`schema.prisma:579`). El test escrito tal cual habría
        pasado en verde con un filtro roto. Reescrito sobre `status` + añadido el caso `suspended`,
        que **sí** factura.
- [ ] **T6.5** Smoke real con claves de test: alta → webhook real → estado en base de datos.
      **Bloqueado por T0.4.**

## T7 — RETIRADA

La implantación se factura con el módulo de facturas de AA (T0.3, §D9). No hay tarea de cobro único.
Lo único que queda de esto es el test de AC17 en T2.4/T4.4: que `implPrice` **no** llegue nunca a
Stripe.

## T8 — Verificación y cierre

- [x] **T8.1** `tsc --noEmit` verde en `back/` y `front/`. Ambos exit 0 (27/07/2026).
- [x] **T8.2** Suite del back: **1573 verdes, 3 skipped, 7 rojos**. Los 7 son `Test timed out in
      5000ms` en `market-study.test.ts`, `market-study-pro.test.ts` y `market-study-concrete.test.ts`,
      y **ninguno toca H6**. Comprobado que es carga y no regresión: `market-study-pro.test.ts` en
      solitario da 26/26 en 9,86 s y en la suite completa se cae. Deuda registrada, no de este eje:
      esos tests no fijan `testTimeout` y el más lento gasta ~3,7 s de un presupuesto de 5.
      Los 6 ficheros de H6 (`stripe-*.test.ts`) van 100 % verdes.
      **Playwright NO se ha ejecutado, a propósito.** `git status front/` da cero cambios: H6 no toca
      una sola línea del front, y el `webServer` de `playwright.config.ts` levanta `npm run dev` en la
      carpeta del usuario, que es justo lo que corrompe `.next`. Correrlo sería asumir un riesgo real a
      cambio de cobertura nula sobre este eje.
- [x] **T8.3** **AC16** — `/api/portal/me` sigue sin importes. Único acierto de la búsqueda de
      `price|amount|importe|coste|maint|impl|€|tarifa` en `routes/portal.ts`: el comentario de las
      líneas 58-59 que declara justamente eso. Sólo viaja el `codigo` del plan.
- [x] **T8.4** **AC15** — cero `fetch(`, cero `new Stripe(`, cero `nock`/`msw` en los seis
      `tests/stripe-*.test.ts`. El único HTTP es un `express` en `127.0.0.1` con puerto efímero para
      probar la ruta, que no sale de la máquina.
- [x] **T8.5** Barrido limpio. Ningún importe literal en `src/lib/stripe/` ni en
      `routes/service-stripe.ts`. `implPrice` aparece en el código de Stripe **una sola vez**, y es un
      comentario en `sync-catalog.ts:97` diciendo que no entra ahí (AC17).
- [x] **T8.6** Verificación hecha **en línea**, no delegada a sub-agente (el uso del Agent tool no está
      pedido en esta sesión). Repasado: diff de `index.ts` / `package.json` / `schema.prisma`,
      migración contra esquema, captura de `rawBody` en `index.ts:107` **anterior** al montaje de
      `/service/stripe` en la 128 y anterior al gate de auth, y los barridos de T8.3-T8.5.
- [x] **T8.7** Resumen de scope caveman + Engram + memoria de fichero. Commit `0678cf2` en
      `ac/aa-agente-ciclo-vida-publicacion`, **sin push**.

## Gates de despliegue (no son tareas de código)

- [x] **G1** Migración de T1.3 **APLICADA en producción** el 27/07/2026, con aprobación explícita del
      propietario. `prisma migrate deploy` → 14/14 aplicadas; `migrate status` → "Database schema is up
      to date!". Verificado contra la base real (schema `aa`, pooler de Supabase): las tres columnas
      existen y son NULLABLE, `stripe_evento` y `stripe_precio_mapa` creadas, y **15 tenants con
      `estado_suscripcion` NULL, 0 cortados por impago**. Eso último es el punto entero del fail-open
      acotado de §D3: desplegar esto no deja mudo a nadie.
- [ ] **G2** `stripe:sync` en modo `test` primero; `live` sólo tras aprobación explícita.
- [ ] **G3** Registrar la URL del webhook en el panel de Stripe y guardar el
      `STRIPE_WEBHOOK_SECRET` en Render. **El secreto es distinto en test y en live.**
- [ ] **G4** `stripe:check` verde contra `live` antes de dar de alta al primer cliente real.

## Notas

- **Deuda que este change NO cierra:** las recargas `tokens_5m` (17 €) y `tokens_10m` (30 €) siguen
  sin conectar al cupo. El motivo está en `proposal.md`: el único sitio donde cabrían hoy es
  `tokenBalance`, que es el override, y escribir ahí desactivaría el plan del tenant de forma
  permanente e invisible. Necesitan columna propia acumulable por periodo — otro change.
- **`schema.prisma:138` queda desactualizado** por §D1: dice que el importe de verdad está en Stripe,
  y a partir de este change Stripe es el ejecutor, no la fuente. Se corrige el comentario en T1.1.
