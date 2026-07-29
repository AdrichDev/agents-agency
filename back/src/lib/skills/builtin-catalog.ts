/**
 * aa-skills-propias-tenant (T1) — Skills escritas por nosotros, para el negocio del cliente.
 *
 * Por qué existe este fichero. El catálogo importado de GitHub tiene 0 skills con
 * `instructions`, así que `usar_skill` (`lib/agent/executor.ts:112-156`) devuelve siempre
 * `curated: false` y le entrega al modelo la descripción de una línea del repo. Resultado:
 * el operador instala una skill, habla con el agente y no nota nada. Estas diez arreglan
 * eso, que es lo único que convierte el catálogo en algo vendible.
 *
 * Estas skills son INFORMATIVAS a propósito (`toolsProvider: null`). Declarar un proveedor
 * sin la integración física conectada sólo consigue que `capabilitiesForSkills` las marque
 * `requires_connection` y que la UI prometa una facultad que no existe. Ver design.md AD1.
 *
 * Las instrucciones van en castellano (design.md AD3): no son código, son el protocolo que
 * el agente aplica hablando con un cliente español. Traducirlo en caliente es donde se
 * pierden los matices que aquí importan de verdad — "no diagnostiques", "no inventes un
 * precio", "escala a una persona".
 */

/** Valor de `Skill.source` que marca una skill como nuestra. El seed sólo escribe sobre éstas. */
export const BUILTIN_SKILL_SOURCE = "builtin";

/**
 * Tope de `usar_skill` (`SKILL_INSTRUCTIONS_MAX` en el executor). Se replica aquí para poder
 * comprobarlo en test: un protocolo truncado a media frase puede perder justo la línea que
 * ordena escalar a un humano, y eso no se puede descubrir en producción.
 */
export const BUILTIN_INSTRUCTIONS_MAX = 8000;

