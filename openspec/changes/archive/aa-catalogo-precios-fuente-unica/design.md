# Diseño — aa-catalogo-precios-fuente-unica

## Restricción que decide la forma

Front y back son dos paquetes independientes con dos deploys independientes: Vercel con root `front/`
y Render con root `back/`. Nada fuera de cada root entra en su bundle. Por tanto:

- Un `shared/` en la raíz importado por los dos **no compila en producción**. Descartado, no por
  gusto: por deploy.
- El back **no puede leer el fichero del front en caliente**. En tiempo de test sí, porque los tests
  corren sobre el repo entero — es lo que ya hace `back/tests/cupo-defecto-front-back-coherencia.test.ts`.

Queda una sola forma honesta: **un fichero de datos canónico en el front, y un espejo generado y
commiteado en el back**, con un test que impide que deriven. El espejo es código generado en el
repositorio, igual que el cliente de Prisma.

Se descartó servir el catálogo desde el back (`GET /api/catalog`) porque obligaría a `/tarifas` y al
formulario de presupuestos a pasar de un array en la mano a fetch con estado de carga —ocho ficheros
del front— sin ganar nada mientras el precio se siga editando en un fichero del repo. Cuando exista
pantalla de administración de tarifas, ese será el momento: el JSON pasa a tabla y el endpoint aparece
solo.

## Por qué JSON y no TS

El canónico es `front/lib/service-catalog.json`, no un `.ts`:

- El generador del back es un script de node que hace `JSON.parse`. Sin transpilador, sin importar
  módulos del front desde el back, sin parsear un literal de objeto con expresiones regulares — que es
  la parte que se rompe en silencio.
- `front/tsconfig.json` ya trae `resolveJsonModule: true`: el front lo importa y sigue teniendo tipos.

Forma del fichero:

```json
{
  "planTokens": 10000000,
  "ivaRate": 0.21,
  "services": [
    { "id": "chatbot_basic", "name": "…", "description": "…",
      "implPrice": 540, "maintPrice": 39, "includesPlanTokens": true }
  ]
}
```

`includesPlanTokens` es booleano y no el número repetido en cada plan. Es el mismo motivo del cambio
entero: los 10M viven en `planTokens` y nadie más los escribe. Todas las entradas llevan el campo, aunque
sea `false`, porque con `resolveJsonModule` un campo presente solo en algunas entradas hace que
TypeScript infiera una unión y acceder a él falle al compilar.

## Qué deriva de qué

```
front/lib/service-catalog.json          ← el único sitio donde se edita un precio
        │
        ├── front/components/presupuestos/types.ts
        │       SERVICES_CATALOG · PLAN_TOKENS · IVA_RATE
        │       └── /tarifas · presupuestos · facturas · front/lib/portal.ts (tarifaDePlan)
        │
        └── back/scripts/sync-service-catalog.ts   (npm run catalog:sync)
                └── back/src/lib/service-catalog.ts   [GENERADO]
                        └── market-study/* · (H6: Stripe)
```

`types.ts` añade lo que es estado de UI y no dato de catálogo: `selected: false`, `quantity` (10 para
`hours`, 1 para el resto) y `tokens` resuelto desde `includesPlanTokens`. Las firmas exportadas no
cambian, así que ningún consumidor se toca — ni `/tarifas`, ni `front/lib/portal.ts`, ni los tests de
H5 y H7 que comparan contra `SERVICES_CATALOG`.

## Generador

Dos ficheros en `back/scripts/`, que el `tsconfig.json` del back **no** incluye (`include` es
`src/**`, `tests/**`, `prisma.config.ts`, `vitest.config.ts`):

- `service-catalog-codegen.ts` — `readCatalogSource()` y `renderCatalogModule(source)`. Puro: entra
  el JSON, sale el texto del módulo. Se puede importar desde un test, y al importarlo el test lo mete
  en el programa de `tsc`, así que sí se comprueba de tipos.
- `sync-service-catalog.ts` — CLI: lee, renderiza, escribe, informa. `npm run catalog:sync`.

El render tiene que ser **determinista** byte a byte, porque el tripwire compara texto. Sin fechas, sin
orden de claves variable, sin `JSON.stringify` de objetos con claves en orden de inserción incierto: se
emite campo a campo en orden fijo.

El módulo generado conserva los nombres que ya consume el back (`ServiceEntry`, `SERVICE_CATALOG`) y
añade `tokens: number | null` — el campo que hoy le falta, que es la deriva real que ya existe. No
exporta `PLAN_TOKENS` ni `IVA_RATE`: el back ya tiene su propio
`DEFAULT_TOKEN_QUOTA_PER_AGENT` en `lib/quota.ts` y un segundo nombre para el mismo número sería
volver a empezar. La coherencia entre los dos la sostiene el test, no una exportación de más.

## Tripwires

1. **Deriva del generado** — `readFileSync(back/src/lib/service-catalog.ts) === renderCatalogModule(readCatalogSource())`.
   Cubre las dos formas de romperlo: editar el generado a mano, y editar el JSON sin regenerar.
2. **Importes fuera del TS del front** — buscar `implPrice:`/`maintPrice:` seguido de número en
   `types.ts`. Si alguien vuelve a escribir un precio ahí, salta.
3. **Cupo** — `back/tests/cupo-defecto-front-back-coherencia.test.ts` deja de leer el literal de
   `PLAN_TOKENS` con una expresión regular sobre el TS (dejaría de existir: pasa a ser derivado) y lee
   `planTokens` del JSON. Sigue asertando contra `DEFAULT_TOKEN_QUOTA_PER_AGENT`.

Los tres tienen que **fallar si no encuentran lo que comparan**. Un test que no localiza el fichero y
pasa igual es peor que no tenerlo — misma regla que ya aplica el test del cupo de H7.

## Lo que este cambio deja preparado para H6

El importe queda en un sitio y el back lo tiene en tiempo de compilación. Cuando llegue Stripe:

- Los `Price` de Stripe son **inmutables**. Cambiar 99 € por 109 € no edita el `Price`: crea uno nuevo
  y hay que apuntar el `Product` al nuevo. Las suscripciones firmadas siguen con el viejo hasta que se
  migren. Ese mapa `serviceId → priceId` es de H6, no de aquí.
- El checkout nunca acepta el importe del cliente: recibe el `serviceId` y el servidor resuelve el
  precio del catálogo. Un endpoint que acepte `amount` del navegador es un descuento del 100 % a
  petición.

## Estrategia de prueba

- Front, `front/tests/catalogo-fuente-unica.spec.ts`: estructural, sin `page.goto` — compara
  `SERVICES_CATALOG` contra la tabla de importes de `validation.md` y comprueba que en el TS no queda
  ningún literal. Mismo patrón que `portal-tarifa-desde-catalogo.spec.ts` de H5.
- Back, `back/tests/catalogo-precios-fuente-unica.test.ts`: determinismo del render, contenido del
  espejo, y el tripwire de deriva.
- No hay migración, no hay endpoint nuevo, no hay cambio de contrato HTTP. El riesgo entero está en que
  un importe se mueva al copiarlo, y eso lo cubre la tabla congelada.
