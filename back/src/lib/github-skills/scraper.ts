// Barrel: preserves the public API of `@/lib/github-skills/scraper` after
// splitting into cohesive submodules under `./scraper-parts/`. All previously
// exported symbols remain importable from this path unchanged.
export * from "@/lib/github-skills/scraper-parts/classification";
export * from "@/lib/github-skills/scraper-parts/discovery";
