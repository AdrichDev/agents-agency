# Tasks

## Orden crítico

La decisión (T1) antes que el script (T2), porque es lo único testeable sin BD y
es donde está el riesgo real: una lista mal escrita borra lo que no toca. El
camino de vuelta (T4) se escribe y se prueba **antes** de ejecutar la purga real
(T3.2), no después.

Sin migración: se borran filas, no cambia el schema.

---

## T1 — La decisión, pura

- [x] T1.1 — `back/src/lib/skills/purge-plan.ts`: `KEEP_SKILL_NAMES` y
      `planSkillPurge(catalog) → { keep, remove, missing, installed }`. Sin I/O.
      Nada de heurísticas sobre `use` / `stars` / `description` (AC4).
      **Revisado a la baja: 3 nombres, no 11.** El criterio se endureció a uno
      solo —¿le sirve a un tenant?— y las 8 que caían eran de desarrollo o de
      redes sociales. Ver `proposal.md`.
- [x] T1.2 — `back/tests/skills-purge-plan.test.ts` — AC4, GWT1, GWT4, GWT5.
- [x] T1.3 — **Conservación por `source`, añadida después.** Las skills propias
      (`source: "builtin"`, de `aa-skills-propias-tenant`) se conservan siempre,
      sin pasar por `KEEP_SKILL_NAMES`. Sin esto las diez recién sembradas caían
      en `remove` y el `--apply` las habría borrado sin un solo aviso. Test de
      regresión en el mismo fichero.

## T2 — El script

- [x] T2.1 — `back/scripts/purge-skill-catalog.ts`, misma forma que
      `delete-orphan-agents.ts`: dry-run por defecto, `--apply` para ejecutar.
- [x] T2.2 — Backup: leer las filas a borrar **completas** (sin `select`
      recortado) a `prisma/backups/skills-<YYYY-MM-DD>.json`. Releerlo del disco
      y parsearlo para confirmar que existe antes de borrar; abortar si no (AC1).
      La relectura compara además `id` a `id`: escribir un fichero no demuestra
      que se pueda leer entero.
- [x] T2.7 — **Ruta del backup anclada a `process.cwd()`, no a `__dirname`.**
      Comprobado ejecutando: bajo `tsx`, `__dirname` en estos scripts resuelve a
      `src/lib/generated/prisma`, así que el backup caía dentro del cliente
      Prisma generado — carpeta que `prisma generate` rehace. El backup de un
      borrado de 105 filas no puede vivir donde una regeneración lo pisa.
- [x] T2.3 — Freno por `missing` (AC6): abortar nombrando los que faltan.
- [x] T2.4 — Freno por `AgentSkill` (AC2): abortar nombrando skill y agente.
      Recomprobarlo **dentro** de la transacción (design §4).
- [x] T2.5 — Borrado en una transacción, con recuento final impreso.
- [x] T2.6 — Test del freno de `AgentSkill` — GWT3. Cubierto en
      `skills-purge-plan.test.ts` a nivel de decisión (`installed` ⇒
      `isPurgeSafe` falso). La **recomprobación dentro de la transacción**
      (T2.4) NO tiene test automático: es código de script y probarla exigiría
      mockear `$transaction`. Se deja dicho, no se cuenta como cubierta.

## T3 — Ejecución (GATE HUMANO)

- [x] T3.1 — Dry-run contra producción: `Catálogo: 118 skills / Se conservan: 13
      (10 propias) / Se borrarían: 105`. Las 118 son las 108 originales más las
      diez propias sembradas por `aa-skills-propias-tenant`.
- [x] T3.2 — `--apply` ejecutado con el OK de Adrián, y sólo después de T4.2.
      Salida: backup de 105 filas escrito, releído y verificado; `Borradas: 105`.
- [x] T3.3 — Recuento posterior por consulta, no declarado: `Catálogo: 13 skills
      / Se conservan: 13 (10 propias) / Se borrarían: 0`. Las 13 son las 3 de
      `KEEP_SKILL_NAMES` más las 10 propias (AC3).

## T4 — El camino de vuelta

- [x] T4.1 — `back/scripts/restore-skill-catalog.ts`: relee el backup y hace
      `createMany` con `skipDuplicates`, conservando los `id` originales.
- [x] T4.2 — Restauración probada **antes** de T3.2 (GWT6, AC7), contra la base
      real y con una fila de verdad: se hizo backup de
      `0GiS0/ghcp-agent-skills/add-social-media-header` (0 instalaciones, la de
      menos valor del catálogo), se borró, se restauró con el script y se comparó
      campo a campo. Resultado: mismo `id`, idéntica en todos los campos,
      catálogo de vuelta a 118. El script del ensayo era de usar y tirar; se
      borró al terminar.
- [x] T4.3 — JSON de backup versionado (`back/prisma/backups/skills-2026-07-28.json`,
      105 filas, 64 KB), commit `f310f70`. No con `git add -f`: `back/.gitignore`
      ignora `backups/` por los volcados de `backup-db.mjs`, que sí llevan datos de
      clientes, así que se añadió una excepción estrecha para
      `prisma/backups/skills-*.json` con el motivo escrito al lado. Un fichero
      rastreado dentro de una carpeta ignorada, sin explicación, no se lo explica
      nadie dentro de seis meses. Comprobado que los volcados de BD siguen
      ignorados. Contenido auditado antes de commitear: 0 `mcpUrl` no nulos,
      ningún patrón de clave ni de token.

## T5 — Documentar el criterio

- [x] T5.1 — Las tres preguntas del filtro (design §2) escritas junto a
      `KEEP_SKILL_NAMES`, para que la próxima importación tenga contra qué
      medirse.
- [x] T5.2 — Anotar la deuda que queda: las 3 supervivientes importadas siguen
      sin `instructions` ni `mcpUrl` (design §7). Las 10 propias sí las tienen —
      ése era el objeto de `aa-skills-propias-tenant`.

## Verificaciones finales

- [x] V1 — `npx tsc --noEmit` en back, exit 0.
- [x] V2 — Suite de back completa en verde: 155 ficheros, 1824 pasan, 3 saltados,
      0 rojos. Los dos tests que se tocaron (`skills-purge-plan.test.ts`) se
      cambiaron porque `KEEP_SKILL_NAMES` pasó de 11 a 3 y porque se añadió la
      conservación por `source`, no para que pasaran.
- [x] V3 — Los 8 AC de `validation.md` con test verde o, para los de ejecución
      (AC3), la consulta que lo demuestra pegada en el resumen.
- [x] V4 — `skills.ts` sin endpoint `DELETE` nuevo (AC8).
- [x] V5 — Ninguna cifra («97 borradas») afirmada sin el `count()` que la
      respalda.
