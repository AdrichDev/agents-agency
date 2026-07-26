# Tasks — `aa-planes-y-cuotas`

Regla del repo: **una tarea es DONE sólo con su test verde.**

Este change entrega **F1 (C.1)** y **la medición (C.2)**. Las fases con migración (C.3-C.5)
están especificadas y **deliberadamente sin implementar**: dependen del gate humano de T2.2.

## T1 — Separar estado de pago de estado de cupo (F2, sin migración)

- [x] **T1.1** — `token-metering.ts`: eliminada la desactivación automática por agotamiento
  (antiguas líneas 101-102). El bloqueo se mantiene por la comparación de saldo de
  `checkClientBalance`, que ya lo cubre; lo que desaparece es el efecto colateral sobre el estado
  administrativo. Al quitar la segunda escritura, el `select` de la transacción sobra y se retira.
  *Test:* `tests/planes-estados-separados.test.ts` → `deductTokens` hace UNA sola escritura sobre
  el tenant (la de la transacción) y ninguna toca `isActive`; el cupo agotado sigue lanzando 402.
- [x] **T1.2** — `clients.ts`: `isActive` sólo cambia si viene explícito en el body; eliminada la
  inferencia `?? tokenBalance > current.tokensUsed`.
  *Test:* `tests/planes-credits-route.test.ts` → 5 casos (subir saldo no reactiva; bajarlo no
  suspende; `isActive` explícito manda en los dos sentidos; 404 sin escribir).
- [x] **T1.3** — Separado el motivo del 402: cuota agotada y cuenta suspendida dejan de compartir
  mensaje, sin exponer detalle interno. Un cliente borrado se reporta como desactivado (no se
  filtra que no existe). Con ambas condiciones, se reporta la suspensión: es el hecho
  administrativo.
  *Test:* 6 casos en `planes-estados-separados.test.ts`.
- [x] **T1.4** — *(hallazgo al implementar, no previsto)* `isActive` es también el filtro de
  "cliente vigente" en `service-operator.ts`, así que agotar cupo tenía tres efectos ajenos al
  consumo: el cliente desaparecía de `listClientesHandler` (`:352`), falseaba el contador
  `tenantsActivos` de `estadoHandler` (`:55`) y —esto es un **bug**— hacía que `bajaCliente`
  (`:482`, `updateMany({where: {id, isActive: true}})`) devolviera `count = 0`, que el handler
  interpreta como "no existe o ya estaba dado de baja": **no se podía dar de baja a un cliente con
  el cupo agotado**. Los tres quedan corregidos por T1.1, sin tocar `service-operator.ts`.
  *Test:* `tests/service-operator-crud.test.ts` sigue verde sin cambios (el bug no estaba cubierto
  por ningún test: sólo se manifestaba con cupo agotado, estado que ningún test montaba).
- [x] **T1.5** — Regresión: los tres suites de H1 verdes **sin cambiar una sola expectativa**.
  Confirma que la desactivación automática no estaba cubierta por ningún test.
  *Test:* `npm test` completo verde en `back/`: 104 ficheros, 1070 pasan, 3 skipped
  (antes de T1: 102 / 1058 / 3).

## T2 — Medición de coste real (gate del resto del change)

- [x] **T2.1** — `back/scripts/measure-token-cost.ts`, **sólo lectura**: coste y tokens por
  conversación (media/mediana/p90/max), por tenant, por agente, por modelo y por `operacion`;
  conversaciones reales sin ninguna fila de consumo. Tarifa por modelo como entrada explícita en el
  propio fichero, con `TARIFA_FECHA` **que el propietario debe rellenar al verificar los precios**
  (hoy vale `"sin verificar"`, y el script lo dice en voz alta). Si algún token es de un modelo sin
  tarifa, **no se imprime coste agregado** (T6.1). Proporción entrada/salida asumida y ajustable con `--out-ratio`,
  porque `total_tokens` no la distingue (§B.1). `npm run measure:cost` (`--days=N`, `--all`).
  *Test:* no automatizable sin BD (mismo caso que el inventario de H1); typecheck verde.
