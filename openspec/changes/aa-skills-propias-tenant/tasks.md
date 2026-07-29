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
- [x] T4.4 Hecho contra la base y el LLM reales — ver `evidence-t44.md`. Agente CaressIA
      (`draft`, `gpt-5.4-mini`), misma pregunta genérica con y sin la skill. El agente pidió
      `usar_skill` **por su cuenta** y recibió `curated: true` / `truncated: false`; la
      respuesta pasó a pedir el nombre, uno de los cuatro datos del protocolo. AC2 cumplido
      fuera de mock. Script reutilizable en `scripts/verify-builtin-skill.ts`; deshace la
      instalación al terminar y marca las conversaciones `isTest`.

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
- [x] V3 Matriz de los 9 AC contra su test verde o su evidencia. Sin evidencia, el AC no
      está cumplido aunque el código exista. Ver abajo.
- [x] V4 Ningún AC se declara cumplido por lectura de código. Ni uno. Cada fila de la matriz
      apunta a un test que se ha ejecutado o a una ejecución contra la base real. Las dos
      columnas de la derecha existen justo para eso: si un AC sólo tuviera «test verde» y su
      cumplimiento dependiera del comportamiento real, se dice.

## Matriz de AC (V3)

Ejecutado el 29/07/2026: `npx vitest run tests/builtin-skills-catalog.test.ts
tests/builtin-skills-seed.test.ts tests/skill-instructions-curated.test.ts` → **3 ficheros,
29 tests, 0 rojos**.

Los tests de `skill-instructions-curated` y `builtin-skills-seed` ejercitan las funciones
reales (`loadSkillInstructions`, `planBuiltinSeed`) con la base sustituida. Eso demuestra la
lógica, no el comportamiento del sistema montado. Por eso los AC que dependen de la base o del
modelo llevan además una ejecución real; los que son propiedades del catálogo (un fichero
estático) no la necesitan, porque el test lee el mismo dato que se siembra.

| AC | Qué exige | Test verde | Ejecución real |
|----|-----------|-----------|----------------|
| AC1 | Toda propia con `instructions` no vacías | `builtin-skills-catalog` → «AC1 — toda skill propia trae instrucciones curadas no vacías» | T4.3: consulta a producción, 10 filas, 1235-1956 caracteres, cero vacías |
| AC2 | `usar_skill` devuelve `curated: true` con el cuerpo dentro del bloque | `skill-instructions-curated` → GWT1, dos tests: cuerpo dentro del bloque, y marco anti-inyección delante | `evidence-t44.md`: LLM real, `curated: true`, bloque `[SKILL-19d90677ed2e1d60]`. El agente pidió la skill por su cuenta |
| AC3 | Sin instalar: error, y ni un fragmento del cuerpo | `skill-instructions-curated` → GWT2, dos tests: error honesto sin fragmento, y nombre vacío | No aplica: es una negativa. La ejecución real de T4.4 corrió primero **sin** la skill y devolvió `toolCalls: []` — el modelo no llegó ni a pedirla |
| AC4 | Ninguna declara `toolsProvider` | `builtin-skills-catalog` → «AC4 — ninguna declara `toolsProvider`: nacen informativas» | T4.3: `toolsProvider` y `mcpUrl` a null en las 10 filas de producción |
| AC5 | Seed idempotente | `builtin-skills-seed` → GWT4, tres tests: segunda pasada 0 crear, cada update al id existente, siembra parcial | T4.3: segunda pasada en simulacro contra producción → **0 crear / 10 actualizar** |
| AC6 | El seed no toca filas que no sean nuestras | `builtin-skills-seed` → «las filas importadas de GitHub no entran en el plan», más las tres guardas de `source` (colisión bloquea la siembra entera, `source` desconocido también) | T4.1: el simulacro contra las 108 importadas no propuso tocar ninguna |
| AC7 | Ninguna por encima de `SKILL_INSTRUCTIONS_MAX` (8000) | `builtin-skills-catalog` → «AC7 — ninguna supera el tope»; `skill-instructions-curated` → «ninguna de las diez se trunca» | `evidence-t44.md`: `truncated: false` con la skill más larga del catálogo servida de verdad |
| AC8 | Cada vertical que vendemos tiene al menos una skill | `builtin-skills-catalog` → «AC8 — cada vertical que vendemos tiene al menos una skill» | No aplica: la lista de verticales es un dato del repo, no del entorno. El test la cruza con el catálogo |
| AC9 | Salud y Legal con la prohibición explícita | `builtin-skills-catalog` → dos tests de AC9 (Salud: no diagnosticar, derivar a urgencias; Legal: no asesorar ni confirmar plazos). Más tres de la misma familia: dinero, datos personales, reservas | No aplica: es texto del catálogo, y el texto del catálogo es lo que se siembra (AC1 lo comprueba en producción) |

**Lo que la matriz no cubre, y hay que decirlo.** AC2 está demostrado con **una** de las diez
skills (`3a/reserva-de-cita`). Que el mecanismo llegue a la boca del agente está probado; que
las diez estén *bien escritas* no lo está, y sólo se sabría conversando con cada una. Queda
como deuda conocida, no como AC pendiente: el AC habla del mecanismo, no de la calidad de la
redacción.
