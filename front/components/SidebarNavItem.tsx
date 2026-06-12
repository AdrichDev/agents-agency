"use client";

import Link from "next/link";

export default function SidebarNavItem({
  href,
  label,
  icon,
  active,
  collapsed = false,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  collapsed?: boolean;
  badge?: number;
}) {
  const showBadge = typeof badge === "number" && badge > 0;
  const badgeText = badge && badge > 99 ? "99+" : String(badge ?? "");

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition relative ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-white/5 text-white font-bold"
          : "text-slate-400 hover:text-white hover:bg-white/5"
      }`}
    >
      {active && <div className="absolute left-0 top-0 bottom-0 w-1 bg-neon-gradient rounded-l-xl" />}
      <span className={`relative text-lg ${active ? "text-neon-cyan" : "text-slate-500"}`}>
        {icon}
        {showBadge && collapsed && (
          <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-yellow-400 text-black text-[9px] font-black grid place-items-center leading-none shadow-[0_0_8px_rgba(250,204,21,0.6)]">
            {badgeText}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="flex items-center gap-2 min-w-0">
          {label}
          {showBadge && (
            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-yellow-400 text-black text-[10px] font-black grid place-items-center leading-none shadow-[0_0_8px_rgba(250,204,21,0.6)]">
              {badgeText}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
