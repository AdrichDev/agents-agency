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
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
        active
          ? "bg-white/5 text-white border-l-2 border-indigo-500"
          : "text-slate-400 hover:text-white hover:bg-white/5"
      }`}
    >
      <span className="text-indigo-400">{icon}</span>
      {label}
    </Link>
  );
}

