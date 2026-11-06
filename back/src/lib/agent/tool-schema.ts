/**
 * S2 (security-wave-2) — validación de los argumentos que el modelo manda a una herramienta.
 *
 * Hasta ahora los argumentos se hacían `JSON.parse` y se pasaban al handler tal cual. El
 * `input_schema` viajaba al proveedor, pero nadie lo comprobaba al recibirlo: era una
 * descripción para el modelo, no una puerta. Con un prompt inyectado el modelo puede emitir
 * `crear_reserva` con `nombre: 123`, 200 KB de `body` o `qualification: "meh"`, y el handler
 * se ejecutaba igual (o reventaba con un TypeError sin mensaje útil para el modelo).
 *
 * Por qué un validador propio y no una dependencia: `back/package.json` sólo trae `zod`, que
 * valida contra un schema de Zod, no contra el JSON Schema que ya declaran las herramientas —
 * traducir 30 schemas a Zod es más código que validar el subconjunto que esos schemas usan.
 * Y añadir `ajv` era una dependencia nueva que esta tarea no necesita.
 *
 * Subconjunto soportado (exactamente lo que usan `tools.ts` y los schemas MCP normalizados):
 *   type: "object" | "string" | "number" | "integer" | "boolean" | "array"
 *   properties, required, enum, items, additionalProperties, maxLength
 *
 * Tope de longitud: las herramientas no declaran `maxLength`, así que toda cadena tiene un
 * techo por defecto. Sin él, un `body` de un email puede meter megabytes en el prompt del
 * turno siguiente y el ataque deja de ser de instrucciones para ser de coste.
 */

/** Techo por defecto de cualquier cadena enviada a una herramienta. */
export const MAX_STRING_LENGTH = 8000;

/** Error de argumentos inválidos: el bucle agéntico lo devuelve al modelo como `{ error }`. */
export class ToolInputError extends Error {
  readonly tool: string;
  readonly problems: string[];

  constructor(tool: string, problems: string[]) {
    super(
      `Argumentos inválidos para la herramienta ${tool}: ${problems.join("; ")}. ` +
        `Corrige los argumentos y vuelve a llamarla.`
    );
    this.name = "ToolInputError";
    this.tool = tool;
    this.problems = problems;
  }
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: unknown[];
  items?: unknown;
  additionalProperties?: boolean;
  maxLength?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valida un valor contra el subconjunto de JSON Schema descrito arriba. */
function problemsFor(
  value: unknown,
  schema: JsonSchema,
  path: string,
  problems: string[]
): void {
  const type = schema.type;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.includes(value)) {
      problems.push(`${path} debe ser uno de: ${schema.enum.map((v) => String(v)).join(", ")}`);
      return;
    }
  }

  switch (type) {
    case undefined:
      return; // sin tipo declarado no hay nada que comprobar
    case "object": {
      if (!isObject(value)) {
        problems.push(`${path} debe ser un objeto`);
        return;
      }
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!(key in value) || value[key] === undefined || value[key] === null) {
          problems.push(`falta el campo obligatorio "${join(path, key)}"`);
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value) || value[key] === undefined) continue;
        problemsFor(value[key], (childSchema ?? {}) as JsonSchema, join(path, key), problems);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) problems.push(`campo no admitido "${join(path, key)}"`);
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        problems.push(`${path} debe ser una lista`);
        return;
      }
      const items = (schema.items ?? null) as JsonSchema | null;
      if (items) {
        value.forEach((item, i) => problemsFor(item, items, `${path}[${i}]`, problems));
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        problems.push(`${path} debe ser texto`);
        return;
      }
      const max = typeof schema.maxLength === "number" ? schema.maxLength : MAX_STRING_LENGTH;
      if (value.length > max) {
        problems.push(`${path} supera el máximo de ${max} caracteres (${value.length})`);
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`${path} debe ser un número`);
      }
      return;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        problems.push(`${path} debe ser un número entero`);
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") problems.push(`${path} debe ser verdadero o falso`);
      return;
    }
    default:
      return; // tipo desconocido: no se inventa una regla que el schema no declara
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Valida `input` contra `schema` y devuelve los argumentos que debe recibir el handler.
 *
 * Devuelve el MISMO objeto cuando los argumentos son válidos: nada se recorta, se renombra ni
 * se rellena con valores por defecto. Cualquier normalización de negocio (teléfonos, fechas,
 * tamaños de grupo) sigue viviendo en el handler, que es donde estaba.
 *
 * Sin schema (herramienta desconocida o MCP externa) no se valida nada: se devuelve la entrada
 * tal cual, que es el comportamiento previo a este cambio.
 */
export function validateToolInput(
  toolName: string,
  schema: unknown,
  input: unknown
): Record<string, unknown> {
  if (!isObject(schema)) return (input ?? {}) as Record<string, unknown>;

  const problems: string[] = [];
  // `null`/`undefined` se tratan como "sin argumentos": un handler que no necesita ninguno
  // (`listar_servicios`) no debe reventar con un TypeError por acceder a `input.x`.
  const args = input === undefined || input === null ? {} : input;

  if (!isObject(args)) {
    throw new ToolInputError(toolName, ["los argumentos deben ser un objeto JSON"]);
  }

  problemsFor(args, schema as JsonSchema, "", problems);
  if (problems.length > 0) throw new ToolInputError(toolName, problems);

  return args;
}