- [x] **T2.2a** — Tarifas verificadas contra los proveedores (27/07/2026) y `TARIFA_FECHA`
  rellenada: `developers.openai.com/api/docs/pricing` (gpt-5.6-luna 1/6, gpt-5.5 5/30, gpt-5.4
  2.5/15, gpt-5.4-mini 0.75/4.5, gpt-5.4-nano 0.2/1.25 USD/1M in/out) y
  `ai.google.dev/gemini-api/docs/pricing` (tier Standard, ≤200k, texto: 3.1-pro 2/12,
  3.5-flash 1.5/9, 3-flash-preview 0.5/3, 3.1-flash-lite 0.25/1.5). `gpt-4o` queda como tarifa
  heredada (2.5/10): ya no figura en la página. Cobertura de tarifa: **100%**.
- [x] **T2.2b** — Medición ejecutada contra producción (27/07/2026, `back/.env`):

  ```
  === Histórico completo, out-ratio 0.6 ===
  Por modelo:  gpt-4.1-nano 58.489 tok | gpt-5.4-mini 25.910 | gpt-4.1-mini 20.853 | gpt-4o 6.309
  Por conversación (n=11):  media 10.142 tok / $0.0147 · mediana 3.819 · p90 22.668 / $0.0328
                            máx 35.821 tok (≈ $0.052)
  Por operación:  (chat) 100% — CERO consumo de automatizaciones
  Totales:  111.561 tokens · $0.1616 · tarifa media ponderada $1.45/1M
  11 de 15 conversaciones reales SIN ninguna fila de consumo
  ```

  Con `--out-ratio=0.3` y ventana de 30 días: 53.072 tokens, $0.0944, media por conversación
  $0.0105, p90 $0.0371.

  **Lectura honesta: esto no es una muestra de mercado, es el dataset de desarrollo.** 11
  conversaciones con consumo en toda la historia, 4 clientes, y buena parte del gasto es la
  consola de pruebas del operador. Sirve para el **orden de magnitud** —una conversación cuesta
  entre 1 y 5 céntimos de dólar con los modelos mini/nano— y para dimensionar cupos; no sirve
  para estimar consumo real de un cliente en producción, que sólo se sabrá con clientes de verdad.
  Dos consecuencias inmediatas y sólidas:
  - `DEFAULT_TOKEN_BALANCE = 10_000_000` equivale a ~$15-30 de LLM regalados por cliente y a
    cientos de meses de uso al ritmo observado. F3 confirmado con número.
  - Un cupo de **1M tokens/mes** cuesta $1,45-1,87 de LLM y da del orden de 100-260
    conversaciones. El coste de LLM **no** es el factor que fija el precio: lo son infraestructura,
    soporte y voz. Eso cambia el enfoque de T4.
- [ ] **T2.2c** — **HUMAN GATE (abierto).** Falta la única parte que no es medible: **cuánto
  cobrar** y **qué cupo lleva cada plan**. Decisión de negocio, del propietario.
  *Bloquea:* T3, T4, T5 y H6 completos.

## T3 — Cuota por periodo (BLOQUEADA por T2.2 — migración)

- [ ] **T3.1** — Migración aditiva en `Tenant`: `periodStart`, `tokensUsedPeriod`. `tokensUsed`
  se conserva como acumulado de por vida (no se recalcula: sería destruir historia).
- [ ] **T3.2** — Renovación perezosa en la comprobación de cupo: si el periodo venció, avanzar
  ancla y poner el contador a cero antes de decidir. Idempotente, sin cron.
  *Test:* periodo vencido ⇒ el tenant vuelve a poder consumir sin intervención; dos llamadas
  concurrentes no renuevan dos veces.
- [ ] **T3.3** — El gate compara contra `tokensUsedPeriod`; `deductTokens` incrementa los dos
  contadores en la transacción que ya existe.
  *Test:* consumo de un periodo no cuenta contra el siguiente.
- [ ] **T3.4** — Reconciliación: comprobar el contador contra `SUM(uso_tokens)` del periodo y
  reportar deriva (`uso_tokens` es la fuente de verdad).

