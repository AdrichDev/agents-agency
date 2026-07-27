/**
 * Política de contraseñas de la plataforma. Un solo sitio donde vive la regla.
 *
 * Se extrae de `routes/auth.ts` en H5 (aa-portal-cliente, T5.1) porque el alta de usuario de portal
 * fija la contraseña inicial y tiene que exigir lo mismo que el cambio de contraseña. Con la función
 * duplicada, el día que alguien endureciera una de las dos quedaría una puerta con la regla vieja — y
 * la puerta débil es la que usa el atacante.
 */

/** `null` si la contraseña cumple; el mensaje del primer incumplimiento si no. */
export function validatePassword(pw: string): string | null {
  if (pw.length < 12) return "La contraseña debe tener al menos 12 caracteres";
  if (!/[a-zA-Z]/.test(pw)) return "La contraseña debe contener al menos una letra";
  if (!/[0-9]/.test(pw)) return "La contraseña debe contener al menos un número";
  return null;
}
