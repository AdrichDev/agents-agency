/**
 * Cobertura del scraping (aa-reservas-validadas-y-cobertura-scraping, bloque C).
 *
 * Fallo REAL que motiva estos tests: en una tienda indexada, "¿cuánto tarda el envío a
 * España?" y "¿puedo devolverlo?" se respondían con "no tengo confirmado el plazo". La
 * causa no era el retrieval: `ingestWebsite` construía su lista como los PRIMEROS 8
 * enlaces del DOM (el menú de cabecera) recortados a 9, así que las páginas de envíos y
 * devoluciones — que viven en el pie — no se descargaban NUNCA. El chunk que respondía a
 * la pregunta no existía en el índice.
 *
 * Test hermético: `safeFetch` mockeado (sin red).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/ssrf", () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  SsrfError: class SsrfError extends Error {},
}));

import { rankCandidateUrls, fetchSitemapUrls, discoverPages, MAX_PAGES } from "@/lib/scraper/web";

const ORIGIN = "https://tienda.test";

function ok(body: string) {
  return { ok: true, status: 200, text: async () => body };
}
function notFound() {
  return { ok: false, status: 404, text: async () => "" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rankCandidateUrls", () => {
  it("prioriza páginas de políticas sobre catálogo (AC5)", () => {
    // Orden de entrada = orden del DOM: el catálogo va primero (menú de cabecera) y las
    // políticas al final (pie). El ranking tiene que invertir eso.
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: `${ORIGIN}/collections/all`, anchor: "Tienda" },
      { url: `${ORIGIN}/products/camiseta`, anchor: "Camiseta" },
      { url: `${ORIGIN}/blog/opiniones`, anchor: "Opiniones" },
      { url: `${ORIGIN}/politica-de-envios`, anchor: "Envíos" },
      { url: `${ORIGIN}/devoluciones`, anchor: "Devoluciones" },
    ]);

    expect(ranked[0]).toBe(ORIGIN);
    expect(ranked.slice(1, 3)).toEqual([`${ORIGIN}/politica-de-envios`, `${ORIGIN}/devoluciones`]);
    // Y el catálogo queda detrás, no descartado.
    expect(ranked).toContain(`${ORIGIN}/collections/all`);
  });

  it("puntúa por el texto del ancla aunque la ruta sea opaca (AC5)", () => {
    // Shopify sirve "/policies/refund-policy" pero también "/pages/a1b2": si la ruta no
    // dice nada, el ancla es la única señal.
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: `${ORIGIN}/pages/x1`, anchor: "Catálogo completo" },
      { url: `${ORIGIN}/pages/x2`, anchor: "Preguntas frecuentes" },
    ]);
    expect(ranked[1]).toBe(`${ORIGIN}/pages/x2`);
  });

  it("ignora acentos al comparar (AC5)", () => {
    // "envíos" es la ÚNICA señal aquí: el ancla va vacía y la ruta no contiene ninguna
    // otra palabra clave. Si el acento no se normaliza, este candidato puntúa 0 y se
    // queda detrás del blog. `rankCandidateUrls` devuelve la URL tal cual entró.
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: `${ORIGIN}/blog/post`, anchor: "Blog" },
      { url: `${ORIGIN}/envíos`, anchor: "" },
    ]);
    expect(ranked[1]).toBe(`${ORIGIN}/envíos`);
  });

  it("funde la misma página servida con y sin www, y prefiere el host del landing", () => {
    // Verificado en una tienda real: el sitemap sirve `www.` y el DOM enlaza sin `www`, así
    // que la misma política aparecía DOS veces en el tope de 25.
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: "https://www.tienda.test/pages/envio/", anchor: "Envíos" },
      { url: `${ORIGIN}/pages/envio`, anchor: "Envíos" },
    ]);
    expect(ranked).toEqual([ORIGIN, `${ORIGIN}/pages/envio`]);
  });

  it("descarta la traducción cuando existe la página original", () => {
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: `${ORIGIN}/en-eu/pages/envio`, anchor: "Shipping" },
      { url: `${ORIGIN}/pages/envio`, anchor: "Envíos" },
    ]);
    expect(ranked).toEqual([ORIGIN, `${ORIGIN}/pages/envio`]);
  });

  it("conserva la ruta con idioma si NO existe la versión sin prefijo", () => {
    // Un sitio que vive entero bajo /es/ no puede quedarse sin páginas.
    const ranked = rankCandidateUrls(ORIGIN, [{ url: `${ORIGIN}/es/envios`, anchor: "Envíos" }]);
    expect(ranked).toEqual([ORIGIN, `${ORIGIN}/es/envios`]);
  });

  it("deduplica y mantiene el orden del DOM en los empates", () => {
    const ranked = rankCandidateUrls(ORIGIN, [
      { url: `${ORIGIN}/a`, anchor: "" },
      { url: `${ORIGIN}/b`, anchor: "" },
      { url: `${ORIGIN}/a`, anchor: "" },
      { url: ORIGIN, anchor: "Inicio" },
    ]);
    expect(ranked).toEqual([ORIGIN, `${ORIGIN}/a`, `${ORIGIN}/b`]);
  });
});

describe("fetchSitemapUrls", () => {
  it("usa sitemap.xml cuando existe (AC6)", async () => {
    safeFetch.mockResolvedValueOnce(
      ok(
        `<?xml version="1.0"?><urlset>
           <url><loc>${ORIGIN}/envios</loc></url>
           <url><loc>${ORIGIN}/devoluciones</loc></url>
           <url><loc>${ORIGIN}/contacto</loc></url>
         </urlset>`
      )
    );

    const urls = await fetchSitemapUrls(ORIGIN);
    expect(urls).toEqual([`${ORIGIN}/envios`, `${ORIGIN}/devoluciones`, `${ORIGIN}/contacto`]);
  });

  it("sigue un sitemapindex un nivel, priorizando el sub-sitemap de páginas (AC6)", async () => {
    // Shopify — la plataforma de la tienda de referencia — sirve en /sitemap.xml un ÍNDICE,
    // no un listado de páginas. Sin seguir ese nivel el sitemap aportaba cero URLs y todo
    // el descubrimiento recaía en los enlaces del DOM.
    safeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/sitemap.xml"))
        return ok(
          `<sitemapindex>
             <sitemap><loc>${ORIGIN}/sitemap_products_1.xml?from=1&amp;to=99</loc></sitemap>
             <sitemap><loc>${ORIGIN}/sitemap_pages_1.xml?from=1&amp;to=9</loc></sitemap>
           </sitemapindex>`
        );
      if (url.startsWith(`${ORIGIN}/sitemap_pages_1.xml`))
        return ok(`<urlset><url><loc>${ORIGIN}/policies/shipping</loc></url></urlset>`);
      if (url.startsWith(`${ORIGIN}/sitemap_products_1.xml`))
        return ok(`<urlset><url><loc>${ORIGIN}/products/x</loc></url></urlset>`);
      return notFound();
    });

    const urls = await fetchSitemapUrls(ORIGIN);

    expect(urls).toContain(`${ORIGIN}/policies/shipping`);
    // El &amp; del índice tiene que llegar decodificado, o la sub-petición va a otra URL.
    expect(safeFetch).toHaveBeenCalledWith(
      `${ORIGIN}/sitemap_pages_1.xml?from=1&to=9`,
      expect.anything()
    );
    // Ningún sub-sitemap se cuela como página a indexar.
    expect(urls.some((u) => u.includes(".xml"))).toBe(false);
  });

  it("acepta el host con www al que redirige el dominio desnudo (AC6)", async () => {
    // `dominio.com/sitemap.xml` → 301 → `www.dominio.com/sitemap.xml`, cuyos <loc> llevan
    // www. Con comparación estricta de origen se descartaban todos, en silencio.
    safeFetch.mockResolvedValueOnce(
      ok(`<urlset><url><loc>https://www.tienda.test/devoluciones</loc></url></urlset>`)
    );
    expect(await fetchSitemapUrls(ORIGIN)).toEqual(["https://www.tienda.test/devoluciones"]);
  });

  it("descarta URLs de otro origen", async () => {
    safeFetch.mockResolvedValueOnce(
      ok(`<urlset><url><loc>https://otra.test/x</loc></url><url><loc>${ORIGIN}/ok</loc></url></urlset>`)
    );
    expect(await fetchSitemapUrls(ORIGIN)).toEqual([`${ORIGIN}/ok`]);
  });

  it("devuelve [] sin lanzar si no hay sitemap", async () => {
    safeFetch.mockResolvedValue(notFound());
    await expect(fetchSitemapUrls(ORIGIN)).resolves.toEqual([]);
  });

  it("devuelve [] sin lanzar si la red falla", async () => {
    safeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchSitemapUrls(ORIGIN)).resolves.toEqual([]);
  });
});

describe("discoverPages", () => {
  it("respeta el tope y conserva la URL raíz primera (AC7)", async () => {
    const locs = Array.from({ length: 60 }, (_, i) => `<url><loc>${ORIGIN}/p${i}</loc></url>`).join("");
    safeFetch.mockImplementation(async (url: string) => {
      if (url.includes("sitemap")) return ok(`<urlset>${locs}</urlset>`);
      return ok("<html><body></body></html>");
    });

    const pages = await discoverPages(ORIGIN);
    expect(pages).toHaveLength(MAX_PAGES);
    expect(MAX_PAGES).toBe(25);
    expect(pages[0]).toBe(ORIGIN);
  });

  it("combina sitemap y enlaces del DOM, con las políticas del PIE por delante (AC5/AC6)", async () => {
    // El HTML imita una tienda: menú arriba, políticas en el pie. Antes el corte "primeros
    // 8 del DOM" se comía el menú y dejaba fuera el pie entero.
    const html =
      "<html><body>" +
      Array.from({ length: 12 }, (_, i) => `<a href="/collections/c${i}">Colección ${i}</a>`).join("") +
      '<footer><a href="/devoluciones">Devoluciones</a>' +
      '<a href="/politica-de-envios">Envíos</a></footer>' +
      "</body></html>";

    safeFetch.mockImplementation(async (url: string) => {
      if (url.includes("sitemap")) return notFound();
      return ok(html);
    });

    const pages = await discoverPages(ORIGIN);

    expect(pages[0]).toBe(ORIGIN);
    expect(pages.slice(1, 3)).toEqual([`${ORIGIN}/devoluciones`, `${ORIGIN}/politica-de-envios`]);
  });

  it("degrada a [landing] si todo falla", async () => {
    safeFetch.mockRejectedValue(new Error("sin red"));
    await expect(discoverPages(ORIGIN)).resolves.toEqual([ORIGIN]);
  });
});
