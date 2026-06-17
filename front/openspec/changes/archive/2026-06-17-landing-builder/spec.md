# Landing Builder Specification

## Purpose

Herramienta de vibe coding conversacional que transforma un decálogo de preguntas guiadas en un proyecto de landing page multi-archivo, editable con IDE embebido y con scaffold de app móvil descargable. Dominio aislado de los agentes de cliente.

---

## Requirements

### Requirement: Decálogo Conversacional

El sistema DEBE conducir al usuario a través de ~10 preguntas iterativas (propósito, nombre de negocio, paleta, estilo, imágenes, secciones, CTA, contacto/redes, BD y uso, idioma/tono) mediante un endpoint dedicado `POST /api/landing/chat` que usa `DEFAULT_MODEL`. Las respuestas se acumulan en `answers Json`. El usuario DEBE poder responder "decide tú" para delegar cualquier pregunta a la IA. La IA DEBE adaptar el orden y las repreguntas según las respuestas previas.

#### Scenario: Flujo completo del decálogo

- GIVEN un usuario inicia un nuevo LandingProject
- WHEN envía respuestas a las preguntas una a una
- THEN el sistema devuelve la siguiente pregunta adaptada al contexto acumulado
- AND almacena cada respuesta en `answers`

#### Scenario: Delegación a la IA

- GIVEN el usuario está en cualquier punto del decálogo
- WHEN responde "decide tú" o equivalente
- THEN el sistema genera un valor razonable para esa pregunta y continúa con la siguiente
- AND registra la decisión en `answers` indicando que fue asumida por la IA

#### Scenario: Decálogo completado

- GIVEN todas las preguntas han recibido respuesta (directa o delegada)
- WHEN el sistema detecta el decálogo completo
- THEN activa el paso de Prompt Master automáticamente

---

### Requirement: Prompt Master

El sistema DEBE cargar la skill `nidhinjs/prompt-master` desde la base de datos (buscando por `name contains "prompt-master"`) para usar su descripción como guía del system prompt. Si la skill no existe, DEBE usar un fallback embebido. Con las respuestas del decálogo, DEBE generar: un prompt de generación optimizado y 2-3 prompts de prueba alternativos. El usuario DEBE poder editar el prompt seleccionado antes de continuar.

#### Scenario: Skill prompt-master presente en BD

- GIVEN el decálogo está completo y la skill `nidhinjs/prompt-master` existe en BD
- WHEN el sistema invoca `POST /api/landing/prompt`
- THEN usa la descripción de la skill como guía del system prompt
- AND devuelve `generationPrompt` + 2-3 prompts alternativos al frontend

#### Scenario: Skill prompt-master ausente (fallback)

- GIVEN la skill `nidhinjs/prompt-master` no existe en BD
- WHEN el sistema invoca `POST /api/landing/prompt`
- THEN usa el fallback embebido sin error visible al usuario
- AND devuelve `generationPrompt` + 2-3 prompts alternativos con igual calidad observable

#### Scenario: El usuario edita el prompt antes de generar

- GIVEN el usuario recibe `generationPrompt` y los alternativos
- WHEN selecciona uno y lo edita manualmente
- THEN el sistema usa la versión editada en la generación posterior
- AND persiste la versión final en `LandingProject.generationPrompt`

---

### Requirement: Generación de Landing Multi-Archivo

El sistema DEBE usar `STRONG_MODEL` para generar un proyecto `files Json { path → content }` a partir del `generationPrompt`. La landing DEBE ser siempre responsive (viewport meta tag, breakpoints CSS) con `index.html` + Tailwind CDN + JS vanilla. Las imágenes DEBEN ser placeholders de `picsum.photos` salvo que el usuario haya indicado imágenes propias. Si `dbProvider` no es `"none"`, DEBE incluir la capa de datos correspondiente (snippet Firebase/Supabase o fetch a API local). El `status` del proyecto pasa de `draft` a `generated`.

Si `STRONG_MODEL` no está configurado y `GEMINI_API_KEY` está activo, DEBE usar `"gemini-2.5-pro"` como fallback.

#### Scenario: Generación exitosa con BD "none"

- GIVEN `generationPrompt` está listo y `dbProvider = "none"`
- WHEN el usuario confirma y el sistema llama a `POST /api/landing/generate`
- THEN el modelo `STRONG_MODEL` devuelve `files` con al menos `index.html` responsive
- AND `status` se actualiza a `generated`

#### Scenario: Generación con Firebase seleccionado

- GIVEN `dbProvider = "firebase"`
- WHEN el sistema genera el proyecto
- THEN `files` incluye un snippet de configuración de Firebase para el formulario indicado

#### Scenario: Respuesta del modelo no parseable como `files Json`

- GIVEN el modelo devuelve contenido que no es JSON válido `{ path → content }`
- WHEN el sistema intenta parsear la respuesta
- THEN reintenta la llamada al modelo hasta 2 veces con instrucción de corrección de formato
- AND si persiste, devuelve error claro al usuario con el texto crudo recibido

#### Scenario: `STRONG_MODEL` no configurado con Gemini activo

- GIVEN `STRONG_MODEL` no está en las variables de entorno y `GEMINI_API_KEY` está definido
- WHEN el sistema necesita generar código
- THEN usa `"gemini-2.5-pro"` como modelo efectivo sin error
- AND registra el fallback en los logs del servidor

