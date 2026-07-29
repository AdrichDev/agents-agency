# Diseño

## 1. Enfoque

Un script puntual con la misma forma que `scripts/delete-orphan-agents.ts`, que
ya es el precedente de borrado destructivo en este repo: **dry-run por defecto**,
`--apply` para ejecutar, y frenos que abortan sin tocar nada.

Nada de endpoint `DELETE /api/skills/:id`. Una purga que se hace una vez no
justifica dejar abierta una superficie de API destructiva para siempre.

## 2. El criterio de curación

Una skill entra en el catálogo si un **negocio cliente** (peluquería, clínica,
gimnasio, taller, estudio) podría querer que su agente la use. Tres preguntas, y
basta fallar una:

1. ¿La usaría alguien que no programa?
2. ¿Sirve a un negocio de servicios, no a un equipo de ingeniería?
3. ¿Se puede convertir en una facultad real —`toolsProvider`, `mcpUrl` o
   `instructions`— o es sólo un repo bonito?

Contra ese filtro caen enteros: DESARROLLO, IA, DEVOPS, SEGURIDAD, NAVEGADOR, y
los sueltos de nicho ajeno (legislación coreana, Xiaohongshu, firmware ESP32,
reproductor de música, plugin de Neovim).

**Este criterio es un juicio, no un algoritmo.** Por eso no se implementa como
heurística sobre `use` / `stars` / `description`: la lista de supervivientes va
**enumerada por nombre exacto** en el código (AC4). Una heurística sobre `use`
habría borrado `haris-musa/excel-mcp-server` (uso DOCUMENTOS, se queda) y salvado
`rusq/slackdump` (uso MENSAJERÍA) por la razón equivocada.

## 3. Arquitectura

```
back/src/lib/skills/purge-plan.ts     ← NUEVO. Pura. Sin I/O.
  KEEP_SKILL_NAMES: readonly string[]        (3 nombres exactos, importadas)
  + conservación por `source === "builtin"`  (las propias, sin lista)
  planSkillPurge(allNames) → { keep, delete, missing }

back/scripts/purge-skill-catalog.ts   ← NUEVO. La cáscara con I/O.
back/scripts/restore-skill-catalog.ts ← NUEVO. El camino de vuelta.
back/prisma/backups/skills-<fecha>.json  ← el backup (versionado en git)
```

La separación existe para poder testear la decisión sin BD. `planSkillPurge` es
la que decide; el script sólo lee, escribe y aborta.

```ts
export interface PurgePlan {
  /** Nombres que se conservan (⊆ KEEP_SKILL_NAMES presentes en la BD). */
  keep: string[];
  /** Nombres que se borran. */
  remove: string[];
  /** Nombres de KEEP_SKILL_NAMES que NO están en la BD → abortar (AC6). */
  missing: string[];
}
```

## 4. Los frenos

Cuatro, y cualquiera de ellos aborta **antes** de la primera escritura:

| Freno | Por qué | AC |
|---|---|---|
| `missing.length > 0` | Un typo en un nombre a conservar borraría esa skill sin avisar. Si falta alguno de los 11, para | AC6 |
| Existe `AgentSkill` apuntando a algo de `remove` | `Skill.agents` es `AgentSkill[]` con cascada: borrar arrastraría la instalación de un agente en producción. Verificado hoy `= 0`, pero se comprueba en el momento, no se asume | AC2 |
| El backup no se escribió | Sin backup no hay vuelta atrás. Se escribe y se relee del disco para confirmar que existe y parsea, antes de borrar | AC1 |
| Sin `--apply` | Dry-run por defecto. Enumera y sale | GWT1 |

La comprobación de `AgentSkill` se repite **dentro de la transacción**, igual que
`delete-orphan-agents.ts` recomprueba el `tenantId`: si alguien instala una skill
mientras corre el script, no se borra bajo sus pies.

## 5. El backup

`prisma/backups/skills-<YYYY-MM-DD>.json`, con las **108** filas y **todos** los
campos —incluidos `instructions`, `tools`, `toolsProvider`, `mcpUrl`,
`repoUrl`— no un `select` recortado. Lo que no esté en el backup no vuelve.

Va versionado en git. Son ~108 objetos pequeños; el coste es despreciable y el
valor de tenerlo en el historial es exactamente el punto.

`restore-skill-catalog.ts` lo relee y hace `createMany` con `skipDuplicates`, así
que restaurar sobre un catálogo purgado devuelve las 97 sin duplicar las 11
(GWT6). Los `id` originales se conservan: `Skill.id` es un `cuid()` con default,
pero el backup lo incluye y el restore lo fija, de modo que un `AgentSkill`
histórico volvería a apuntar bien.

## 6. Idempotencia

`planSkillPurge` se calcula contra lo que hay en la BD **en ese momento**. Sobre
un catálogo ya purgado: `keep` = 11, `remove` = 0, `missing` = 0 → informa de 0 a
borrar y sale con código 0 (AC5). No hay estado que recordar.

## 7. Lo que este cambio NO arregla

- Las 11 supervivientes siguen **sin `instructions` y sin `mcpUrl`** (salvo el
  `toolsProvider` de `slackdump`). Siguen inyectando su línea de descripción en
  inglés en el system prompt (`engine.ts:257-260`) si alguien las instala. Menos
  ruido, pero ruido. **Deuda anotada.**
- El catálogo sigue sin lo que un negocio pediría de verdad: reservas, CRM,
  cobros, facturación, WhatsApp Business, Google My Business. Añadirlas es otro
  cambio.
- El importador que metió las 108 sigue igual.

## 8. Estrategia de pruebas

- `back/tests/skills-purge-plan.test.ts` — la función pura. Cubre AC4 (lista
  literal), GWT4 (superviviente inexistente), GWT5 (idempotencia) y el conteo
  97/11 sobre el snapshot real de nombres.
- La ejecución sobre producción es manual y en dos pasos: dry-run primero,
  `--apply` **sólo tras OK explícito de Adrián**. El resultado se comprueba con
  `skill.count()`, no declarando que salió bien.
