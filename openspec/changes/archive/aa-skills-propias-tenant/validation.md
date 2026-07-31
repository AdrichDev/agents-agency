# Validación

## Historia de usuario

> Como operador de la plataforma, quiero que instalar una skill en el agente de un cliente
> cambie de verdad lo que ese agente contesta, para poder vender las skills como una
> facultad y no como una etiqueta.

## Criterios de aceptación

- **AC1** — Existen skills propias en el catálogo con `source: "builtin"` e `instructions`
  no vacías. Hoy hay 0 de las dos cosas.
- **AC2** — Instalada una skill propia en un agente, `usar_skill` devuelve `curated: true` y
  el cuerpo curado dentro del bloque `[SKILL-<nonce>]`.
- **AC3** — Sin instalar, `usar_skill` sobre esa misma skill devuelve error y **nunca** el
  cuerpo. La curación no debilita el control de instalación.
- **AC4** — Las skills propias no declaran `toolsProvider`: nacen informativas. Declararlo
  sin integración conectada produce `requires_connection`, que es peor que no declarar nada.
- **AC5** — El seed es idempotente: correrlo dos veces deja el mismo número de filas y
  actualiza el contenido, no lo duplica.
- **AC6** — El seed nunca modifica ni borra una skill que no sea `source: "builtin"`. Las
  importadas de GitHub quedan intactas.
- **AC7** — Ninguna skill propia supera `SKILL_INSTRUCTIONS_MAX` (8000): si lo hiciera,
  `usar_skill` la truncaría a media frase.
- **AC8** — Cada vertical vendido (`E-commerce`, `Inmobiliaria`, `Salud`, `Legal` en
  `promptTemplates.ts`) tiene al menos una skill propia.
- **AC9** — Las skills de Salud y Legal prohíben explícitamente diagnosticar y dar
  asesoramiento jurídico concreto, y ordenan escalar.

## Escenarios Given-When-Then

### GWT1 — La skill se nota (AC2)
> **Dado** un agente con la skill propia `3a/reserva-de-cita` instalada,
> **cuando** el modelo llama a `usar_skill` con ese nombre,
> **entonces** la respuesta trae `curated: true` y su `instructions` contiene el protocolo de
> reserva curado, no la descripción de una línea.

### GWT2 — Sin instalar no hay cuerpo (AC3)
> **Dado** un agente **sin** esa skill instalada,
> **cuando** el modelo llama a `usar_skill` con ese nombre,
> **entonces** recibe `{ error: … no está instalada … }` y en la respuesta no aparece ni un
> fragmento del cuerpo curado.

### GWT3 — Antes/después medible (AC1, AC2)
> **Dada** una skill del catálogo importado (sin `instructions`) y una propia (con ellas),
> **cuando** se piden ambas por `usar_skill` en un agente que tiene las dos instaladas,
> **entonces** la importada devuelve `curated: false` y la propia `curated: true`.

### GWT4 — Seed idempotente (AC5, AC6)
> **Dado** un catálogo con las 10 propias ya sembradas y N importadas de GitHub,
> **cuando** se vuelve a ejecutar el seed,
> **entonces** siguen siendo 10 propias, las N importadas no cambian y el contenido de las
> propias queda al día.

### GWT5 — Tope respetado (AC7)
> **Dada** cualquier skill propia,
> **cuando** se mide la longitud de sus `instructions`,
> **entonces** es menor que `SKILL_INSTRUCTIONS_MAX`.

## Test por tarea

| Tarea | Test |
|---|---|
| T1 Catálogo de skills propias | `back/tests/builtin-skills-catalog.test.ts` — AC1, AC4, AC7, AC8, AC9 |
| T2 Seed idempotente | `back/tests/builtin-skills-seed.test.ts` — GWT4 (AC5, AC6) |
| T3 Inyección curada | `back/tests/skill-instructions-curated.test.ts` — GWT1, GWT2, GWT3 |
| T4 Ejecución del seed | Recuento en producción antes/después + una invocación real de `usar_skill` |

## Fuera de validación

- Que el modelo **elija bien** cuándo invocar `usar_skill` es comportamiento del LLM, no del
  código. Se comprueba a mano en la consola de pruebas del agente (T4), no con un test.
