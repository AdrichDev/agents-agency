# Validation — `aa-agente-ciclo-vida-publicacion`

## Historia de usuario

> Como propietario de la plataforma, quiero decidir **cuándo** un agente empieza a atender al
> público, para poder probarlo antes sin exponerlo, apagarlo sin suspender al cliente entero, y
> cobrar por los agentes que están vendidos y no por los borradores.

Y su contraparte, que es la que hoy falla:

> Como cliente que paga por un asistente, quiero que lo que no está publicado no me lo cobren, y que
> apagar un asistente no apague los otros tres que tengo funcionando.

## Criterios de aceptación

- **AC1** — Un agente recién creado queda en `draft` y **no** atiende tráfico real: ni chat público,
  ni config de widget, ni reservas, ni leads.
- **AC2** — La consola de pruebas del operador **sí** funciona contra un `draft`. La exención se
  honra sólo con sesión de operador: `test: true` sin sesión no exime (regresión de la defensa de
  `ai.ts:70-75`).
- **AC3** — Publicar es una acción explícita con endpoint propio. El `PATCH` general de agente no
  puede cambiar el estado: guardar un formulario no factura.
- **AC4** — Publicar exige tenant y prompt no vacío. Si falta algo, 400 diciendo **qué** falta
  (fail-closed, no publicación a medias). Un canal de mensajería sin conexión **avisa** pero no
  bloquea: el inventario de T0.1 demostró que 3 de los 6 agentes que hoy sirven en producción tienen
  `channel = "whatsapp"` sin conexión y funcionan por widget/API.
- **AC5** — Un borrador con el cupo agotado recibe el motivo "no publicado", no "sin cupo": el
  operador tiene que leer lo que debe arreglar, no una pista falsa.
- **AC6** — Despublicar devuelve el agente a `draft` y **no** a `suspended`. Despublicar es del
  propietario; suspender es de la plataforma. Los dos callan el agente, pero no significan lo mismo
  para la factura.
- **AC7** — Existe un recuento facturable derivado del estado (`published` + `suspended`), sin
  contador materializado que pueda desincronizarse de la realidad.
- **AC8** — Cada cambio de estado deja rastro (`from`, `to`, actor, fecha). Sin rastro no se puede
  responder "¿estuvo publicado en junio?", que es la pregunta de la factura.
- **AC9** — Publicar es idempotente: dos publicaciones seguidas no duplican evento ni pisan la fecha
  de primera publicación.
- **AC10** — Un agente que estuvo publicado no se borra en duro: se archiva. Un `draft` se sigue
  borrando como hoy.
- **AC11** — La migración es aditiva y deja **todos** los agentes existentes en `draft` con
  `publishedAt = NULL`. No hay ningún agente de cliente (T0.2), así que publicar cualquiera de ellos
  en el backfill sería marcar como facturable algo que nadie compró.
- **AC12** — El front no ofrece nunca un control de estado que no corte tráfico de verdad: el botón
  llega después del gate.
- **AC13** — La tarjeta de agente muestra el estado del **agente**. El kill switch del **tenant** no
  vive en la ficha de un agente.
- **AC14** — Regresión cero sobre H1: el gate fail-closed de saldo, el cobro contra el tenant de BD y
  la exención acotada de la consola siguen funcionando igual.

## Escenarios (Given-When-Then) — uno por tarea

### T0.1 — inventario antes de tocar nada

```
Dado el estado actual de producción
Cuando el propietario ejecuta npm run inventory:agent-status
Entonces obtiene, por agente, el estado destino y el motivo
  y un recuento por estado
  sin escribir nada en la base de datos
```

### T1.2 — el backfill es el default, y eso es deliberado

```
Dados tres agentes: uno con tenant y conversaciones reales,
  uno con tenant y sin conversaciones, y uno sin tenant
Cuando se aplica la migración
Entonces los TRES quedan draft con publishedAt = NULL
  porque ninguno es de un cliente (T0.2) y publicar en el backfill
  sería marcar como facturable algo que nadie compró
```

### T2.1 — el borrador no atiende (AC1, AC5)

```
Dado un agente en draft
Cuando llega un mensaje por su clave pública
Entonces no se llama al LLM y el motivo es "no publicado"
```

```
Dado un agente en draft cuyo tenant además tiene el cupo agotado
Cuando llega un mensaje
Entonces el motivo sigue siendo "no publicado", no "sin cupo"
```

### T2.2 — la consola sí, el impostor no (AC2)

```
Dado un agente en draft
Cuando el operador le escribe desde la consola de pruebas con su sesión
Entonces el agente responde
```

```
Dado el mismo agente en draft
Cuando alguien sin sesión manda test:true con su clave pública
Entonces recibe 403: la exención de pruebas no es un agujero público
```

### T2.3 — la config del widget no filtra borradores

