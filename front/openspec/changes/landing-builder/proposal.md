# Propuesta — Landing Builder (P6)

> Estado: **proposed** · Nivel estimado: **3-4** · Fase roadmap: **P6**
> Siguiente: `sdd-spec` y `sdd-design` (pueden correr en paralelo).

## Intención

Hoy la agencia construye landing pages a mano. No hay ninguna vía dentro del
producto para que un usuario genere una landing partiendo de una conversación.
Existe ya infraestructura de chat con IA (`/api/chat`, `chatWithAgent`) y un
marketplace de skills, pero ambos están acoplados a los **agentes de cliente**:
no se pueden reutilizar tal cual sin contaminar ese dominio.

**Problema**: falta una herramienta de *vibe coding* conversacional que
transforme un decálogo de preguntas guiadas en un proyecto de landing
multi-archivo listo para editar, previsualizar y descargar — más un scaffold de
app móvil con el mismo branding.

**Por qué ahora**: es el siguiente frente del roadmap (P6) tras cerrar P1-P5.
La pieza diferenciadora frente a generadores genéricos es la fase **prompt
master**, que aplica la metodología de la skill `nidhinjs/prompt-master` del
marketplace para producir prompts de generación de alta calidad.

**Éxito**: un usuario responde ~10 preguntas conversacionales, revisa/edita el
prompt de generación sugerido, genera una landing estática responsive
multi-archivo, la edita en un IDE embebido con preview live, y opcionalmente
genera un scaffold de app Android/iOS. Todo persiste en BD y se puede descargar
en zip.

## Alcance (MVP)

### Flujo conversacional (decálogo)
La IA conduce ~10 preguntas iterativas, una a una, usando `DEFAULT_MODEL` (mini):
1. Para qué es la landing (peluquería, comercio, equipo de fútbol, colegio…).
2. Nombre del negocio / web.
3. Paleta de colores o colores deseados.
4. Estilo visual (minimalista, moderno, clásico, atrevido…).
5. Imágenes propias o placeholders de prueba.
6. Secciones deseadas (hero, servicios, galería, testimonios, contacto…).
7. Llamada a la acción principal.
8. Datos de contacto / redes.
9. ¿Base de datos? (ninguna / local-postgres / Firebase / Supabase) y para qué
   (formulario contacto, reservas…).
10. Idioma y tono de los textos.

Endpoint **propio** (NO `/api/chat`, NO agentes de cliente). Reutiliza el patrón
de `chat.completions.create`, no la entidad Agent.

### Prompt master (paso intermedio)
- Carga la `description` y `tools` de la skill `nidhinjs/prompt-master`
  (description en DB: *"A Claude skill that writes the accurate prompts for any
  AI tool"*) como guía del system prompt.
- Transforma las respuestas del decálogo en **un prompt de generación
  optimizado** + **2-3 prompts de prueba sugeridos** que el usuario acepta o
  edita antes de generar.

### Generación de código
- Modelo potente vía nueva env `STRONG_MODEL` (default `"gpt-5.4"`, NO mini).
  Solo para la **generación de código**; el decálogo usa `DEFAULT_MODEL`.
- Output: proyecto multi-archivo `Json { path → content }`.
- Landing estática SIEMPRE **responsive**: `index.html` + Tailwind CDN + JS
  vanilla. Imágenes placeholder de `picsum.photos` si no hay propias.
- Si eligió BD: incluir capa de datos (snippet config Firebase/Supabase o fetch
  a API local postgres) para el formulario.

### Editor IDE
- Árbol de archivos + editor Monaco (`@monaco-editor/react`).
- Preview live en `<iframe srcdoc>`.
- Botón **regenerar** con feedback en lenguaje natural.
- Cambios manuales editables y persistidos.

### Apps móviles
- Tras generar la landing: botones **"Generar app Android"** y **"Generar app
  iOS"**.
- Genera scaffold **React Native (Expo)** — y **Flutter** como opción en select
  de stack — con las mismas pantallas / branding.
- Archivos van al mismo editor + **descarga zip** (`jszip` client-side).

### Persistencia
Modelo Prisma `LandingProject`:
`{ id, name, business, answers Json, generationPrompt, dbProvider, files Json,
mobileFiles Json, mobileStack, status, createdAt, updatedAt }`
+ migración SQL manual (`back/prisma/migrate-*.sql`, convención del repo).

### UI / Navegación
- Nuevo item `{ href: "/landing-builder", label: "Landing Builder", icon: "🎨" }`
  en `NAV_ITEMS` (`front/lib/navigation.ts`).
- Página `front/app/landing-builder/page.tsx`: lista de proyectos + builder.

### Dependencias
- Front nuevas: `@monaco-editor/react`, `jszip`.
- Back: ninguna nueva (reutiliza OpenAI SDK).

## Fuera de alcance (MVP)

- Deploy / hosting de la landing generada.
- Compilación real de la app móvil (solo scaffold descargable).
- Editor visual drag & drop.
- Versionado / historial de generaciones.

## Aproximación y rationale

- **Endpoint dedicado, no Agent**: el dominio Agent (systemPrompt, skills,
  canales, leads) no encaja con un generador de landings. Acoplarlo
  contaminaría el wizard de agentes de cliente y la captación de leads.
  Modelo nuevo `LandingProject` aislado.
- **Dos modelos por fase**: el decálogo es barato y frecuente → `DEFAULT_MODEL`
  (mini). La generación de código es cara y crítica en calidad →
  `STRONG_MODEL`. Separar evita gastar el modelo potente en charla.
- **Prompt master como skill del marketplace**: aprovecha la skill existente en
  DB como guía, en vez de hardcodear la metodología. Refuerza el valor del
  marketplace.
- **Monaco + iframe srcdoc**: estándar de facto para IDE web; `srcdoc` evita
  servir archivos y da preview instantáneo sin backend de hosting.
- **jszip client-side**: la descarga no necesita pasar por el servidor; reduce
  carga y complejidad del back.
- **Migración SQL manual**: respeta la convención del repo (`prisma db push`
  sobre `migrate-*.sql`).

## Riesgos y preguntas abiertas

- **R1 — `STRONG_MODEL` default `gpt-5.4`**: si la cuenta usa Gemini
  (`GEMINI_API_KEY`), ese modelo no existe en ese provider. Decidir fallback en
  spec/design (¿`STRONG_MODEL` también condicionado por `useGemini`?).
- **R2 — Calidad/coste de generación multi-archivo**: respuestas grandes pueden
  truncarse por límite de tokens. Definir `max_completion_tokens` y estrategia
  (un archivo por llamada vs. JSON completo) en design.
- **R3 — Tamaño de `files Json` en BD**: proyectos grandes pueden inflar la
  fila. Aceptable en MVP; vigilar.
- **R4 — Carga de la skill `prompt-master`**: depende de que exista en DB. Falla
  controlada si no está (fallback a system prompt propio).
- **R5 — Monaco bundle size**: `@monaco-editor/react` es pesado; cargar solo en
  la ruta `/landing-builder` (dynamic import).
- **R6 — Seguridad iframe**: el preview ejecuta JS generado por IA. Usar
  `sandbox` apropiado en el iframe (definir en design).
- **Q1**: ¿el zip incluye solo la landing, o también los archivos móviles
  cuando existan? (Asunción: zip por target — uno landing, uno móvil.)
- **Q2**: ¿`dbProvider` se persiste aunque no se genere capa de datos?
  (Asunción: sí, refleja la respuesta del decálogo.)
