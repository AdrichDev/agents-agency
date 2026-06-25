import { prisma } from "@/lib/db";

const OTHER_SECTOR = "Otro";
const DEFAULT_SECTOR_PAGE_SIZE = 9;
const DEFAULT_SECTORS = [
  "E-commerce",
  "Inmobiliaria",
  "Salud",
  "Educación",
  "Legal",
  "Restauración",
  "SaaS / Tecnología",
  "Servicios profesionales",
];

export function normalizeSectorName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.charAt(0).toLocaleUpperCase("es-ES") + trimmed.slice(1);
}

export function paginateSectors(
  sectors: string[],
  options: { page?: number; pageSize?: number } = {}
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(2, options.pageSize ?? DEFAULT_SECTOR_PAGE_SIZE);
  const actualPageSize = pageSize - 1;
  const unique = [...new Set(sectors.map(normalizeSectorName).filter(Boolean))]
    .filter((sector) => sector.toLocaleLowerCase("es-ES") !== OTHER_SECTOR.toLocaleLowerCase("es-ES"))
    .sort((a, b) => a.localeCompare(b, "es"));
  const totalPages = Math.max(1, Math.ceil(unique.length / actualPageSize));
  const pageItems = unique.slice((page - 1) * actualPageSize, page * actualPageSize);

  return {
    items: [...pageItems, OTHER_SECTOR],
    page,
    pageSize,
    total: unique.length + 1,
    totalPages,
  };
}

/**
 * Tras la fusión/normalización del schema `aa`, la tabla `Sector` fue eliminada:
 * un sector ya no es una entidad propia, es un string asignado a Agent/Tenant.
 * La lista se deriva de los sectores realmente en uso por los agentes, unidos a
 * los sectores por defecto del catálogo.
 */
async function collectSectorNames(): Promise<string[]> {
  const used = await prisma.agent.findMany({
    where: { sector: { not: "" } },
    select: { sector: true },
    distinct: ["sector"],
  });
  return [...DEFAULT_SECTORS, ...used.map((a) => a.sector)];
}

export async function listSectors(options: { page?: number; pageSize?: number } = {}) {
  const names = await collectSectorNames();
  return paginateSectors(names, options);
}

export async function createSector(name: string) {
  const normalized = normalizeSectorName(name);
  if (!normalized || normalized === OTHER_SECTOR) throw new Error("Sector inválido");
  // El sector ya no se persiste como entidad propia (tabla Sector eliminada);
  // se materializa al asignarse a un agente/tenant. Devolvemos el nombre normalizado.
  return { name: normalized };
}
