/**
 * F1/F4 (aa-rag-extraccion-estatica-honesta) — extracción robusta de contenido.
 *
 * Verifica sobre el fixture WordPress/Elementor real (hermético, sin red) que el
 * nuevo extractor recupera el grueso del texto y produce múltiples chunks, con
 * banners repetidos deduplicados. Regresión: un artículo simple sigue extrayendo
 * y no arrastra header/footer. F4: chunks de 30-49 chars ya no se pierden.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { htmlToText } from "@/lib/scraper/web";
import { chunkText } from "@/lib/embeddings";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "fixtures/fpeuroformac-wordpress.html"),
  "utf8"
);

describe("F1 — extracción del fixture WordPress/Elementor", () => {
  const text = htmlToText(FIXTURE);

  it("recupera ≥3.000 chars de contenido real (antes ~0)", () => {
    expect(text.length).toBeGreaterThanOrEqual(3000);
  });

  it("produce ≥5 chunks reales", () => {
    expect(chunkText(text).length).toBeGreaterThanOrEqual(5);
  });

  it("deduplica líneas repetidas (banners Elementor no se cuentan N veces)", () => {
    const lines = text.split(/\n{2,}/).map((l) => l.trim()).filter(Boolean);
    // Tras la dedup, no debe quedar ninguna línea repetida exacta.
    expect(new Set(lines.map((l) => l.toLowerCase())).size).toBe(lines.length);
  });
});

describe("F1.2 — regresión: artículo HTML simple", () => {
  const article =
    "<html><body>" +
    "<header>Menú principal Inicio Contacto</header>" +
    "<article><h1>Cómo cuidar plantas de interior</h1>" +
    "<p>" +
    "Las plantas de interior necesitan luz indirecta constante durante el día para crecer sanas y fuertes. ".repeat(2) +
    "</p><p>" +
    "El riego debe ser moderado: la tierra húmeda pero nunca encharcada evita que las raíces se pudran con el tiempo. ".repeat(2) +
    "</p></article>" +
    "<footer>Copyright 2026 Todos los derechos reservados</footer>" +
    "</body></html>";

  const text = htmlToText(article);

  it("conserva el contenido del artículo", () => {
    expect(text).toContain("necesitan luz indirecta");
    expect(text).toContain("riego debe ser moderado");
  });

  it("no arrastra el footer boilerplate", () => {
    expect(text).not.toContain("Todos los derechos reservados");
  });

  it("produce al menos un chunk", () => {
    expect(chunkText(text).length).toBeGreaterThanOrEqual(1);
  });
});

describe("F4 — el filtro no descarta el único contenido útil", () => {
  it("un texto de 30-49 chars sobrevive como chunk (antes: descartado por <50)", () => {
    const short = "Horario de atención: 9 a 14 horas"; // 33 chars
    expect(short.length).toBeGreaterThanOrEqual(30);
    expect(short.length).toBeLessThan(50);
    expect(chunkText(short)).toHaveLength(1);
  });

  it("sigue descartando fragmentos triviales (<25 chars)", () => {
    expect(chunkText("hola")).toHaveLength(0);
  });
});

describe("F1.3 regresión: WordPress normal — no contamina con sidebar ni comentarios", () => {
  // HTML de un WordPress corriente: el cuerpo del artículo va en <article>, pero
  // el sidebar (widgets "Entradas recientes"/"Categorías") y los comentarios NO
  // están envueltos en nav/footer/header, así que el fallback cheerio los arrastra.
  // Readability, en cambio, entrega solo el cuerpo LIMPIO. La lógica vieja "el más
  // largo" elegía cheerio y contaminaba el RAG con navegación y comentarios; el fix
  // prioriza Readability salvo que el fallback lo doble en tamaño (caso Elementor).
  const articleBody = [
    "La poda de los frutales en invierno es una tarea que marca la salud del arbol durante toda la temporada siguiente.",
    "Conviene retirar primero las ramas secas o enfermas, porque compiten por savia y favorecen la aparicion de plagas.",
    "Despues se aclaran los brotes interiores para que la luz y el aire lleguen al centro de la copa sin obstaculos.",
    "Un corte limpio y en angulo, justo por encima de una yema, cicatriza mejor y evita que el agua se acumule en la herida.",
    "Conviene desinfectar las tijeras entre arbol y arbol para no propagar hongos de una planta enferma a otra sana.",
    "Con estos cuidados basicos, el frutal responde en primavera con una floracion mas abundante y fruta de mejor calibre.",
  ].join(" ");
  const html =
    "<html><head><title>Poda de frutales</title></head><body>" +
    "<article><h1>Guia practica de poda de frutales en invierno</h1>" +
    "<p>" + articleBody + "</p></article>" +
    '<aside class="widget-area">' +
    "<h3>Entradas recientes</h3><ul><li>Como abonar el huerto</li><li>Riego por goteo casero</li><li>Semilleros de primavera</li></ul>" +
    "<h3>Categorias</h3><ul><li>Jardineria</li><li>Huerto</li><li>Plagas</li></ul>" +
    "</aside>" +
    '<div id="comments"><h3>Un comentario</h3>' +
    "<p>Excelente articulo, me ha servido muchisimo para animarme a podar mi limonero este año.</p>" +
    "</div>" +
    "</body></html>";
  const text = htmlToText(html);

  it("incluye el cuerpo real del articulo", () => {
    expect(text).toContain("La poda de los frutales en invierno");
    expect(text).toContain("floracion mas abundante");
  });

  it("excluye los widgets del sidebar (Entradas recientes / Categorias)", () => {
    expect(text).not.toContain("Entradas recientes");
    expect(text).not.toContain("Riego por goteo casero");
  });

  it("excluye el texto de los comentarios", () => {
    expect(text).not.toContain("Excelente articulo");
  });
});
