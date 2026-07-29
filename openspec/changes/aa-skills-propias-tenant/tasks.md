# Tareas

Orden crítico: el catálogo antes que el seed (el seed lo importa), y el seed antes de tocar
producción. Nada se ejecuta contra la base hasta que T1-T3 estén en verde.

## T1 — Catálogo de skills propias

- [x] T1.1 `back/src/lib/skills/builtin-catalog.ts`: interfaz `BuiltinSkill`, las 10
      definiciones y los helpers puros (`builtinSkillByName`, `BUILTIN_SKILL_SOURCE`).
- [x] T1.2 Escribir las `instructions` de las 6 transversales.
- [x] T1.3 Escribir las `instructions` de las 4 verticales. Salud y Legal llevan la
      prohibición explícita (AC9).
- [x] T1.4 `back/tests/builtin-skills-catalog.test.ts` en verde: AC1, AC4, AC7, AC8, AC9.

## T2 — Seed idempotente

- [x] T2.1 `back/scripts/seed-builtin-skills.ts`: simulacro por defecto, `--apply` para
      escribir. Mismo patrón que `purge-skill-catalog.ts`.
- [x] T2.2 `upsert` por `name`, escribiendo sólo filas con `source: "builtin"`. Si un `name`
      del catálogo existe con otro `source`, **abortar** — es una colisión, no una
      actualización (AC6).
- [x] T2.3 `back/tests/builtin-skills-seed.test.ts` en verde: GWT4.

## T3 — Que se note en la conversación

- [x] T3.1 `back/tests/skill-instructions-curated.test.ts`: GWT1 (`curated: true` con el
      cuerpo dentro), GWT2 (sin instalar, error y ni un fragmento del cuerpo), GWT3
      (importada `false` vs propia `true`).
- [x] T3.2 Comprobar que no hizo falta tocar `executor.ts`. Si hizo falta, el diseño estaba
      mal y hay que revisarlo antes de seguir.

## T4 — Ejecución (gate humano)

- [x] T4.1 Simulacro del seed contra producción. Recuento previo: 108 skills, ninguna
      propia.
- [x] T4.2 Gate: OK explícito de Adrián antes del `--apply`.
- [x] T4.3 `--apply` y recuento posterior por consulta: 10 filas `source: "builtin"`, todas
      con `instructions` (1235-1956 caracteres), `type=SKILL`, `toolsProvider` y `mcpUrl` a
      null, `instructionsUpdatedAt` puesto. Cero sin instrucciones, cero por encima del tope
      de 8000. Segunda pasada en simulacro: 0 crear / 10 actualizar — AC5 demostrado sobre
      datos reales, no en mock.
- [ ] T4.4 Instalar una propia en un agente real y hablar con él por la consola. Guardar la
      respuesta como evidencia de que el comportamiento cambió (AC2 de verdad, no en mock).

## Verificaciones finales

- [x] V1 `npx tsc --noEmit` limpio en `back`.
- [x] V2 Suite de `back` completa en verde, no sólo los ficheros nuevos: 155 ficheros, 1824
      pasan, 3 saltados, 0 rojos.
- [x] V5 **Interacción con la purga, encontrada después de sembrar.** `planSkillPurge`
      repartía sólo por `KEEP_SKILL_NAMES`, y ninguna de las diez propias está en esa lista:
      las diez caían en `remove`. Con las diez ya en producción y la purga aún sin ejecutar,
      un `--apply` las habría borrado sin un solo aviso. Arreglado en
      `aa-catalogo-skills-purga` T1.3: las propias se conservan por `source`. Test de
      regresión verde.
- [ ] V3 Matriz de los 9 AC contra su test verde o su evidencia. Sin evidencia, el AC no
      está cumplido aunque el código exista.
- [ ] V4 Ningún AC se declara cumplido por lectura de código. Ni uno.