## T4 — Modelo `Plan` (BLOQUEADA por T2.2 — migración)

- [ ] **T4.1** — Modelo `Plan` (código, nombre, precio, cupo por periodo, límite de agentes,
  activo) + `Tenant.planId` opcional.
- [ ] **T4.2** — Retirar `DEFAULT_TOKEN_BALANCE`: el cupo sale del plan; sin plan, cupo **cero**
  (fail-closed, coherente con H1).
  *Test:* tenant nuevo sin plan no puede consumir; con plan recibe el cupo del plan.
- [ ] **T4.3** — Admitir plan con cupo de tokens nulo **sin** que signifique bloqueado: es el
  hueco de BYOK (H2), que cobra plataforma y no consumo. Sólo el hueco; la semántica es de H2.

## T5 — Cuota por agente (BLOQUEADA por T2.2 — migración)

- [ ] **T5.1** — Límite opcional por agente sobre el `agente_id` que `uso_tokens` ya registra.
  *Test:* un agente que agota su límite no consume el cupo de sus hermanos.

## T6 — Hallazgos de `sdd-verify` (27/07/2026)

- [x] **T6.1** — *(CRITICAL)* El instrumento de medición no tarifaba **ninguno** de los modelos que
  la plataforma usa por defecto: `TARIFA` cubría 5 modelos `gpt-4*`, y el catálogo real
  (`src/lib/model-capabilities.ts`) son 14, con `gpt-5.4-mini` como default del wizard. Resultado:
  todas las columnas de coste imprimían `$0.0000` y el aviso de "subestimado" era fácil de pasar
  por alto ⇒ el gate T2.2 se habría decidido sobre un informe de ceros. Arreglo: el mapa `TARIFA`
  replica el catálogo con `null` explícito en lo no tarifado, y el script es **fail-closed**: si
  algún token es de un modelo sin tarifa, no imprime coste agregado; imprime la cobertura (%), la
  tabla de modelos que faltan con sus tokens, y dice que T2.2 no puede resolverse todavía.
  *Test:* typecheck; verificación funcional del propietario al ejecutarlo (misma condición que T2.1).
- [x] **T6.2** — *(WARNING)* Dos totales incoherentes en el mismo informe: el total sólo sumaba los
  tokens tarifados, pero los cortes por `operacion`/tenant/agente multiplicaban **todos** sus
  tokens por la tarifa media, así que sus sumas superaban al total. Garantizado en producción: las
  filas `crm_generate` que escribe `creador_CRM` llevan `modelo = NULL`. Arreglo: esos cortes usan
  un único helper que devuelve "—" mientras la cobertura no sea total, así que ya no hay dos
  aritméticas conviviendo. También: `mediana` real (con n par promedia los dos centrales),
  y `--days` / `--out-ratio` validados (un `--out-ratio=-1` daba tarifas negativas).
- [x] **T6.3** — *(WARNING)* El detector de "conversaciones sin consumo" cruzaba dos poblaciones
  distintas: conversaciones no-test filtradas por su fecha, contra conversaciones con consumo
  agrupadas por la fecha del consumo e **incluyendo las de la consola de pruebas**. El delta salía
  subestimado y podía desaparecer justo la señal que `design.md §C.2` quiere. Arreglo: se cruzan
  los ids reales del periodo contra los que tienen consumo.
- [x] **T6.4** — *(WARNING)* El kill switch manual estaba **inoperable desde el panel**, y T1 lo
  convierte en la única vía de suspensión: `front/components/TokenSwitch.tsx:34` manda sólo
  `{isActive}` y `creditsSchema` exigía `tokenBalance` ⇒ 400 tragado por un `console.error`.
  Arreglo: los dos campos son opcionales y sólo se escribe el que venga; un body vacío se rechaza
  con 400 (un update sin campos no es una operación).
  *Test:* 2 casos nuevos en `planes-credits-route.test.ts` (sólo `isActive`; body vacío).
