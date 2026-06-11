/** "gestión de proyectos" → "Gestión de proyectos" */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("es-ES") + s.slice(1) : s;
}
