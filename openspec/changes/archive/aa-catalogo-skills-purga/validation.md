# Validación

> **Cifras revisadas al ejecutar.** Este documento se escribió contra un catálogo
> de 108 filas y 11 supervivientes. Dos cosas cambiaron antes del `--apply`:
>
> 1. El criterio de conservación se endureció a uno solo —¿le sirve a un tenant?—
>    y las supervivientes importadas pasaron de 11 a **3**. Las 8 que cayeron eran
>    de desarrollo o de redes sociales.
> 2. `aa-skills-propias-tenant` sembró **10 skills propias** (`source: "builtin"`)
>    antes de que esta purga se ejecutara, así que el catálogo de partida era de
>    **118**, no de 108.
>
> Cifras reales de la ejecución: 118 de partida, **105 borradas**, **13 conservadas**
> (3 importadas + 10 propias). Los AC de abajo se leen con esos números.

## Historia de usuario

Como operador de la plataforma, quiero abrir la pestaña Skills y ver sólo cosas
que un negocio podría querer, para no tener que explicarle a un cliente por qué
su agente ofrece integrarse con Unreal Engine.

## Criterios de aceptación

- **AC1** — Antes de borrar nada existe un fichero de backup con las **105** filas
  a borrar, completas (todos los campos, incluidos `instructions` y `tools`), y el
  script aborta si no consiguió escribirlo **o si no consigue releerlo entero**.
- **AC2** — El script aborta sin borrar nada si existe **cualquier** fila de
  `AgentSkill` que apunte a una skill de la lista de borrado.
- **AC3** — Tras ejecutarlo quedan exactamente **13** skills: las 3 importadas de
  `KEEP_SKILL_NAMES` más las 10 propias.
- **AC4** — La lista de supervivientes importadas está enumerada por nombre exacto
  en el código, no derivada de una heurística sobre `use`, `stars` o `description`.
- **AC5** — El script es idempotente: una segunda ejecución no falla y no borra
  nada más.
- **AC6** — El script aborta si alguno de los nombres a conservar no existe en la
  BD (protege contra un typo que borraría de más).
- **AC7** — El backup se puede restaurar. Existe un camino de vuelta probado, no
  sólo un fichero.
- **AC8** — Ningún endpoint nuevo. `skills.ts` no gana un `DELETE`.
- **AC9** — Ninguna skill propia (`source: "builtin"`) entra jamás en la lista de
  borrado, esté o no en `KEEP_SKILL_NAMES`. Se conservan por procedencia, no por
  nombre.

## Escenarios

### GWT1 — Purga en seco (AC1, AC3)
- **Dado** un catálogo con 118 skills y cero `AgentSkill`,
- **cuando** se ejecuta el script **sin** `--apply` (dry-run por defecto, igual
  que `delete-orphan-agents.ts`),
- **entonces** informa de 105 a borrar y 13 a conservar (10 de ellas propias), y
  **no** borra ninguna fila ni escribe backup.

### GWT2 — Purga real (AC3)
- **Dado** cero `AgentSkill`,
- **cuando** se ejecuta el script con `--apply`,
- **entonces** escribe el backup, lo relee, borra 105 y `skill.count()` devuelve
  13.

### GWT7 — Las propias no se borran (AC9)
- **Dado** un catálogo que incluye las 10 skills `source: "builtin"`, ninguna de
  las cuales figura en `KEEP_SKILL_NAMES`,
- **cuando** se calcula el plan,
- **entonces** las 10 están en `keep` y ninguna en `remove`.

### GWT3 — Freno por skill instalada (AC2)
- **Dado** un catálogo donde `chongdashu/unreal-mcp` está instalada en un agente,
- **cuando** se ejecuta el script,
- **entonces** aborta con un error que nombra la skill y el agente, y
  `skill.count()` sigue siendo 108.

### GWT4 — Freno por superviviente inexistente (AC6)
- **Dado** que uno de los 11 nombres a conservar no existe en la BD,
- **cuando** se ejecuta el script,
- **entonces** aborta nombrando el que falta y no borra nada.

### GWT5 — Idempotencia (AC5)
- **Dado** un catálogo ya purgado (11 filas),
- **cuando** se vuelve a ejecutar el script,
- **entonces** informa de 0 a borrar, sale con código 0 y `skill.count()` sigue
  siendo 11.

### GWT6 — Vuelta atrás (AC7)
- **Dado** un catálogo purgado y el fichero de backup,
- **cuando** se ejecuta el script de restauración,
- **entonces** `skill.count()` vuelve a 108 y los campos de una fila de muestra
  coinciden con los del backup.

## Mapa test ↔ tarea

| Tarea | Test | Escenario |
|---|---|---|
| T1.1 | `back/tests/skills-purge-plan.test.ts` | AC4, GWT4 |
| T1.2 | `back/tests/skills-purge-plan.test.ts` | GWT1, GWT5 |
| T2.1 | `back/tests/skills-purge-plan.test.ts` | GWT3 |
| T3.1 | Ejecución real con `--dry-run` sobre producción | GWT1 |
| T3.2 | Ejecución real (GATE HUMANO) + `skill.count()` | GWT2, AC3 |
| T4.1 | Restauración probada contra el backup | GWT6, AC7 |
