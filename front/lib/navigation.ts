export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

/**
 * Sidebar navigation grouped by functional domain (aa-navegacion-lateral-agrupada).
 * Order and composition are business-defined — see proposal.md decisions.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "general",
    label: "Nombre grupal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "📊" },
      { href: "/cuenta", label: "Mi Cuenta", icon: "👤" },
      { href: "/configuracion", label: "Configuración", icon: "⚙️" },
    ],
  },
  {
    id: "pedidos",
    label: "Pedidos",
    items: [
      { href: "/agents/new", label: "Nuevo Agente", icon: "✨" },
      { href: "/skills", label: "Marketplace", icon: "🛒" },
      { href: "/landing-builder", label: "Landing Builder", icon: "🎨" },
    ],
  },
  {
    id: "clientes-lead",
    label: "Clientes / Lead",
    items: [
      { href: "/clientes", label: "Clientes", icon: "👥" },
      { href: "/contactos", label: "Contactos", icon: "📇" },
    ],
  },
  {
    id: "facturacion",
    label: "Facturación",
    items: [
      { href: "/facturacion", label: "Presupuestos", icon: "💳" },
      { href: "/facturas", label: "Facturas", icon: "🧾" },
      { href: "/tarifas", label: "Tarifas", icon: "🏷️" },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { href: "/estadisticas", label: "Estadísticas", icon: "📈" },
    ],
  },
] as const;

/**
 * Vista plana derivada de NAV_GROUPS, para compatibilidad con consumidores
 * que esperen la lista de items sin jerarquía de grupos.
 */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