```
Dada la clave pública de un agente en draft
Cuando se pide GET /api/widget/config con esa clave
Entonces responde 404 y no revela nombre, colores ni avatar
```

### T2.4 — el ping sigue mudo

```
Dada la clave pública de un agente en draft
Cuando el widget hace su ping de instalación
Entonces responde 204 y no lanza: es telemetría, no un endpoint de datos
```

### T2.5 — el borrador no acepta reservas ni leads

**Corrección sobre la redacción inicial:** `/api/public/leads` **no** entra. Se leyó
`routes/public.ts`: crea un `LandingLead` del formulario de la landing de 3A Estudio, no recibe
`agentId` y el modelo no lo tiene, así que no hay estado de agente que comprobar. En su lugar entra
`/api/booking/slots`, que la spec no listaba y sí revela servicios y horarios del negocio.

```
Dado un agente en draft
Cuando llega una reserva por /api/booking/reserve, una consulta de horarios por
  /api/booking/slots o un kickoff por /api/leads/kickoff
Entonces se rechaza
  y con el mismo agente published se acepta
```

### T3.1 — precondiciones de publicación (AC4)

```
Dado un agente sin tenant asignado
Cuando el propietario intenta publicarlo
Entonces recibe 400 indicando que falta el cliente al que cobrar
  y el agente sigue en draft
```

```
Dado un agente con canal whatsapp y sin conexión de mensajería
Cuando el propietario lo publica
Entonces se publica (200) con un aviso de que ese canal no está conectado
  porque `channel` es decorativo tras el alta y el agente sirve por widget/API
  (evidencia: 3 de los 6 agentes que hoy sirven en producción están en este caso)
```

### T3.2 — despublicar no es suspender (AC6)

```
Dado un agente published
Cuando el propietario lo despublica
Entonces queda en draft, deja de atender tráfico real
  y su tenant sigue activo y sus otros agentes siguen sirviendo
```

### T3.3 — idempotencia (AC9)

```
Dado un agente ya published con publishedAt del día 1
Cuando se publica otra vez el día 5
Entonces publishedAt sigue siendo del día 1 y no se añade un evento duplicado
```

### T3.4 — guardar no publica (AC3)

```
Dado un agente en draft
Cuando se hace PATCH /api/agents/:id incluyendo status: "published"
Entonces el estado NO cambia
```

### T3.5 — rastro (AC8)

```
Dado un agente que se publica, se despublica y se vuelve a publicar
Cuando se consultan sus eventos de estado
Entonces hay tres, con las transiciones draft→published, published→draft, draft→published
```

### T3.6 — archivar en vez de borrar (AC10)

```
Dado un agente que estuvo published
Cuando se intenta borrar en duro
Entonces se rechaza indicando que debe archivarse
  y un agente que nunca salió de draft se sigue borrando igual que hoy
```

### T4.1 — recuento facturable (AC7)

```
Dado un tenant con 1 published, 1 suspended, 2 draft y 1 archived
Cuando H4 pida el recuento facturable
Entonces obtiene 2
```

### T5.2 — la tarjeta dice la verdad (AC13)

```
Dada la lista de agentes
Cuando se pinta la tarjeta
Entonces muestra el estado del agente y el nombre de su cliente
  (hoy el nombre no se pinta nunca: el back devuelve `tenant` y la tarjeta lee `client`)
  y no incluye el switch que suspende al tenant
```

## Verificación final

| Check | Cómo |
|---|---|
| V1 typecheck back | `npx tsc --noEmit` **dentro** de `back/` |
| V2 suite back | `npm test` en `back/`, sin skips nuevos (base: 104 / 1072 / 3) |
| V3 front | typecheck + build |
| V4 migración | revisión manual: aditiva, **sin backfill** (T0.2: los 14 a `draft` por el default de columna), sin `DROP` |
| V5 revisión | `sdd-verify` antes de proponer commit |
| V6 post-deploy | los 14 quedan `draft`; responden por consola, y por URL pública sólo tras Publicar |

## Gates humanos (no automatizables)

**T0.2 — aprobar el backfill. CERRADO** (27/07/2026). El propietario aportó el dato decisivo:
**ninguno de los 14 agentes es de un cliente, todos son pruebas.** Resultado: los 14 a `draft`, sin
`UPDATE` de backfill. El riesgo que hacía de esto un gate —dejar clientes sin servicio— no existe.

**T1.3 — aplicar la migración en producción.** Sigue abierto y sigue siendo aparte: aprobar el
backfill no es aprobar el despliegue. Se aplica junto con T2 y T3 en un solo despliegue.

**Fuera de este change, pero condicionado por él:** H4/T4 (modelo `Plan`) necesita el recuento de
T4.1 **y** la cifra en € por agente, que sigue siendo decisión del propietario.
