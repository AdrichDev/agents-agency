# aa-cupo-defecto-y-avisos (H7 · va ANTES de H5)

## Intención

Que un cliente nuevo **nazca con 10M tokens al mes** sin que nadie toque la base, y que cuando se le
acaben lo sepa **antes** de que su agente se quede mudo delante de un cliente suyo.

## El problema (medido en producción, 27/07/2026)

Consumo real de toda la plataforma, del 16/06 al 18/07:

| Métrica | Valor |
|---|---|
| Tokens gastados por todos los agentes | 111.561 |
| Interacciones registradas | 36 |
| Media por interacción | ~3.100 tokens |
| Agente que más gastó | 58.489 (0,58% de 10M) |

10M no es carta blanca: es ~3.200 interacciones al mes, unas 107 al día. Un negocio con tráfico real
puede llegar. Es un techo sano. *Aviso sobre el dato: los 14 agentes de prod son pruebas del
propietario; tráfico de cliente real medido, cero.*

Y el estado de los cupos:

| Hecho | Valor |
|---|---|
| Tenants con `saldo = 10.000.000` | 11 de 15 |
| Tenants con `saldo = 0` (bloqueados a mano, a propósito) | 4 |
| Filas en la tabla `plan` | 0 |

De ahí salen los dos agujeros:

1. **Un tenant nuevo nace muerto, no con carta blanca.** `tokenBalance` llega `NULL`, no hay plan, y
   `resolveTokenQuota` devuelve `{limit: 0, source: "none"}` ⇒ el gate lanza 402 *"Este asistente no
   tiene un plan de uso asignado"* (`token-metering.ts:112`). Das de alta un cliente y su agente no
   responde hasta que alguien entre a la base a ponerle el saldo a mano. Eso es lo que hacen los 11
   tenants con 10.000.000: un valor puesto a mano, once veces.
2. **El corte es binario y silencioso.** Se pasa de "todo bien" a 402 sin ningún aviso intermedio. El
   que se come el silencio no es el cliente: es **el cliente final del cliente**, un desconocido que
   estaba preguntando un precio. Y tu cliente se entera por una queja.

## Alcance

**Dentro:**

1. **Cupo por defecto de 10M por agente activo y periodo**, aplicado cuando el tenant no tiene ni
   override ni plan. Una constante de plataforma, no una fila en la base.
2. **El mismo defecto a nivel de agente**: cada agente tiene su propio tope de 10M. Con 3 agentes el
   tenant tiene 30M, pero uno solo no se puede comer los 30.
3. **Avisos al 75% y al 90%**, corte al 100%.
4. Superficie en el panel de Clientes (el portal de H5 lo consumirá después).
5. Desaparece el estado "sin plan": deja de ser alcanzable, así que se retira del código, de los
   tipos y de la UI en vez de quedarse como rama muerta.

**Fuera:**

- Notificar por email o Telegram. Los avisos son de **lectura** (panel/portal). Notificar exige
  guardar qué aviso ya se mandó para no repetirlo cada mensaje, y eso es un change con estado
  propio.
- Vender recargas (`tokens_5m` 17€, `tokens_10m` 30€ del catálogo). Es H6.
- Sembrar filas en `plan`. Sigue vacía, y con este change deja de hacer falta para operar.
- Unificar los catálogos de precios duplicados (front vs back). Deuda ya registrada en H5 R5.

## Decisión: constante de plataforma, no valor escrito al crear el tenant

Las dos formas de dar 10M a un cliente nuevo:

| | Constante en código | Escribir `saldo = 10M` al crear |
|---|---|---|
| Cambiar la política | Un sitio, afecta a todos | Una migración de datos por cada tenant existente |
| Coste en el gate | Un `count` de agentes por mensaje cuando no hay override | Ninguno |
| Qué significa `NULL` | "la política de la plataforma" | "un tenant roto" |

Se elige la **constante**. El número es una política, y una política duplicada en 200 filas no es una
política: son 200 valores que hay que creerse. El `count` extra está indexado y ya se paga hoy para
los tenants gobernados por plan.

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **Aflojar el gate del dinero.** Pasar de "sin plan ⇒ cortado" a "sin plan ⇒ 10M" abre servicio a quien antes no lo tenía. | Los 4 tenants con `saldo = 0` **siguen bloqueados**: `0` es un valor, no un hueco, y gana al defecto. Test explícito de que el kill switch no se invierte. Y los 15 tenants actuales tienen override ⇒ impacto cero hoy. |
| R2 | Tercera copia del número 10M: ya existe `PLAN_TOKENS = 10_000_000` en `front/components/presupuestos/types.ts:13`. | Test que lee el fichero del front desde disco y comprueba que coincide con la constante del back. Si alguien cambia uno, el test cae. |
| R3 | Coste nuevo en el gate: el tope por agente obliga a una suma por mensaje para tenants sin plan (o sea, todos hoy). | Acotada por periodo y por el índice `(agente_id, creado_en)` que ya creó H4 T5. Se mide antes de cerrar. |
| R4 | Un aviso al 75% que nadie ve no es un aviso. | Este change sólo entrega la lectura y lo declara así. El aviso empujado (email/Telegram) queda fuera y **declarado**, no insinuado como hecho. |

## Dependencias

- **Depende de:** H4 `aa-planes-y-cuotas` (cerrada) — periodo, override nullable, `resolveTokenQuota`,
  `sumAgentPeriodUsage`.
- **Bloquea:** H5 `aa-portal-cliente` (el portal debe enseñar números ya correctos) y H6 (la recarga
  se vende contra estos umbrales).
- **Migración:** **ninguna.** Todo es código y constantes.

## Nivel

**Nivel 3.** ~6 ficheros (2) + cruza back y front (2) + cambia el gate que decide si un agente
responde en producción (2) = 6 puntos. Sin migración. Revisión obligatoria antes de commit; sin push.
