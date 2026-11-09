-- S5 (responses-api-migration, T2) — Retirada de `gpt-4.1-nano`: defaults y datos.
--
-- Por qué: OpenAI retiró el modelo. Las peticiones a `gpt-4.1-nano` devuelven 404 ("The model
-- gpt-4.1-nano has been deprecated") y, como era el default del alta de agentes, nueve agentes —cinco
-- de ellos publicados, entre ellos 3A Estudio— dejaron de responder. El catálogo de código ya no lo
-- ofrece (`src/lib/model-capabilities.ts`, `front/lib/models.ts`) y los `@default` del schema pasan a
-- `gpt-5.6-luna`; esta migración es la mitad que el schema no puede hacer: alinear los DEFAULT de
-- columna que ya existen en la base de datos y reescribir los valores guardados.
--
-- NO es destructiva: no borra filas ni columnas, sólo reescribe un id de modelo por otro que sigue
-- vivo. Dejar escrito `gpt-4.1-nano` no es "una configuración antigua": es un agente que falla en
-- cada turno, con la caída puesta.

-- 1) DEFAULTs de columna. Deben coincidir uno a uno con `schema.prisma` (`Agent.model`,
--    `SystemConfig.defaultAgentModel`, `MarketStudy.model`); los nombres son los mapeados con
--    @@map/@map, y el schema `aa` se califica explícito (el driver-adapter no aplica search_path:
--    ver src/lib/db.ts).
ALTER TABLE "aa"."agente" ALTER COLUMN "modelo" SET DEFAULT 'gpt-5.6-luna';
ALTER TABLE "aa"."configuracion_sistema" ALTER COLUMN "modelo_agente_default" SET DEFAULT 'gpt-5.6-luna';
ALTER TABLE "aa"."estudio_mercado" ALTER COLUMN "modelo" SET DEFAULT 'gpt-5.6-luna';

-- 2) Datos ya guardados.
--    Agentes: el modelo muerto era el default del alta, así que lo más probable es que la mayoría de
--    los agentes lo tengan escrito sin que nadie lo eligiera.
UPDATE "aa"."agente" SET "modelo" = 'gpt-5.6-luna' WHERE "modelo" = 'gpt-4.1-nano';

--    Configuración global: la fila única `default` es la que decide con qué modelo nacen los agentes
--    nuevos, así que un valor muerto aquí reintroduce el problema en cada alta.
UPDATE "aa"."configuracion_sistema" SET "modelo_agente_default" = 'gpt-5.6-luna' WHERE "modelo_agente_default" = 'gpt-4.1-nano';

--    Estudios de mercado: sólo se reescribe el id del modelo; el estudio, sus secciones y sus
--    prospectos quedan intactos y se pueden regenerar con el modelo nuevo.
UPDATE "aa"."estudio_mercado" SET "modelo" = 'gpt-5.6-luna' WHERE "modelo" = 'gpt-4.1-nano';
