# Validación — aa-catalogo-precios-fuente-unica

## Historia de usuario

> Como dueño del estudio, quiero cambiar un precio en un único sitio y que se actualice en la página
> de tarifas, en los presupuestos, en el portal del cliente y en lo que cobre Stripe, para no acabar
> anunciando un importe y cargando otro.

## Invariante congelada — los importes de hoy

Este cambio **no mueve ninguna tarifa**. Los diez servicios tienen que salir con estos valores
exactos (€ sin IVA). Cualquier desviación aquí es el fallo que este cambio podría introducir:

| id | implPrice | maintPrice | tokens de plan |
| --- | --- | --- | --- |
| `chatbot_basic` | 540 | 39 | sí |
| `chatbot_plus` | 1290 | 99 | sí |
| `chatbot_pro` | 1730 | 149 | sí |
| `web_basic` | 890 | 59 | no |
| `web_chatbot` | 2950 | 180 | sí |
| `automation` | 750 | 49 | no |
| `crm` | 2000 | 99 | no |
| `hours` | 75 | 0 | no |
| `tokens_5m` | 0 | 17 | no |
| `tokens_10m` | 0 | 30 | no |

Constantes: `planTokens = 10_000_000`, `ivaRate = 0.21`. Orden de la lista: el de la tabla, que es el
que pinta el catálogo completo de `/tarifas`.

Cantidad por defecto en el formulario de presupuestos: `hours` arranca en 10, el resto en 1. Es estado
de UI, no dato de catálogo: vive en el TS, no en el JSON.

## Deriva que este cambio corrige a propósito

Las descripciones también habían derivado. Gana la del front, que es la que lee el cliente en
`/tarifas`; el espejo del back solo las usa para prosa de estudios de mercado:

- `web_basic`: se conserva la cadena del front **literal**, con su doble espacio en
  "SEO básico  + captación". Normalizarla sería un cambio de texto visible colado en un cambio de
  estructura.
- `hours`: el back gana el "(precio por hora)" que ya tenía el front.

## Criterios de aceptación

- **AC1** — Existe un único fichero de datos con los importes: `front/lib/service-catalog.json`.
- **AC2** — `front/components/presupuestos/types.ts` no contiene ningún importe literal.
- **AC3** — `back/src/lib/service-catalog.ts` es generado, lo declara en su cabecera, y coincide
  byte a byte con la salida de `npm run catalog:sync`.
- **AC4** — El espejo del back incluye `tokens`, el campo que hoy le falta.
- **AC5** — `planTokens` del catálogo es el mismo número que `DEFAULT_TOKEN_QUOTA_PER_AGENT` del back.
- **AC6** — Los diez servicios conservan los importes de la tabla de arriba, y en ese orden.
- **AC7** — Ningún consumidor cambia de API: `SERVICES_CATALOG`, `PLAN_TOKENS`, `IVA_RATE`,
  `SERVICE_CATALOG` y `ServiceEntry` siguen exportándose con el mismo nombre y la misma forma.
- **AC8** — El portal del cliente sigue sin devolver importes: `/api/portal/me` no gana ningún campo
  de precio por este cambio (AC9 de H5 sigue verde).

## Escenarios

### E1 (AC1, AC6) — El precio sale del fichero de datos

- **Given** el catálogo declara `maintPrice: 99` para `chatbot_plus`
- **When** el front construye `SERVICES_CATALOG`
- **Then** la entrada `chatbot_plus` tiene `maintPrice === 99` y `tokens === 10_000_000`

### E2 (AC2) — El TS del front ya no guarda importes

- **Given** `front/components/presupuestos/types.ts`
- **When** se busca en su código un `implPrice:` o `maintPrice:` seguido de un número
- **Then** no hay ninguna coincidencia

### E3 (AC3) — El espejo del back no se puede editar a mano

- **Given** `back/src/lib/service-catalog.ts` tal como está commiteado
- **When** se vuelve a renderizar desde el JSON del front
- **Then** el resultado es idéntico al fichero en disco

### E4 (AC5) — El número anunciado es el número que se aplica

- **Given** `planTokens` del catálogo
- **When** se compara con `DEFAULT_TOKEN_QUOTA_PER_AGENT`
- **Then** son el mismo número, y sigue siendo 10M

### E5 (AC4, AC6) — El espejo del back lleva los tokens y los importes buenos

- **Given** `SERVICE_CATALOG` del back
- **When** se lee la entrada `web_chatbot`
- **Then** `implPrice === 2950`, `maintPrice === 180` y `tokens === 10_000_000`

### E6 (AC7) — El generador es determinista

- **Given** el mismo JSON de entrada
- **When** se renderiza dos veces
- **Then** las dos salidas son idénticas (si no, el test de deriva daría falsos rojos)

## Un test por tarea

| Tarea | Test |
| --- | --- |
| T1.1 JSON canónico | E1 en `front/tests/catalogo-fuente-unica.spec.ts` |
| T1.2 `types.ts` deriva | E2, más los diez importes de la tabla, mismo spec |
| T2.1 codegen | E6 en `back/tests/catalogo-precios-fuente-unica.test.ts` |
| T2.3 espejo regenerado | E5, mismo fichero |
| T3.1 tripwire de deriva | E3, mismo fichero |
| T3.3 coherencia del cupo | E4 en `back/tests/cupo-defecto-front-back-coherencia.test.ts` (actualizado) |

## Verificación final

- `npx tsc --noEmit` verde en `back/` y en `front/`.
- Suite completa del back verde, sin bajar del recuento de H5 (130 ficheros / 1452 tests).
- Especificaciones Playwright del catálogo y del portal verdes.
- `npm run catalog:sync` no deja el árbol sucio después de ejecutarlo (idempotente).
