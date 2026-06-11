"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";

  const handleSearch = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) {
      params.set("q", val);
    } else {
      params.delete("q");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <header className="h-16 border-b border-edge flex items-center px-8 gap-4 sticky top-0 bg-ink/80 backdrop-blur z-10">
      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 text-slate-500 relative">
            <span className="absolute left-4 text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Buscar agentes, de forma global..."
              className="input-dark !pl-10 w-full"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
