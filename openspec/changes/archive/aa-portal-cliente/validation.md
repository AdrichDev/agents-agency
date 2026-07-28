# Validación — aa-portal-cliente (H5)

## Historia de usuario

> Como **cliente que ya paga un agente**, quiero entrar con mi usuario y ver mi agente, sus
> conversaciones y cuánto cupo me queda este mes, **sin poder ver ni tocar nada de otro cliente ni
> nada del estudio**, para no depender de que alguien me mande capturas.

Y su contrapartida, que es la que hace peligroso el change:

> Como **propietario de la plataforma**, quiero que un usuario de portal no pueda alcanzar ningún
> endpoint que no esté declarado como suyo, **incluidos los que se escriban después de este
> change**.

## Criterios de aceptación

| AC | Enunciado | Cómo se demuestra |
|---|---|---|
| AC1 | Un `client` sólo alcanza `GET /api/portal/*`. Cualquier otra ruta de `/api` ⇒ 403. | T2 |
| AC2 | Una ruta de `/api` **no prevista** (inventada en el test) también da 403 para un `client`. Es la garantía para los routers futuros. | T2 |
| AC3 | Un `client` de tenant A que pide un recurso de tenant B recibe **404** y su respuesta no contiene ni un dato del tenant B. | T3 |
| AC4 | Ningún endpoint de portal acepta `tenantId` por query, body o path: el filtro sale de la sesión. | T3 |
| AC5 | Un `client` con `tenantId` nulo recibe 403 y **no** se ejecuta ninguna consulta sin filtro. | T2 |
| AC6 | `admin`, `editor` y `viewer` con `tenantId` NULL conservan **exactamente** el acceso de hoy. | T2 |
| AC7 | El cupo y el consumo que enseña `/api/portal/me` son los mismos que aplica el gate de metering (mismo `resolveTokenQuota`, mismo periodo). | T3 |
| AC8 | El portal no expone agentes `draft` ni `archived`, ni conversaciones con `isTest = true`. | T3 |
| AC9 | El portal no guarda ni devuelve ningún importe propio: la tarifa sale del catálogo cruzando `Plan.codigo`. | T4 |
| AC10 | La migración es aditiva: aplicarla no cambia el comportamiento de ningún usuario existente. | T1 |
| AC11 | El portal es de sólo lectura: no existe ninguna ruta de escritura alcanzable por un `client`. | T2 |

## Escenarios Given-When-Then

### E1 — Aislamiento entre tenants (el escenario que justifica el change)

```gherkin
Dado un usuario con rol "client" y tenantId = "tenant-A"
  Y un agente "agente-B" publicado que pertenece a "tenant-B"
Cuando pide GET /api/portal/agents/agente-B/conversations con su sesión
Entonces recibe 404
  Y el cuerpo de la respuesta no contiene ninguna conversación
  Y no contiene el nombre ni el id de "tenant-B"
```

### E2 — Un router nuevo nace cerrado

```gherkin
Dado un usuario con rol "client" y tenantId = "tenant-A"
Cuando pide GET /api/una-ruta-que-nadie-ha-escrito-todavia
Entonces la puerta responde 403 antes de llegar a ningún router
```

### E3 — El staff no se entera de que existe la puerta

```gherkin
Dado un usuario con rol "admin" y tenantId = NULL
Cuando pide cualquier ruta de /api que hoy le funciona
Entonces la respuesta es idéntica a la de antes del change
```

### E4 — Cliente mal creado se cierra, no se abre

```gherkin
Dado un usuario con rol "client" y tenantId = NULL
Cuando pide GET /api/portal/me
Entonces recibe 403
  Y no se ejecuta ninguna consulta a la base de datos sin filtro de tenant
```

### E5 — El portal enseña el mismo cupo que corta

```gherkin
Dado un tenant con plan "chatbot_plus" y 2 agentes publicados
  Y un consumo del periodo por debajo del cupo
Cuando el cliente pide GET /api/portal/me
Entonces el cupo devuelto es igual al que resuelve resolveTokenQuota para ese tenant
  Y el restante es cupo menos consumo del periodo vigente
```

### E6 — Sólo lectura

```gherkin
Dado un usuario con rol "client" y tenantId = "tenant-A"
Cuando pide POST /api/portal/agents (o cualquier método distinto de GET bajo /api/portal)
Entonces recibe 403
```

## Un test por tarea

| Tarea | Test | Fichero previsto |
|---|---|---|
| T1 modelo + migración | `usuario.tenant_id` existe, es nullable, sin default, con índice; y la migración no contiene `NOT NULL` ni `SET DEFAULT` sobre esa columna | `back/tests/portal-migracion-aditiva.test.ts` |
| T2 puerta | `isClientAllowed` + `clientScopeGate`: AC1, AC2, AC5, AC6, AC11 (E2, E3, E4, E6) | `back/tests/portal-puerta-cliente.test.ts` |
| T3 endpoints | aislamiento por endpoint (E1), `tenantId` ignorado si llega por request (AC4), cupo coherente (E5), filtros `isTest`/estado (AC8) | `back/tests/portal-endpoints-aislamiento.test.ts` |
| T4 front | el resumen enseña plan y tarifa desde `SERVICES_CATALOG` vía `Plan.codigo`, y no hay importes en la respuesta del back (AC9) | `front/tests/portal-tarifa-desde-catalogo.spec.ts` |
| T5 alta de usuario cliente | crear un `client` sin `tenantId` es rechazado; con `tenantId` queda ligado a ese tenant | `back/tests/portal-alta-usuario-cliente.test.ts` |

## Fuera de alcance de esta validación

- Cobro, checkout y cambio de plan: H6.
- Unificar los dos catálogos de precios duplicados (`front/components/presupuestos/types.ts:20` y
  `back/src/lib/service-catalog.ts:14`). Deuda registrada en el proposal (R5).
- Pantalla de staff para invitar usuarios de portal: T5 entrega el endpoint, no la UI.