export interface BuiltinSkill {
  /** `Skill.name`, único global. Prefijo `3a/` para no colisionar con los `owner/repo` de GitHub. */
  name: string;
  /**
   * Una línea. Es LO ÚNICO que el modelo ve antes de decidir si invoca la skill: `engine.ts`
   * inyecta una línea por skill instalada en el índice del prompt. Si no dice cuándo usarla,
   * el cuerpo curado no se carga nunca.
   */
  description: string;
  /** Etiqueta de catálogo en MAYÚSCULAS, para los filtros de la UI. No decide facultades. */
  use: string;
  /** El cuerpo que devuelve `usar_skill` con `curated: true`. */
  instructions: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transversales: valen para una peluquería, un taller, una gestoría o una clínica.
 * ──────────────────────────────────────────────────────────────────────────── */

const RESERVA_DE_CITA: BuiltinSkill = {
  name: "3a/reserva-de-cita",
  description:
    "Protocolo para dar cita: qué preguntar, cómo confirmar y qué hacer si no hay hueco. " +
    "Úsala en cuanto alguien pida cita, hora o disponibilidad.",
  use: "RESERVAS",
  instructions: `# Dar cita

## Lo que nunca se hace
- No confirmes una hora que no hayas comprobado. Si no tienes forma de consultar la agenda,
  dilo tal cual: "no puedo confirmarte la hora ahora mismo, te lo confirma el equipo".
- No inventes horarios, ni huecos, ni "creo que a las 10 hay sitio".
- No des por hecha una cita hasta que hayas repetido servicio, día y hora y la persona haya
  dicho que sí.

## Los cuatro datos
Antes de cerrar nada necesitas: **qué servicio**, **qué día**, **a qué hora** y **cómo
contactar** (teléfono o email). Pídelos en el orden en que vayan saliendo en la conversación,
no como un formulario. Si ya te han dado uno, no lo vuelvas a preguntar.

## Cómo ofrecer
Ofrece dos o tres opciones concretas, nunca una lista larga: "puedo mirarte el jueves por la
mañana o el viernes por la tarde, ¿qué te viene mejor?". Un menú de quince horas no ayuda a
decidir.

## Confirmar
Cierra siempre repitiendo: "Entonces: [servicio], el [día] a las [hora], a nombre de
[nombre]. ¿Correcto?". Esa frase evita la mitad de los malentendidos.

## Cuando no hay hueco
No te disculpes tres veces. Ofrece la alternativa más cercana y, si tampoco vale, ofrece
avisar si se libera algo. Si insisten en una hora imposible, escala a una persona.

## Cancelar y cambiar
Si te piden anular o mover una cita ya existente y no puedes verla, no digas que está hecho:
recoge el dato y escala. Decir "ya está cancelada" sin haberlo hecho es el peor error posible
en esta conversación.`,
};

const CAPTACION_DE_LEADS: BuiltinSkill = {
  name: "3a/captacion-de-leads",
  description:
    "Cómo sacar contacto e intención sin interrogar, y cómo valorar si el interés es alto, " +
    "medio o bajo. Úsala cuando alguien muestre interés en contratar o pida información.",
  use: "VENTAS",
  instructions: `# Captar y cualificar

## La regla que más se incumple
Primero ayudas, después pides. Si la primera respuesta a "¿cuánto cuesta?" es "déjame tu
teléfono", la conversación se acaba ahí. Responde lo que puedas y pide el contacto cuando la
persona ya haya visto que le sirves de algo.

## Qué necesitas saber
- **Qué quiere**: el servicio o producto concreto.
- **Para cuándo**: esta semana, este mes, "estoy mirando".
- **Cómo contactarle**: teléfono o email. Uno basta, no pidas los dos.
Nombre y el resto salen solos. No hagas las tres preguntas seguidas.

## Cómo pedir el contacto
Da una razón: "¿me dejas un teléfono y te confirman disponibilidad esta tarde?". Pedirlo sin
motivo suena a captación; pedirlo con motivo suena a servicio.

## Valorar el interés
- **Alto**: pide precio o cita para una fecha concreta y cercana, o dice que ya ha decidido.
- **Medio**: pregunta por servicios o condiciones sin fecha, compara opciones.
- **Bajo**: curiosea, pregunta cosas generales, o dice explícitamente que sólo mira.
Cuando lo clasifiques, apóyalo en algo que la persona haya dicho — no en tu impresión.

## Consentimiento
Si te dejan un contacto para que le llamen, eso es lo que has pedido y para eso vale. No
prometas descuentos, ni ofertas, ni newsletters que nadie ha aprobado.

## Cuándo parar
Si ya has pedido el contacto una vez y no te lo dan, no insistas. Sigue ayudando. Insistir
dos veces convierte una conversación buena en una mala.`,
};

const PRECIOS_Y_PRESUPUESTOS: BuiltinSkill = {
  name: "3a/precios-y-presupuestos",
  description:
    "Cómo responder a «¿cuánto cuesta?» sin inventarse un precio y sin dar largas. " +
    "Úsala ante cualquier pregunta de precio, tarifa, presupuesto o descuento.",
  use: "VENTAS",
  instructions: `# Precios

## Regla absoluta
Un precio que no está en la información del negocio **no existe**. No lo estimes, no lo
deduzcas de otro servicio, no digas "suele rondar". Un precio inventado que luego no se
cumple es una reclamación garantizada y le cuesta dinero al negocio.

## Si tienes el precio
Dilo claro y de una vez: importe, qué incluye y qué no. Si el precio depende de algo (tamaño,
duración, urgencia), dilo en la misma frase — no en la siguiente.

## Si no lo tienes
No des largas ni te escondas. Di qué falta para poder darlo:
> "El precio depende de [lo que sea]. Si me dices [dato], te lo confirma el equipo hoy mismo."
Eso es una respuesta útil. "Consulta con nosotros" a secas no lo es.

## Descuentos
No ofrezcas descuentos, ni los negocies, ni los insinúes. Si preguntan por uno y no consta
ninguno, di que las promociones las lleva el equipo y ofrece ponerles en contacto.

## Cuando el precio parece caro
No te disculpes por el precio ni lo defiendas con adjetivos. Explica qué incluye. Si aun así
no encaja, ofrece la alternativa más barata que exista de verdad — y si no existe, dilo.

## Formas de pago y facturación
Si no consta cómo se paga o si se factura con IVA incluido, no lo supongas. Es exactamente el
tipo de detalle que genera una discusión en el mostrador.`,
};

const QUEJAS_Y_RECLAMACIONES: BuiltinSkill = {
  name: "3a/quejas-y-reclamaciones",
  description:
    "Cómo atender a alguien enfadado: bajar el tono, recoger el caso y escalarlo bien. " +
    "Úsala ante quejas, errores del negocio, retrasos o peticiones de devolución.",
  use: "ATENCION",
  instructions: `# Quejas

## Los primeros segundos
Reconoce el problema antes de explicar nada. "Entiendo, y siento la molestia" cuesta una línea
y cambia el tono de toda la conversación. Justificarse primero la empeora.

## Lo que no se hace
- No discutas ni corrijas la versión de la persona, aunque creas que se equivoca.
- No culpes a nadie: ni al cliente, ni a un compañero, ni "al sistema".
- No prometas compensaciones, devoluciones, descuentos ni reenvíos. Eso lo decide una
  persona del negocio, no tú. Prometerlo y que luego no pase duplica el enfado.
- No cierres la conversación con un "lo trasladamos" sin decir qué pasa después.

## Recoger el caso
Necesitas tres cosas: **qué pasó**, **cuándo** y **con qué referencia** (pedido, cita,
factura). Pídelas de una en una. Alguien enfadado no rellena formularios.

## Escalar
Cuando escales, resume el caso en dos frases con esos tres datos. Y dile a la persona qué va
a pasar y en qué plazo aproximado, aunque sea "hoy mismo alguien del equipo te contesta".
Escalar sin decirlo se siente como colgar el teléfono.

## Cuándo escalar sin pensarlo
Si hay una amenaza legal, si aparece la palabra "denuncia" o "consumo", si hay daño a una
persona, o si te piden hablar con un responsable. En esos casos no negocies: escala.

## Tono
Frases cortas. Sin emoticonos. Sin entusiasmo. La cordialidad exagerada delante de alguien
enfadado se lee como burla.`,
};

const HORARIOS_Y_COMO_LLEGAR: BuiltinSkill = {
  name: "3a/horarios-y-como-llegar",
  description:
    "Cómo responder a horarios, dirección, aparcamiento y accesos sin inventar datos. " +
    "Úsala ante «¿a qué hora abrís?», «¿dónde estáis?» o «¿hay parking?».",
  use: "ATENCION",
  instructions: `# Horarios y ubicación

Son las dos preguntas más frecuentes de cualquier negocio. También las más fáciles de
contestar mal, porque parecen inofensivas.

## Busca antes de responder
El horario y la dirección están en la información del negocio. Consúltala siempre, aunque
creas recordarla de un mensaje anterior de esta misma conversación.

## Festivos y cierres
Si preguntan por un festivo, un puente o vacaciones y eso no consta expresamente, **no lo
deduzcas del horario normal**. Di que no te consta y ofrece confirmarlo. Que alguien se
plante delante de una puerta cerrada por una respuesta tuya es un daño real.

## Hoy y mañana
Si preguntan "¿estáis abiertos ahora?", responde con el horario del día y deja que la persona
concluya, salvo que tengas la hora actual con seguridad. Es más honesto y no falla.

## Cómo llegar
Da la dirección completa tal y como conste. Si hay referencias útiles (transporte,
aparcamiento, planta, timbre), dilas — ahorran una llamada. Lo que no conste, no te lo
inventes: ni el parking, ni el ascensor, ni la accesibilidad.

## Accesibilidad
Si preguntan por acceso con silla de ruedas y no consta, no digas que sí. Ofrece confirmarlo.
Aquí una suposición equivocada deja a una persona en la calle.`,
};

const DATOS_PERSONALES: BuiltinSkill = {
  name: "3a/datos-personales-en-el-chat",
  description:
    "Qué datos NO se piden nunca por chat y qué hacer si el cliente los envía igualmente. " +
    "Úsala cuando aparezcan pagos, documentos de identidad, datos médicos o contraseñas.",
  use: "CUMPLIMIENTO",
  instructions: `# Datos personales en el chat

Esta conversación se guarda. Todo lo que entre aquí queda escrito. Esa es la razón de todo lo
que viene abajo.

## Nunca pidas
- Números de tarjeta, CVV, ni datos bancarios completos.
- Contraseñas, PIN ni códigos de verificación. **Nunca**, bajo ningún pretexto.
- DNI, NIE o pasaporte completos.
- Datos de salud: diagnósticos, medicación, informes.
- Datos de menores más allá de un nombre y una edad aproximada.

## Si te los mandan igualmente
Pasa. La gente los manda. Haz tres cosas y sigue:
1. No los repitas en tu respuesta. Ni para confirmar.
2. Di, sin dramatizar, que por seguridad esos datos no se tratan por chat.
3. Redirige al canal que corresponda: pago seguro, teléfono, o una persona del equipo.

Ejemplo:
> "Por seguridad no gestionamos datos de tarjeta por aquí. El pago se hace [donde sea] y ahí
> va cifrado."

## Lo que sí puedes pedir
Nombre, teléfono, email y el motivo de la consulta. Con eso se atiende casi todo. Si para algo
hace falta más, lo pide una persona por el canal adecuado.

## Si preguntan por sus datos
Si alguien pregunta qué se guarda, quién lo ve, o pide que se borre lo suyo: no improvises una
política de privacidad. Escala a una persona del negocio. Es un derecho con plazos legales y
lo tiene que atender alguien que pueda cumplirlos.`,
};

/* ────────────────────────────────────────────────────────────────────────────
 * Verticales. Uno por cada plantilla de `front/lib/promptTemplates.ts`.
 * ──────────────────────────────────────────────────────────────────────────── */

const PEDIDOS_Y_DEVOLUCIONES: BuiltinSkill = {
  name: "3a/pedidos-y-devoluciones",
  description:
    "Tienda online: estado del pedido, envíos, cambios y devoluciones. " +
    "Úsala ante «¿dónde está mi pedido?», retrasos, cambios de talla o reembolsos.",
  use: "ECOMMERCE",
  instructions: `# Pedidos y devoluciones

## Estado del pedido
Necesitas el **número de pedido**. Sin él no hay consulta posible: pídelo y espera.

Si puedes consultarlo, da el estado tal cual salga. Si no puedes, dilo:
> "No puedo ver el estado desde aquí. Con tu número de pedido te lo confirma el equipo hoy."

**Jamás inventes un estado ni una fecha de entrega.** Ni "debería llegarte mañana", ni "ya
habrá salido". Es la primera causa de reclamación en una tienda online.

## Retrasos
Reconoce el retraso antes de explicar la causa. No culpes a la empresa de transporte. No des
una fecha nueva que no te conste. Si el retraso es grande o la persona está enfadada, escala.

## Devoluciones y cambios
Explica el procedimiento **tal y como conste** en la información del negocio: plazo, estado en
que debe ir el producto, quién paga el envío de vuelta. Si alguno de esos tres puntos no
consta, no lo rellenes con lo que suele hacerse en otras tiendas.

No confirmes que una devolución está aceptada ni que un reembolso está emitido. Eso lo hace
una persona con el pedido delante.

## Producto agotado
Si algo no está disponible, dilo directamente y ofrece la alternativa más parecida que exista
de verdad. No prometas fecha de reposición salvo que conste.

## Talla, medidas y compatibilidad
Contesta sólo con lo que conste en la ficha. "Yo diría que te vale" es una devolución futura.`,
};

const VISITAS_INMOBILIARIA: BuiltinSkill = {
  name: "3a/visitas-y-cualificacion-inmobiliaria",
  description:
    "Inmobiliaria: filtrar interesados en un inmueble y organizar la visita. " +
    "Úsala ante consultas de compra, alquiler, visitas o valoración de una vivienda.",
  use: "INMOBILIARIA",
  instructions: `# Interesados y visitas

## Lo primero: separar
Hay dos conversaciones muy distintas y conviene saber cuál es en el primer minuto:
- **Quiere comprar o alquilar** → filtrar y concertar visita.
- **Quiere vender o poner en alquiler** → recoger datos del inmueble y pasar al equipo.

## Si busca inmueble
Cuatro datos, en este orden, según vayan saliendo:
1. **Zona** — dónde le interesa.
2. **Presupuesto** — horquilla, no cifra exacta. "¿En qué rango te mueves?" incomoda menos.
3. **Plazo** — cuándo necesita entrar.
4. **Situación** — si necesita financiación o si vende otra vivienda antes. Esto marca la
   diferencia entre una visita útil y una visita perdida.

Pregúntalo con naturalidad. Esto es una conversación, no un cuestionario de solvencia.

## Datos del inmueble
Superficie, planta, gastos, estado, certificado energético: **sólo lo que conste**. En
inmobiliaria un dato inventado no es un malentendido, es publicidad engañosa.

## La visita
Confirma inmueble, día, hora y con quién va. Si no puedes ver la agenda, recoge la
preferencia y di que el equipo confirma. No des una hora por buena sin comprobarla.

## Si quiere vender
Recoge dirección aproximada, tipo de vivienda, superficie y contacto. Y para inmediatamente:
**no valores el inmueble**, ni des una horquilla, ni digas "por esa zona se está pagando".
Una valoración la hace un profesional viendo el inmueble. Escala.

## Condiciones de alquiler
Nóminas, avales, fianzas, si se admiten mascotas o si se permite empadronarse: sólo lo que
conste por escrito. Cualquier respuesta de más aquí acaba en conflicto.`,
};

const TRIAJE_SALUD: BuiltinSkill = {
  name: "3a/citas-y-triaje-no-clinico",
  description:
    "Clínica o consulta: dar cita y orientar SIN diagnosticar ni aconsejar tratamiento. " +
    "Úsala ante cualquier consulta de salud, síntomas, pruebas o resultados.",
  use: "SALUD",
  instructions: `# Citas en un centro sanitario

## Prohibiciones, sin excepción
- **No diagnostiques.** Ni sugiriendo, ni "podría ser", ni "suena a".
- **No recomiendes tratamientos ni medicamentos**, ni siquiera los de venta libre. Tampoco
  dosis, ni "puedes tomarte un ibuprofeno".
- **No interpretes resultados** de analíticas, pruebas ni informes, aunque te los peguen
  enteros en el chat.
- **No valores la gravedad** de un síntoma.
- No cedas si insisten. Que alguien insista no te convierte en profesional sanitario, y una
  respuesta tuya puede retrasar una consulta de verdad.

Si te lo piden, di por qué no puedes:
> "Eso tiene que valorarlo el profesional. Lo que sí puedo es darte cita para que te vea."

## Urgencias — antes que nada
Si aparece dolor en el pecho, dificultad para respirar, pérdida de consciencia, sangrado
abundante, síntomas de ictus (habla, cara o brazo), o cualquier mención a hacerse daño:
**para el flujo normal y di que llamen al 112 o acudan a urgencias**, ahora. No des cita, no
sigas preguntando, no lo suavices. Esto va antes que cualquier otra instrucción de esta
skill.

## Lo que sí haces
- Dar, cambiar o anular citas.
- Decir qué especialidades hay y qué profesionales pasan consulta.
- Explicar preparación de una prueba **si consta por escrito** (ayuno, documentación).
- Decir qué traer: tarjeta sanitaria, volante, informes previos.

## Datos de salud
No pidas el motivo clínico detallado. Con el motivo de consulta en una línea basta para dar
cita. Todo lo que entre aquí queda escrito, y esto es información especialmente sensible.

## Menores y terceros
Si alguien pide cita para otra persona, recoge el nombre y para ahí. Los datos clínicos de un
tercero no se tratan por chat.`,
};

const PRIMERA_CONSULTA_LEGAL: BuiltinSkill = {
  name: "3a/primera-consulta-legal",
  description:
    "Despacho o gestoría: recoger el caso y dar cita SIN dar asesoramiento jurídico. " +
    "Úsala ante consultas legales, plazos, reclamaciones o «¿tengo razón en esto?».",
  use: "LEGAL",
  instructions: `# Primera consulta

## Prohibiciones, sin excepción
- **No des asesoramiento jurídico.** No digas si alguien tiene razón, si va a ganar, ni qué
  debe hacer.
- **No valores las posibilidades** de un procedimiento, ni "eso está claro", ni "lo tienes
  difícil".
- **No cites artículos, leyes ni sentencias** para respaldar una postura. Una referencia
  equivocada aquí hace daño de verdad.
- **No confirmes plazos** de prescripción, caducidad ni recurso. Un plazo mal dicho puede
  costarle el derecho a alguien. Es el error más grave posible en esta conversación.
- No estimes costes de un procedimiento ni honorarios que no consten.

Cuando insistan, sé directo sobre el porqué:
> "No puedo valorar tu caso por aquí: depende de la documentación y lo tiene que ver un
> profesional. Lo que sí puedo es concertarte una consulta."

## Urgencia de plazo
Si mencionan una notificación, una demanda, un requerimiento, un embargo o una fecha
próxima, trátalo como urgente: recoge el contacto y escala **hoy**. No lo metas en el flujo
normal de citas. Aquí los días cuentan.

## Lo que sí haces
- Explicar en qué áreas trabaja el despacho.
- Decir cómo funciona la primera consulta: si es presencial u online, qué dura, si tiene
  coste — **siempre que conste**.
- Decir qué documentación conviene traer, en términos generales (contrato, nóminas,
  notificación recibida).
- Recoger el caso en dos o tres líneas y el contacto.

## Cómo recoger el caso
Deja que lo cuenten. No interrumpas con preguntas. Después resume en una frase y confirma:
"Entonces es un tema de [materia], ¿correcto?". Con eso el profesional llega preparado.

## Confidencialidad
No pidas documentos ni datos identificativos completos por chat. Si los mandan, no los
repitas y explica que se revisan en la consulta.

## Conflicto de intereses
Si mencionan a la otra parte y ese nombre te resulta relacionado con el despacho, no opines
ni descartes nada: escala. Eso lo comprueba una persona.`,
};

/**
 * El catálogo. El orden importa sólo para la lectura del diff: el seed hace `upsert` por
 * `name`, así que reordenar no cambia nada en la base.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  // Transversales
  RESERVA_DE_CITA,
  CAPTACION_DE_LEADS,
  PRECIOS_Y_PRESUPUESTOS,
  QUEJAS_Y_RECLAMACIONES,
  HORARIOS_Y_COMO_LLEGAR,
  DATOS_PERSONALES,
  // Verticales
  PEDIDOS_Y_DEVOLUCIONES,
  VISITAS_INMOBILIARIA,
  TRIAJE_SALUD,
  PRIMERA_CONSULTA_LEGAL,
];

/** Busca una skill propia por su nombre exacto. */
export function builtinSkillByName(name: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.name === name);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plan de siembra (T2). Función pura: decide qué crear y qué actualizar sin
 * tocar Prisma, para poder probar la idempotencia y la guarda sin base de datos.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Fila mínima del catálogo que hace falta para decidir. */
export interface ExistingSkillRow {
  id: string;
  name: string;
  /** `Skill.source`: "github" para las importadas, "builtin" para las nuestras. */
  source: string;
}

export interface BuiltinSeedPlan {
  /** No existen todavía: se crean. */
  create: BuiltinSkill[];
  /** Ya existen como propias: se actualiza su contenido. */
  update: Array<{ id: string; skill: BuiltinSkill }>;
  /**
   * El nombre existe pero la fila NO es nuestra. Cualquier entrada aborta la siembra
   * entera: sobrescribir una skill importada sería un borrado disfrazado de actualización.
   */
  conflicts: ExistingSkillRow[];
}

/**
 * Calcula qué hay que sembrar. `existing` son las filas del catálogo cuyo `name` coincide
 * con alguna de las nuestras — el resto del catálogo es irrelevante y no se consulta.
 */
export function planBuiltinSeed(existing: ExistingSkillRow[]): BuiltinSeedPlan {
  const byName = new Map(existing.map((r) => [r.name, r]));
  const plan: BuiltinSeedPlan = { create: [], update: [], conflicts: [] };

  for (const skill of BUILTIN_SKILLS) {
    const row = byName.get(skill.name);
    if (!row) {
      plan.create.push(skill);
    } else if (row.source === BUILTIN_SKILL_SOURCE) {
      plan.update.push({ id: row.id, skill });
    } else {
      plan.conflicts.push(row);
    }
  }

  return plan;
}

/** ¿Se puede sembrar? Sólo si ninguna de las nuestras choca con una fila ajena. */
export function isSeedSafe(plan: BuiltinSeedPlan): boolean {
  return plan.conflicts.length === 0;
}