---

### Requirement: Editor IDE Embebido

El sistema DEBE mostrar un árbol de archivos, un editor Monaco (dynamic import, solo en `/landing-builder`) y un preview live en `<iframe srcdoc>` con atributo `sandbox` restrictivo. Las ediciones manuales DEBEN persistirse vía `PUT /api/landing/:id`. El botón "Regenerar" DEBE aceptar feedback en lenguaje natural y regenerar conservando los archivos que el usuario no haya solicitado cambiar.

#### Scenario: Edición manual y persistencia

- GIVEN el usuario está en el editor IDE con un proyecto `generated`
- WHEN edita un archivo y guarda
- THEN el sistema envía `PATCH /PUT /api/landing/:id` con los `files` actualizados
- AND el preview live refleja el cambio sin recargar la página entera

#### Scenario: Regeneración con feedback

- GIVEN el usuario escribe feedback ("agrega sección de testimonios")
- WHEN pulsa "Regenerar"
- THEN el sistema llama a `POST /api/landing/:id/regenerate` con el feedback
- AND el modelo actualiza solo los archivos afectados, conservando los demás
- AND el editor refleja los cambios manteniendo ediciones manuales previas en archivos no tocados

#### Scenario: Tamaño de `files` excede límite

- GIVEN el proyecto generado supera el límite de tamaño definido para `files Json`
- WHEN el sistema intenta persistir
- THEN notifica al usuario con un aviso claro
- AND persiste hasta el límite admitido sin silenciar el error

---

### Requirement: Apps Móviles

El sistema DEBE ofrecer botones "Generar app Android" y "Generar app iOS" con un selector de stack (Expo por defecto, Flutter opcional). La generación usa `STRONG_MODEL` y produce `mobileFiles Json` con scaffold que refleja el branding y secciones de la landing. Los archivos DEBEN cargarse en el mismo editor IDE. La descarga DEBE ser un zip independiente por target (landing y móvil separados) generado client-side con `jszip`.

#### Scenario: Generación de scaffold Expo

- GIVEN el proyecto tiene `status = "generated"` y el usuario selecciona Expo + Android
- WHEN pulsa "Generar app Android"
- THEN el sistema llama a `POST /api/landing/:id/mobile` con `{ mobileStack: "expo", target: "android" }`
- AND devuelve `mobileFiles` con estructura Expo que refleja las secciones y paleta de la landing

#### Scenario: Descarga zip landing

- GIVEN el proyecto tiene `files` generados
- WHEN el usuario descarga la landing
- THEN se genera un zip client-side con solo los archivos de la landing
- AND el zip es descargable sin llamada al servidor

#### Scenario: Descarga zip móvil

- GIVEN el proyecto tiene `mobileFiles` generados
- WHEN el usuario descarga la app móvil
- THEN se genera un zip client-side separado con solo los archivos móviles

---

### Requirement: Base de Datos Incorporable en Todo Momento

El sistema DEBE permitir cambiar `dbProvider` después de haber generado la landing. Al cambiar, DEBE regenerar parcialmente la capa de datos sin perder ediciones manuales del resto de archivos. Si hay colisión entre la capa regenerada y ediciones manuales en los mismos archivos, DEBE avisar al usuario antes de sobrescribir.

#### Scenario: Cambio de dbProvider post-generación sin colisión

- GIVEN el proyecto tiene `status = "generated"` y el usuario cambia `dbProvider` de `"none"` a `"supabase"`
- WHEN confirma el cambio
- THEN el sistema regenera solo los archivos de la capa de datos (Supabase snippets)
- AND los demás archivos editados manualmente no se modifican

#### Scenario: Colisión con edición manual

- GIVEN el usuario ha editado manualmente `index.html` y luego cambia `dbProvider`
- WHEN la regeneración parcial afecta `index.html`
- THEN el sistema muestra un aviso claro con diff antes de proceder
- AND solo aplica los cambios si el usuario confirma

---

### Requirement: Persistencia y Navegación

El sistema DEBE mostrar un ítem "Landing Builder" (icono 🎨) en la navegación principal. La página `/landing-builder` DEBE listar proyectos existentes en cards con acciones de crear, abrir y borrar. Cada operación sobre `LandingProject` MUST cumplir las convenciones CRUD estándar del backend (`GET /api/landing`, `GET /api/landing/:id`, `PUT /api/landing/:id`, `DELETE /api/landing/:id`).

#### Scenario: Listado de proyectos

- GIVEN el usuario navega a `/landing-builder`
- WHEN la página carga
- THEN muestra cards de todos sus `LandingProject` con nombre, estado y fecha de actualización

#### Scenario: Crear nuevo proyecto

- GIVEN el usuario está en la lista
- WHEN pulsa "Nuevo proyecto"
- THEN se crea un `LandingProject` con `status = "draft"` y se abre el decálogo conversacional

#### Scenario: Borrar proyecto

- GIVEN el usuario selecciona borrar un proyecto
- WHEN confirma la acción
- THEN el sistema llama a `DELETE /api/landing/:id` y elimina el registro
- AND la lista se actualiza sin recargar la página
