"use client";

import Link from "next/link";

export default function SidebarNavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition relative overflow-hidden ${
        active
          ? "bg-white/5 text-white font-bold"
          : "text-slate-400 hover:text-white hover:bg-white/5"
      }`}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-1 bg-neon-gradient" />}
      <span className={active ? "text-neon-cyan" : "text-slate-500"}>{icon}</span>
      {label}
    </Link>
  );
}

