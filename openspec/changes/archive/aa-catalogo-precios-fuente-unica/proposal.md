# aa-catalogo-precios-fuente-unica

## Intención

Un solo sitio donde vive el precio. Hoy hay dos catálogos con los mismos importes escritos a mano:

| Fichero | Papel real |
| --- | --- |
| `front/components/presupuestos/types.ts` (`SERVICES_CATALOG`) | canónico de hecho: `/tarifas`, presupuestos, facturas y el portal del cliente |
| `back/src/lib/service-catalog.ts` (`SERVICE_CATALOG`) | copia manual, **ya derivada**: le falta el campo `tokens` |

Los importes coinciden hoy por coincidencia, no por construcción. El comentario de cabecera del
espejo del back dice literalmente "kept in sync manually" y apunta a una ruta que ya no existe
(`front/app/facturacion`). Eso es una promesa que nadie puede cumplir dos veces seguidas.

El daño no es estético. H6 (`aa-stripe-suscripciones`) va a cobrar con un número, y `/tarifas`
anuncia otro. El día que los dos ficheros discrepen, el cliente lee un precio en la web y le llega
otro en el cargo — y el primero que se entera es él.

## Alcance

Dentro:

- Extraer los importes a un único fichero de datos, `front/lib/service-catalog.json`, que es el que
  ya alimenta la página de tarifas.
- `front/components/presupuestos/types.ts` pasa a **derivar** `SERVICES_CATALOG`, `PLAN_TOKENS` e
  `IVA_RATE` de ese fichero. Deja de contener importes.
- `back/src/lib/service-catalog.ts` pasa a ser **generado** (`npm run catalog:sync`), con cabecera
  que lo dice, y gana el campo `tokens` que le falta.
- Tests-alambre: el fichero generado tiene que coincidir con lo que produce el generador, y en el TS
  del front no puede volver a aparecer un importe literal.

Fuera:

- **Stripe.** Este cambio deja el número en un solo sitio; quién lo empuja a Stripe es H6. Aquí no se
  crea ningún `Price` ni se toca la API de Stripe.
- **Cambiar precios.** Los diez servicios salen con exactamente los importes que tienen hoy. Este
  cambio es de forma, no de tarifa: si además moviéramos un número, un test en rojo no distinguiría
  entre "la refactorización rompió algo" y "el precio cambió a propósito".
- **UI de administración de precios.** Se sigue editando un fichero en el repo.
- **`tokens_5m` / `tokens_10m`.** Siguen siendo dos líneas de catálogo sin conectar con el cupo; los
  5M y 10M viven en su descripción y ahí se quedan hasta que H6 los venda.

## Riesgos

- **Importe que cambia sin querer al mover los datos.** Es el riesgo entero de este cambio. Se cubre
  comparando importe a importe contra los valores de hoy, que quedan escritos en `validation.md`.
- **Facturas ya emitidas.** No las toca: `BudgetLine.implPrice` / `maintPrice` guardan el precio
  *snapshot* de la factura. Que la tarifa suba mañana no puede reescribir lo que ya se cobró. Esa
  tercera copia es correcta y no entra en la unificación.
- **Front y back son paquetes separados.** No se pueden importar entre sí ni compartir un fichero en
  la raíz: el front despliega en Vercel con root `front/` y el back en Render con root `back/`, y lo
  que queda fuera de cada root no viaja en el deploy. De ahí que el espejo del back sea generado y
  commiteado, no un import ni una lectura en caliente. En **tests** sí se puede leer el fichero del
  front, porque corren sobre el repo — precedente: `back/tests/cupo-defecto-front-back-coherencia.test.ts`.
- **El generado se edita a mano.** Es el modo de fallo obvio de todo codegen commiteado. Lo cierra el
  test de deriva de T3.1, que compara el fichero en disco con la salida del generador.

## Dependencias

- Ninguna nueva. El generador corre con `tsx`, que el back ya usa para el resto de `scripts/`.
- `front/tsconfig.json` ya trae `resolveJsonModule: true`, así que el import del JSON no necesita
  configuración.
- Bloquea a H6 (`aa-stripe-suscripciones`): el script de Stripe leerá este catálogo, no una copia.
