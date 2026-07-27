# Validación — aa-cupo-defecto-y-avisos (H7)

## Historia de usuario

> Como **propietario de la plataforma**, quiero que un cliente nuevo empiece con 10M tokens al mes sin
> que yo entre a la base a ponérselos, y que se le avise al 75% y al 90% antes de cortarle al 100%,
> para que su agente no se quede mudo delante de un cliente suyo sin previo aviso.

Y la contrapartida, que es lo que hace delicado el change:

> Como propietario, quiero que **aflojar el gate no desactive el freno de mano**: los clientes que
> bloqueé a mano siguen bloqueados.

## Criterios de aceptación

| AC | Enunciado | Test |
|---|---|---|
| AC1 | Tenant sin override y sin plan ⇒ cupo `10M × max(1, agentes facturables)`, `source: "default"`. | T1 |
| AC2 | `tokenBalance = 0` **sigue bloqueando**. El defecto no gana al kill switch. | T1 |
| AC3 | `tokenBalance` con valor sigue ganando al plan y al defecto. | T1 |
| AC4 | Plan con `tokenQuotaPerAgent = null` sigue siendo **sin tope**, no cae al defecto. | T1 |
| AC5 | `source: "none"` no existe: ningún dato de entrada lo produce. | T1 |
| AC6 | El 402 *"no tiene un plan de uso asignado"* ya no se lanza nunca. | T2 |
| AC7 | Un agente sin plan tiene tope propio de 10M: se corta él y sus hermanos siguen respondiendo. | T2 |
| AC8 | `quotaWarningLevel` da `warn75` en el 75%, `warn90` en el 90% y `exhausted` en el 100%, con `>=`. | T3 |
| AC9 | Sin tope (`null`) ⇒ `ok`. Cupo `0` ⇒ `exhausted` sin dividir. | T3 |
| AC10 | El nivel de aviso coincide con el corte del gate: no existe consumo en el que el gate corte y el aviso diga `ok`. | T3 |
| AC11 | La constante del back coincide con `PLAN_TOKENS` del front. | T4 |
| AC12 | Los 15 tenants actuales (todos con override) no cambian de cupo ni pagan consultas nuevas. | T1 |

## Escenarios Given-When-Then

### E1 — Cliente nuevo nace vivo

```gherkin
Dado un tenant recién creado con tokenBalance NULL y sin plan
  Y un agente publicado
Cuando su agente recibe un mensaje
Entonces el gate NO lanza 402
  Y su cupo resuelto es 10.000.000 con source "default"
```

### E2 — El freno de mano sigue puesto

```gherkin
Dado un tenant con tokenBalance = 0 y sin plan
Cuando su agente recibe un mensaje
Entonces el gate lanza 402 con el motivo de cupo agotado
  Y el cupo resuelto es 0, no 10.000.000
```

### E3 — Un agente no se come el cupo de sus hermanos

```gherkin
Dado un tenant sin override y sin plan con 3 agentes publicados
  Y el agente A lleva 10.000.000 tokens consumidos en el periodo
  Y el agente B lleva 100
Cuando el agente A recibe un mensaje
Entonces se corta con el motivo de tope de agente
Cuando el agente B recibe un mensaje
Entonces responde
```

### E4 — El aviso no contradice a la máquina

```gherkin
Dado un cupo de 1.000 y un consumo de 1.000
Cuando se calcula el nivel de aviso
Entonces es "exhausted"
  Y el gate también corta con ese mismo consumo
```

### E5 — Umbrales exactos

```gherkin
Dado un cupo de 1.000
Cuando el consumo es 749  entonces el nivel es "ok"
Cuando el consumo es 750  entonces el nivel es "warn75"
Cuando el consumo es 899  entonces el nivel es "warn75"
Cuando el consumo es 900  entonces el nivel es "warn90"
Cuando el consumo es 999  entonces el nivel es "warn90"
Cuando el consumo es 1000 entonces el nivel es "exhausted"
```

### E6 — El número anunciado es el número aplicado

```gherkin
Dado DEFAULT_TOKEN_QUOTA_PER_AGENT en back/src/lib/quota.ts
  Y PLAN_TOKENS en front/components/presupuestos/types.ts
Cuando se comparan
Entonces son iguales
```

## Un test por tarea

| Tarea | Test | Fichero |
|---|---|---|
| T1 resolución con defecto | AC1-AC5, AC12 (E1, E2) | `back/tests/cupo-defecto-resolucion.test.ts` |
| T2 gate | AC6, AC7 (E3) | `back/tests/cupo-defecto-gate.test.ts` |
| T3 umbrales | AC8-AC10 (E4, E5) | `back/tests/cupo-avisos-umbrales.test.ts` |
| T4 coherencia de la constante | AC11 (E6) | `back/tests/cupo-defecto-front-back-coherencia.test.ts` |
| T5 panel | el panel enseña el aviso y ya no existe la etiqueta `SIN PLAN` | revisión visual + `tsc` en `front/` |

## Fuera de alcance de esta validación

- Notificación empujada (email / Telegram) de los avisos: los avisos son de lectura.
- Venta de recargas `tokens_5m` / `tokens_10m`: H6.
- Portal del cliente: H5, que va después y consumirá estos mismos números.
