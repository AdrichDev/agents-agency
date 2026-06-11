"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SectorResponse {
  items: string[];
  page: number;
  totalPages: number;
}

export function useSectors() {
  const [items, setItems] = useState<string[]>(["Otro"]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  async function load(nextPage = page) {
    const data = await api<SectorResponse>(`/api/sectors?page=${nextPage}&pageSize=9&sort=asc`);
    setItems(data.items);
    setPage(data.page);
    setTotalPages(data.totalPages);
  }

  async function addSector(name: string) {
    setAdding(true);
    setStatus("idle");
    try {
      const result = await api<{ error?: string }>("/api/sectors", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (result.error) {
        setStatus("error");
        return;
      }
      setStatus("success");
      await load(1);
    } catch {
      setStatus("error");
    } finally {
      setAdding(false);
    }
  }

  useEffect(() => {
    load(1).catch(() => {});
  }, []);

  return { items, page, totalPages, setPage: load, addSector, adding, status };
}
