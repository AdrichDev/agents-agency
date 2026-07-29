# Diseño

## Enfoque

Datos, no código. El motor de skills ya funciona; lo que falta es contenido. Por eso el
cambio es: un catálogo declarativo en TypeScript + un seed idempotente + tests. No se toca
`executor.ts`, ni `engine.ts`, ni `routes/skills.ts`.

## Por qué el catálogo vive en el repo y no sólo en la base

Las `instructions` son producto: definen lo que el agente de un cliente dice cuando le
preguntan por un precio o por una urgencia médica. Eso se revisa en un diff, no se edita a
mano en una fila de Postgres. El repo es la fuente; la base es el reflejo.

Consecuencia aceptada: si alguien edita las `instructions` desde
`PATCH /api/skills/:id/instructions`, el siguiente seed las pisa. Es deliberado —
las propias son nuestras. Las importadas de GitHub nunca se tocan (ver la guarda de abajo).

## Estructura

```
back/src/lib/skills/builtin-catalog.ts   # las 10 definiciones + helpers puros
back/scripts/seed-builtin-skills.ts      # upsert idempotente (simulacro por defecto)
back/tests/builtin-skills-catalog.test.ts
back/tests/builtin-skills-seed.test.ts
back/tests/skill-instructions-curated.test.ts
```

## Convención de nombres

Prefijo `3a/`. `Skill.name` es `@unique` y el catálogo importado usa identificadores de
GitHub (`owner/repo`), así que `3a/reserva-de-cita` no puede colisionar con nada existente
ni ahora ni tras un reimport. Además hace obvio en la UI qué skill es nuestra.

## Las 10 skills

Seis transversales — valen para peluquería, taller, gestoría o clínica por igual:

| Nombre | `use` | Qué resuelve |
|---|---|---|
| `3a/reserva-de-cita` | `RESERVAS` | Protocolo de cita: no inventar huecos, confirmar los datos, ofrecer alternativas |
| `3a/captacion-de-leads` | `VENTAS` | Sacar contacto e intención sin interrogar; rúbrica hot/warm/cold |
| `3a/precios-y-presupuestos` | `VENTAS` | Nunca inventar un precio; horquillas, condiciones, cuándo escalar |
| `3a/quejas-y-reclamaciones` | `ATENCION` | Desescalar, no prometer compensación, escalar con el caso resumido |
| `3a/horarios-y-como-llegar` | `ATENCION` | Lo que más se pregunta; festivos y cierres desde el conocimiento, nunca de memoria |
| `3a/datos-personales-en-el-chat` | `CUMPLIMIENTO` | No pedir DNI, tarjeta ni datos de salud por chat. RGPD, y es un argumento de venta |

Cuatro por vertical, uno por cada plantilla de `promptTemplates.ts`:

| Nombre | `use` | Vertical |
|---|---|---|
| `3a/pedidos-y-devoluciones` | `ECOMMERCE` | E-commerce |
| `3a/visitas-y-cualificacion-inmobiliaria` | `INMOBILIARIA` | Inmobiliaria |
| `3a/citas-y-triaje-no-clinico` | `SALUD` | Salud |
| `3a/primera-consulta-legal` | `LEGAL` | Legal |

## Decisiones

**AD1 — Todas nacen con `toolsProvider: null`.**
Podría parecer que `3a/reserva-de-cita` "debería" declarar `calendar`. No: con la integración
física desconectada, `capabilitiesForSkills` la marcaría `requires_connection` y la UI
prometería una facultad que no existe. Informativa y honesta es mejor que ejecutable de
mentira. Cuando un cliente conecte Google, se declara y se prueba — otro change.

**AD2 — `source: "builtin"` como marca de propiedad.**
Es el campo que ya existe en el modelo y que nadie usaba. Sirve de doble filtro: el seed sólo
escribe sobre filas `builtin`, y `aa-catalogo-skills-purga` sólo borra las importadas, así
que una purga posterior no puede llevarse estas por delante.

**AD3 — Instrucciones en castellano.**
Excepción consciente a la regla de "artefactos en inglés": esto no es código, es lo que el
agente le dice a un cliente español. Escribirlo en inglés obligaría al modelo a traducir el
protocolo en caliente, que es justo donde se pierden los matices ("no diagnostiques").

**AD4 — Tope de 8000 caracteres comprobado en test, no confiado al runtime.**
`usar_skill` trunca a `SKILL_INSTRUCTIONS_MAX`. Truncar un protocolo a media frase puede
cortar precisamente la línea que dice "escala a un humano". El test falla antes de que eso
llegue a producción; las diez rondan 1200-2500 caracteres, con margen de sobra.

**AD5 — El seed no instala nada en ningún agente.**
Crear el catálogo y decidir qué agente lleva qué skill son cosas distintas. Instalar es del
operador, desde la ficha del agente. Un seed que instalara automáticamente cambiaría el
comportamiento de agentes de clientes sin que nadie lo pidiera.

## Forma de cada definición

```ts
export interface BuiltinSkill {
  name: string;          // "3a/…", único
  description: string;   // una línea: es lo que el modelo ve en el índice del prompt
  use: string;           // etiqueta UPPERCASE de catálogo, para los filtros de la UI
  instructions: string;  // el cuerpo que devuelve usar_skill con curated: true
}
```

`description` importa más de lo que parece: es lo único que el modelo ve **antes** de decidir
si invoca la skill (`engine.ts:251-266`, una línea por skill instalada). Si la descripción no
dice cuándo usarla, el cuerpo curado no llega a cargarse nunca.

## Flujo de datos

```
builtin-catalog.ts  ──seed──▶  Skill (source=builtin, instructions≠null)
                                  │
                        operador instala ▼
                              AgentSkill(agentId, skillId)
                                  │
                    engine.ts ─── índice: "- 3a/…: <description>"
                                  │
                     modelo decide invocar ▼
                          usar_skill(skillName)
                                  │
                  executor.ts ─── curated: true + [SKILL-nonce]cuerpo[/SKILL-nonce]
```

## Estrategia de test

- **Puro** (sin base): forma del catálogo, tope de longitud, unicidad de nombres, cobertura
  de verticales, y que Salud/Legal contengan sus prohibiciones. Rápido y determinista.
- **Con mock de Prisma**: idempotencia del seed y la guarda de `source`.
- **Sobre `usar_skill`**: los tres GWT de inyección, con `agentSkill.findFirst` mockeado.
- **A mano, una vez**: hablar con un agente real que tenga una propia instalada. Ningún test
  demuestra que el modelo la invoque en el momento adecuado.
