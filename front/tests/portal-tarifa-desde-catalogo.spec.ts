import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVICES_CATALOG } from "../components/presupuestos/types";
import {
  CLIENT_ROLE,
  IVA_RATE,
  PORTAL_ROOT,
  conIva,
  porcentajeConsumido,
  tarifaDePlan,
  textoAviso,
} from "../lib/portal";
import { NAV_GROUPS, PORTAL_NAV, navForRole } from "../lib/navigation";

// H5 (aa-portal-cliente, T4.5) — AC9: el importe que ve el cliente sale del catálogo comercial del
// front, y la respuesta del backend no trae ni un precio.
//
// Tests estructurales, sin `page.goto`: el contrato que se defiende aquí es de datos y de código
// fuente, no de DOM (mismo criterio que el bloque de data de navigation.spec.ts, que también se
// resuelve sin navegador). Correr sin servidor: E2E_BASE_URL=http://127.0.0.1:1 npx playwright test
// tests/portal-tarifa-desde-catalogo.spec.ts

/** Fuente del endpoint de portal. Se lee del disco a propósito — ver el test de AC9. */
const PORTAL_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../back/src/routes/portal.ts"),
  "utf8"
);

/**
 * Fuente sin comentarios. Necesario: el propio endpoint documenta en prosa que NO devuelve importes
 * ("el precio vive en Stripe..."), y buscar "precio" sobre el fichero entero suspendería justo al
 * fichero que hace lo correcto. Lo que se audita es el código, no lo que dicen los comentarios.
 */
const PORTAL_ROUTE_CODE = PORTAL_ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  ""
);

test.describe("Portal — la tarifa viene del catálogo (AC9)", () => {
  test("tarifaDePlan resuelve el plan contra el catálogo comercial", () => {
    const starter = tarifaDePlan("chatbot_basic");
    expect(starter).not.toBeNull();
    // El importe no se escribe en el test: se compara con el catálogo, que es la fuente única. Si
    // mañana suben la mensualidad, este test sigue siendo válido en vez de romperse por precio.
    const enCatalogo = SERVICES_CATALOG.find((s) => s.id === "chatbot_basic");
    expect(starter?.maintPrice).toBe(enCatalogo?.maintPrice);
    expect(starter?.name).toBe(enCatalogo?.name);
  });

  test("un plan que no está en el catálogo no inventa tarifa", () => {
    // El caso de HOY: la tabla `plan` está vacía, y cualquier código que llegue no tiene entrada.
    // `null` obliga a la pantalla a decir "consulta con el estudio" en vez de caer a un precio
    // aproximado, que en la pantalla del cliente es peor que ninguno.
    expect(tarifaDePlan("plan_que_no_existe")).toBeNull();
    expect(tarifaDePlan(null)).toBeNull();
    expect(tarifaDePlan(undefined)).toBeNull();
    expect(tarifaDePlan("")).toBeNull();
  });

  test("el catálogo guarda precios sin IVA y el portal los muestra con IVA", () => {
    expect(IVA_RATE).toBe(0.21);
    expect(conIva(100)).toBe(121);
    // Redondeo a céntimo, no a euro: 39 € + 21% = 47,19 €, que es lo que va en la factura.
    expect(conIva(39)).toBe(47.19);
  });

  test("la respuesta del backend no lleva importes", () => {
    // Se inspecciona la fuente del endpoint, no una respuesta viva, porque lo que hay que impedir es
    // que alguien AÑADA el precio al payload. Un test contra un tenant real sólo diría que hoy no
    // viene; esto falla en el commit que lo introduzca, y falla explicando por qué.
    const camposDePrecio = [
      "maintPrice",
      "implPrice",
      "price",
      "precio",
      "importe",
      "amount",
      "IVA_RATE",
      "SERVICES_CATALOG",
    ];
    for (const campo of camposDePrecio) {
      expect(
        PORTAL_ROUTE_CODE.includes(campo),
        `back/src/routes/portal.ts menciona "${campo}": el precio vive en el catálogo del front y en Stripe (H6), no en el payload del portal`
      ).toBe(false);
    }
  });

  test("el backend sólo publica el plan como código y nombre", () => {
    // La pantalla necesita `codigo` para cruzar el catálogo y `nombre` para titular la tarjeta. Nada
    // más: cualquier otro campo del plan sería una segunda fuente para el mismo dato comercial.
    const lineaPlan = PORTAL_ROUTE_CODE.split("\n").find((l) => l.includes("plan: tenant.plan"));
    expect(lineaPlan, "no se encontró el mapeo de `plan` en la respuesta de /me").toBeTruthy();
    expect(lineaPlan).toContain("codigo");
    expect(lineaPlan).toContain("nombre");
    // `tokenQuotaPerAgent` sí se selecciona en Prisma — el cupo del plan se resuelve con él — pero no
    // sale en la respuesta. Un cupo del plan visible junto al cupo efectivo son dos números que el
    // cliente no puede distinguir.
    expect(lineaPlan).not.toContain("tokenQuotaPerAgent");
  });
});

test.describe("Portal — menú y aviso de cupo", () => {
  test("el rol de portal recibe su propio menú, no el del estudio", () => {
    expect(navForRole(CLIENT_ROLE)).toBe(PORTAL_NAV);
    // Todo lo que el cliente ve tiene que caer bajo /portal: es lo único que la puerta del backend
    // (`clientScopeGate`) le deja alcanzar, así que un enlace fuera sería un 403 con forma de botón.
    for (const group of PORTAL_NAV) {
      for (const item of group.items) {
        expect(item.href.startsWith(PORTAL_ROOT)).toBe(true);
      }
    }
  });

  test("cualquier otro rol sigue viendo el menú del estudio", () => {
    // Deny-by-default lo aplica el backend; el menú no es un control de acceso, y un rol desconocido
    // debe seguir comportándose como antes de H5 en vez de quedarse sin navegación.
    expect(navForRole("admin")).toBe(NAV_GROUPS);
    expect(navForRole(null)).toBe(NAV_GROUPS);
    expect(navForRole(undefined)).toBe(NAV_GROUPS);
  });

  test("sin tope no hay porcentaje que enseñar", () => {
    const base = {
      tokensUsedPeriod: 1_000,
      quotaSource: "default" as const,
      remaining: null,
      warning: null,
    };
    expect(porcentajeConsumido({ ...base, tokenQuota: null })).toBeNull();
    expect(porcentajeConsumido({ ...base, tokenQuota: 0 })).toBeNull();
    expect(
      porcentajeConsumido({ ...base, tokensUsedPeriod: 9_000_000, tokenQuota: 10_000_000 })
    ).toBe(90);
    // Consumo por encima del cupo (el gate corta en la petición siguiente, no a mitad de respuesta):
    // la barra se queda en 100, no en 130.
    expect(
      porcentajeConsumido({ ...base, tokensUsedPeriod: 13_000_000, tokenQuota: 10_000_000 })
    ).toBe(100);
  });

  test("el aviso de agotado dice que el asistente deja de responder", () => {
    expect(textoAviso(null)).toBeNull();
    expect(textoAviso("ok")).toBeNull();
    expect(textoAviso("warn75")).toContain("75%");
    expect(textoAviso("warn90")).toContain("deja de responder");
    expect(textoAviso("exhausted")).toContain("no responde");
  });
});
