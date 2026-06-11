import { prisma } from "@/lib/db";

export const OTHER_SECTOR = "Otro";
export const DEFAULT_SECTOR_PAGE_SIZE = 9;
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

export async function ensureDefaultSectors() {
  await Promise.all(
    DEFAULT_SECTORS.map((name) =>
      prisma.sector.upsert({
        where: { name },
        create: { name },
        update: {},
      })
    )
  );
}

export async function listSectors(options: { page?: number; pageSize?: number } = {}) {
  await ensureDefaultSectors();
  const sectors = await prisma.sector.findMany({ select: { name: true } });
  return paginateSectors(
    sectors.map((sector) => sector.name),
    options
  );
}

export async function createSector(name: string) {
  const normalized = normalizeSectorName(name);
  if (!normalized || normalized === OTHER_SECTOR) throw new Error("Sector inválido");

  return prisma.sector.upsert({
    where: { name: normalized },
    create: { name: normalized },
    update: {},
  });
}