- [x] **T6.5** — *(WARNING)* El guard de T1.1 **no discriminaba**: el mock de `$transaction`
  devolvía `[{}, {}]`, así que la condición del código eliminado
  (`client.isActive && client.tokensUsed >= client.tokenBalance`) evaluaba `undefined && …` ⇒ falsa,
  y el test habría pasado también contra la implementación vieja. Arreglo: el mock devuelve un
  tenant activo y pasado de cupo, que es el caso en que la rama vieja sí escribía.
- [x] **T6.6** — *(CRITICAL, documental)* La afirmación "la desactivación es redundante, no hay
  ventana de servicio gratis" sólo valía dentro de `agents-agency/back`. `creador_CRM` gatea por
  `aa.tenant.activo` con SQL directo y sin comprobar saldo. Acotada la afirmación en
  `proposal.md` y registrado el efecto cruzado en Risks + deuda (abajo).

## Deuda anotada, fuera de alcance

- **Sólo se guarda `total_tokens`** (`engine.ts:466`): entrada y salida no se distinguen y
  cuestan distinto (~4× en `gpt-4o`), así que el coste medido es una estimación con tarifa mixta.
  Suficiente para poner precio con margen; insuficiente para reconciliar la factura del proveedor
  al centavo. Guardar `prompt_tokens`/`completion_tokens` es change aparte (migración de
  `uso_tokens`). Ver `design.md §B.1`.
- **El kill switch no corta las vías sin LLM** (`/api/leads/kickoff`, `/api/booking/reserve`,
  `/api/public/leads`): heredado de H1. Un cliente impagado sigue recibiendo esos servicios. No
  es agujero de coste de tokens, pero sí de servicio ⇒ resolver en H3 o aquí en T3.
- **`creador_CRM` no comprueba saldo** *(T6.6)*: `POST /api/projects` gatea sólo por
  `aa.tenant.activo` (`create-project-service.ts:78`), así que un cliente con el cupo agotado —pero
  al día— puede crear proyectos. Es la misma clase de agujero que el punto anterior, en otro repo, y
  se cierra con la misma decisión: qué servicios corta el cupo y cuáles sólo el impago. Nada de
  esto consume tokens.
- **Nadie ve ya "clientes sin cupo" a nivel plataforma**: `estadoHandler` cuenta por `isActive`, que
  tras T1 ya no baja al agotarse el cupo, así que un cliente bloqueado por cuota se muestra sano.
  Es pérdida de visibilidad, no de control (el 402 sigue). La métrica correcta
  (`tokensUsed >= tokenBalance`) va con el panel de consumo de H5.
- **Otros recursos sin tarifa**: almacenamiento de conocimiento y minutos de voz no se miden ni
  se cobran.

## Verificaciones finales

- [x] **V1** — `npx tsc --noEmit` verde en `back/`.
- [x] **V2** — `npm test` verde en `back/`: **104 ficheros, 1072 pasan, 3 skipped** (los 3 skips
  son preexistentes; antes de este change: 102 / 1058 / 3; antes de T6: 104 / 1070 / 3).
- [x] **V3** — Sin migración en la parte entregada (T1+T2): `back/prisma/schema.prisma` y
  `back/prisma/migrations/` intactos.
- [x] **V4** — `sdd-verify` ejecutado: veredicto inicial **NO PASA** con 2 CRITICAL y 6 WARNING.
  Los dos CRITICAL se comprobaron contra el código antes de aceptarlos (los dos eran reales) y
  quedan resueltos en T6. La aritmética del script se verificó correcta (unidades de `tarifaMedia`
  en USD/token, percentiles nearest-rank, sin división por cero); los fallos eran de honestidad del
  informe, no de álgebra.

## Orden crítico

```
T1 (desplegable solo) → T2.1 → T6 (verify) → T2.2a/b (medido) → [T2.2c HUMAN GATE] → T3 → T4 → T5 → H6
```

De T2.2 ya está hecho todo lo que se puede medir: tarifas verificadas y coste real de producción.
Lo que queda es una decisión de negocio, no un dato que falte.

T1 no depende de ninguna decisión de negocio y cierra el agujero de cobro antes de que exista
Stripe. Todo lo que lleva precio espera a T2.2: escribir planes con precios inventados es
exactamente lo que `design.md §A` prohíbe.
