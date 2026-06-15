# Propuesta — Content Security Policy (Report-Only)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 6 (seguridad)

## Intención

Cerrar la parte de CSP del pilar 6 de forma **segura**. Una CSP *enforcing* con
nonces puede romper el script inline de inicialización de tema (`layout.tsx`) y el
widget cross-origin (`http://localhost:4000/widget.js`); además no es verificable
sin navegador real. El rollout correcto de CSP es **Report-Only primero**: el
navegador evalúa la política y reporta violaciones en consola, pero **NO bloquea**
nada → riesgo cero para la app actual. Tras observar que no hay violaciones
legítimas, se promueve a `Content-Security-Policy` (enforcing) con nonces en un
change posterior.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `front/next.config.mjs` | Modificado | Cabecera `Content-Security-Policy-Report-Only` |

## Política (Report-Only)

```
default-src 'self';
script-src 'self' 'unsafe-inline' http://localhost:4000;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' http://localhost:4000;
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self'
```

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Romper la app | — | Report-Only NO bloquea; solo reporta |
| Falsos positivos de violación | Media | Se observan antes de pasar a enforcing |

## Criterios de éxito

- [x] Las respuestas del front incluyen `Content-Security-Policy-Report-Only`.
- [x] La app sigue funcionando igual (Report-Only no bloquea).
- [x] `next build` verde; cabecera verificada en vivo.
- [x] Documentado: promover a enforcing+nonces es el siguiente paso (con navegador).
