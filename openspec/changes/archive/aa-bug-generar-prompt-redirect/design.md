# Design — aa-bug-generar-prompt-redirect

**Nivel Gru: 3.** Toca el interceptor global de sesión (`front/lib/api.ts`), transversal a toda la app. Comparte archivo con `aa-bug-acceso-sin-sesion` → coordinar ambos.

## 0. Hechos confirmados (investigación read-only front 2026-07-01)
- Botón "✨ Generar prompt" es `<button onClick={loadPrompts}>` real (`front/components/landing/PromptPicker.tsx:96-104`) — **NO** es `<a>`/`<Link href="/">`. Descartada la hipótesis del audit de "href accidental".
- `loadPrompts()` (`PromptPicker.tsx:47-63`) → `api("/api/landing/${projectId}/prompts", {method:"POST"})`.
- `api()` (`front/lib/api.ts:29-46`) SÍ adjunta `Authorization: Bearer <token>` desde `supabase.auth.getSession()` (`lib/api.ts:22-30`).
- Interceptor global (`front/lib/api.ts:64-73`): ante **cualquier** `res.status === 401` hace `supabase.auth.signOut({scope:"local"})` + `window.location.href = "/"` (salvo si ya estás en `/`).

```js
// lib/api.ts:64-73 (estado actual)
if (res.status === 401 && typeof window !== "undefined") {
  await getSupabaseClient()?.auth.signOut({ scope: "local" }).catch(() => {});
  const onLanding = window.location.pathname === "/";
  if (!onLanding) window.location.href = "/";
}
```

- **Causa real**: el 401 de `POST /api/landing/:id/prompts` cae en este interceptor → hard-redirect que tira sesión + contexto. El botón no navega por sí mismo.
- **NO confirmado (fuera del repo front)**: por qué el backend `:4000` devuelve 401 en ese flujo. Requiere T0 backend.

## 1. Bifurcación de causa (resolver en T0)
El fix real depende de por qué llega el 401:
- **(A) 401 legítimo** — la sesión de verdad expiró/no era válida → el problema es la *reacción* del front (hard-redirect ciego). Fix = front.
- **(B) 401 espurio** — token válido pero no adjunto a tiempo (`getSession()` async no resuelto), scope incorrecto, o el endpoint exige algo que el token no lleva → fix real = backend/adjunción de token, y el front igual debe dejar de reaccionar de forma destructiva.

En ambos casos el front cambia; en (B) además hay trabajo backend. T0 lo decide antes de tocar código.

## 2. Diseño del front — endurecer el interceptor 401
Reemplazar el hard-redirect ciego por manejo graceful (MEJORA#15):

- **Distinguir sesión expirada de error puntual.** Antes de `signOut`, verificar `getSession()`: si aún hay sesión válida, el 401 fue espurio → NO hacer signOut; propagar el error a quien llamó (`loadPrompts` muestra su propio estado de error) sin navegar.
- **Si la sesión de verdad expiró**: en vez de `window.location.href="/"` (navegación dura que pierde todo), mostrar aviso ("Tu sesión expiró, vuelve a entrar") y preservar la ruta actual con `returnTo` (patrón compartido con `aa-bug-acceso-sin-sesion`, ver §3 de ese design) para que tras re-login vuelva a `/landing-builder/{id}`.
- **No usar `window.location.href`** para la navegación de auth: usar el router de Next (`router.replace`) para no perder el estado de React salvo que sea imprescindible.

### Punto único
Confirmar en T0 que `lib/api.ts:64-73` es el único sitio que maneja 401 (grep `401` y `signOut` en front). Si hay excepciones, tratarlas coordinadas.

## 3. Contrato compartido con aa-bug-acceso-sin-sesion
Ambos changes editan `lib/api.ts:64-73` + introducen el mecanismo `returnTo` + apertura de login modal. **Decisión**: el mecanismo de "sesión ausente/expirada → aviso + returnTo + modal login" se diseña una vez y ambos changes lo consumen. Implementar en el orden: primero el guard/return-to de `aa-bug-acceso-sin-sesion` (crea el mecanismo), luego este change lo reutiliza en el path de expiración. Evita comportamiento inconsistente entre "expira en acción" y "acceso directo sin sesión".

## 4. Seguridad
| Riesgo | Mitigación |
|---|---|
| No hacer signOut ante 401 legítimo deja sesión inválida activa | Solo se omite signOut si `getSession()` confirma sesión válida; si no, signOut + returnTo. |
| returnTo abierto a open-redirect | `returnTo` solo acepta rutas internas relativas (empieza por `/`, sin `//` ni esquema). |
| Loguear token/sesión al depurar el 401 | Nunca loguear el Bearer ni el contenido de la sesión. |

## 5. Plan
- **T0** (bloqueante): confirmar en backend `:4000` por qué `POST /api/landing/:id/prompts` da 401 → decide rama (A)/(B). Confirmar que `lib/api.ts:64-73` es punto único de 401.
- **T1**: (si B) fix backend/adjunción de token + test.
- **T2**: endurecer interceptor `lib/api.ts` (distinguir expirada vs espurio; aviso + returnTo; sin hard-redirect ciego) — coordinado con `aa-bug-acceso-sin-sesion`.
- **T3**: test Playwright — 401 en "Generar prompt" no debe expulsar al homepage perdiendo sesión válida; si expiró, muestra aviso y conserva returnTo.
