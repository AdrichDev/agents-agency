# Proposal — `aa-agente-ciclo-vida-publicacion`

Hijo H3 del eje `aa-agentes-entrega-monetizacion`. **Nivel 4** (migración sobre datos de
producción, back + front, y define la unidad de cobro de la plataforma).

## Intención

Dar al agente un **ciclo de vida explícito**. Hoy no lo tiene: un agente nace servible y no hay
ningún momento en el que el propietario decida "esto ya se puede vender".

Esto dejó de ser una mejora de UX el 27/07/2026, cuando el propietario decidió que la suscripción
se cobra **por agente activo** (`aa-planes-y-cuotas/design.md §C.4`). Desde esa decisión, el estado
del agente es **el numerador de la factura**. Y no existe.

## El problema, con la línea de código

`back/prisma/schema.prisma:154`:

```prisma
publicKey String @unique @default(cuid()) @map("clave_publica")
```

La clave pública se genera en el `INSERT`. En cuanto el wizard termina, el agente:

- responde en `POST /api/chat` con esa clave (ruta pública, `ai.ts:53`),
- sirve su configuración en `GET /api/widget/config` (nombre, colores, avatar),
- tiene un snippet copiable en el panel de Implementación (`DeployPanel.tsx:112`),
- y consume cupo del tenant, porque el gate de H1 sólo comprueba saldo, no madurez.

Es decir: **crear = publicar = facturable**, todo en el mismo instante y sin decisión de nadie. Un
borrador a medio configurar es indistinguible de un agente vendido. Consecuencias concretas:

1. **No se puede facturar.** Contar `Agent` por `tenantId` cobraría borradores, pruebas y los mocks
   huérfanos que hay en producción. La factura sería falsa por exceso.
2. **No se puede probar sin exponer.** No hay ventana entre "existe" y "lo ve el mundo".
3. **No se puede apagar un agente.** Sólo se puede apagar al **cliente entero**
   (`Tenant.isActive`), que es un martillo: suspende todos sus agentes a la vez. O borrarlo, que es
   hard delete y se lleva la historia por delante.
4. **`channel` no sirve de estado.** El propio esquema lo documenta: es *informativo* tras el alta,
   y `"widget"` vs `"api"` no tienen ninguna rama de código distinta.

## Lo que este change añade

- **Estado explícito en `Agent`**: `draft → published → (draft | suspended | archived)`, con la
  fecha de la primera publicación y del último cambio.
- **Gate de publicación en el cuello único que ya existe**: `runAgent` (`engine.ts:537`), donde H1
  puso `assertUsageAllowed`. Un agente no publicado no atiende tráfico real. **La consola de
  pruebas del operador sí**, con la misma exención acotada por sesión que ya usa `isTest`: si no,
  no se podría probar antes de publicar y el estado sería un estorbo en vez de una herramienta.
- **Publicar y despublicar desde el panel**, como acción con nombre propio y no como efecto
  colateral de guardar un formulario.
- **Separación de causas**: que lo despublique el propietario y que lo suspenda la plataforma por
  impago son dos cosas distintas, aunque el agente calle en los dos casos. Es la lección de
  `aa-planes-y-cuotas` T1, donde fundir estado de pago con estado de cupo causó un bug real.
- **Recuento facturable** consumible por H4: agentes publicados de un tenant.

## Fuera de alcance

- El modelo `Plan` y el precio (H4/T4). Aquí sólo se crea el hecho que H4 contará.
- Stripe (H6).
- BYOK (H2).
- Fase 2 de H1 (`Agent.tenantId` → `NOT NULL`). Se roza pero no se toca: son migraciones
  independientes y mezclarlas duplica el riesgo del gate de producción.

## Riesgos

- ~~**El backfill puede callar agentes que hoy funcionan.**~~ **Descartado en T0.2.** Era el riesgo
  grave del change: dejar todo en `draft` callaba producción, dejar todo en `published` autofacturaba
  mocks. El inventario previo (T0.1, mismo patrón que H1 con los huérfanos) más el gate humano lo
  resolvieron con un dato que no está en el código: **ninguno de los 14 agentes es de un cliente,
  todos son pruebas.** Con eso el backfill correcto es el trivial —los 14 a `draft`— y `published` en
  el backfill pasa de prudente a falso. Queda un riesgo menor de orden, no de datos: migrar sin las
  acciones de publicación deja los agentes mudos y sin botón, así que **T1+T2+T3 se despliegan
  juntos** (`design.md §D`).
- **Hueco de facturación por despublicar antes del corte.** Si se cuenta por foto al cierre del
  periodo, un cliente puede despublicar el día antes y volver a publicar después. Se acepta en la
  v1 y se registra el rastro de eventos para poder cerrarlo con evidencia; cerrarlo antes de ver si
  ocurre es complejidad sin datos. Documentado como deuda, no ignorado.
- **El kill switch actual no cubre las vías sin LLM** (`/api/leads/kickoff`,
  `/api/booking/reserve`, `/api/booking/slots`; al implementar T2.5 se comprobó que
  `/api/public/leads`, listado aquí en la v1, no pertenece a esta lista: es el formulario de la
  landing de 3A Estudio y no tiene `agentId`): heredado de H1 y anotado en H4. El gate de
  publicación tiene el mismo agujero si sólo se pone en `runAgent`. Se decide explícitamente en
  `design.md §C.3` qué corta el estado del agente y qué no.
- **Bug preexistente que este change destapa y arregla** (`AgentsGrid.tsx:24`): la tarjeta declara
  `client?: {...}` y el back devuelve la relación como `tenant` (`service.ts:53`), sin ningún alias.
  Así que `a.client` es siempre `undefined`: el switch no se pinta nunca, "Cliente: X" no se pinta
  nunca y buscar por nombre de cliente (`:93`) no casa nunca. Rama muerta desde el rename a
  castellano. Y peor que muerta: ese switch es `TokenSwitch`, que apaga **el tenant**. Arreglar sólo
  el nombre del campo pondría en la ficha del agente un interruptor que suspende al cliente entero
  — la misma fusión de conceptos que T1 acabó de deshacer. La tarjeta pasa a mostrar el estado del
  **agente**; el kill switch del tenant se queda donde le corresponde, en `/clientes` — la casilla
  `isActive` de `ClientModal`. (Corrección al implementarlo: aquí se escribió `/clients`, que no
  existe, y `TokenSwitch.tsx` resultó no estar montado en ninguna otra parte, así que quitarlo de la
  tarjeta lo dejó huérfano y se borró. Ver T5.2.)

## Dependencias

- **Depende de H1** (`aa-metering-fail-closed`): reutiliza su cuello único y su patrón de exención
  por sesión de operador. H1 fase 1 está commiteado (`f84c89d`), sin push.
- **Bloquea H4/T4** (modelo `Plan`): sin este change, el cobro por agente activo no tiene numerador.
- Ficheros previstos: `back/prisma/schema.prisma` (+ migración), `back/src/lib/agent/service.ts`,
  `back/src/routes/agents.ts`, `back/src/lib/agent/engine.ts`, `back/src/routes/ai.ts`,
  `front/components/DeployPanel.tsx`, `front/components/agents/AgentsGrid.tsx`,
  `front/app/agents/[id]/page.tsx`, y un script de inventario nuevo en `back/scripts/`.
