/**
 * Widget embebible de agent-agency.
 * Uso: <script src="https://TU-APP.vercel.app/widget.js" data-agent-key="PUBLIC_KEY"></script>
 */
(function () {
  // Una sola instancia por documento. Sin esto, el cliente que pega el snippet en la
  // cabecera y en el pie de su plantilla se encuentra dos burbujas superpuestas, y la
  // segunda abre una conversacion distinta de la que ve abierta.
  if (document.getElementById("aa-bubble")) return;

  var script = document.currentScript;
  var KEY = script.getAttribute("data-agent-key");
  var BASE = script.src.replace(/\/widget\.js.*$/, "");
  var conversationId = null;
  // Defaults de plantilla en una constante: hacen falta al inicializar y en cada
  // mezcla posterior. Escritos dos veces es como se desincronizan.
  var DEFAULT_TEMPLATE = { position: "right", launcherShape: "circle", panelSize: "normal" };
  // Ultimo recurso cuando la respuesta no trae ni texto ni error. Lo lee un visitante en la web de
  // un cliente: dice que no se puede responder, y nada mas.
  var FALLBACK_ERROR = "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.";
  var config = {
    name: "Asistente",
    primaryColor: "#4f46e5",
    secondaryColor: "#9333ea",
    avatarEmoji: "🤖",
    avatarUrl: "",
    avatarBase64: "",
    template: Object.assign({}, DEFAULT_TEMPLATE),
  };
  // Nodo del saludo, si ya está pintado. Se guarda para poder reescribirlo cuando
  // llegue la identidad real del agente, sin buscarlo por selector.
  var greetingEl = null;

  var css =
    "#aa-bubble{position:fixed;bottom:24px;width:56px;height:56px;border-radius:50%;background:var(--aa-primary);color:#fff;border:none;cursor:pointer;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:99998;overflow:hidden;display:grid;place-items:center}" +
    "#aa-bubble img{width:100%;height:100%;object-fit:cover}" +
    "#aa-panel{position:fixed;bottom:92px;width:360px;max-width:calc(100vw - 32px);height:480px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:system-ui,sans-serif}" +
    "#aa-head{background:linear-gradient(135deg,var(--aa-primary),var(--aa-secondary));color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:10px}" +
    "#aa-head-avatar{width:28px;height:28px;border-radius:999px;background:rgba(255,255,255,.18);display:grid;place-items:center;overflow:hidden}" +
    "#aa-head-avatar img{width:100%;height:100%;object-fit:cover}" +
    "#aa-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}" +
    ".aa-m{max-width:85%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".aa-m a{color:inherit;text-decoration:underline}" +
    ".aa-user{align-self:flex-end;background:var(--aa-primary);color:#fff}" +
    ".aa-bot{align-self:flex-start;background:#f1f5f9;color:#111}" +
    "#aa-form{display:flex;border-top:1px solid #e2e8f0}" +
    "#aa-input{flex:1;border:none;padding:12px;font-size:14px;outline:none}" +
    "#aa-send{border:none;background:none;color:var(--aa-primary);font-weight:700;padding:0 16px;cursor:pointer}";

  var style = document.createElement("style");
  // Con id para poder retirarla: quien monta el widget en una SPA necesita desmontarlo al
  // salir de la ruta, y una hoja de estilo que no se puede localizar no se puede quitar.
  style.id = "aa-style";
  style.textContent = css;
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.id = "aa-bubble";
  var panel = document.createElement("div");
  panel.id = "aa-panel";
  panel.innerHTML =
    '<div id="aa-head"><span id="aa-head-avatar"></span><span id="aa-head-title">Asistente</span></div><div id="aa-msgs"></div>' +
    '<form id="aa-form"><input id="aa-input" placeholder="Escribe un mensaje..." autocomplete="off"/><button id="aa-send" type="submit">Enviar</button></form>';
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var msgs = panel.querySelector("#aa-msgs");
  var input = panel.querySelector("#aa-input");

  // Solo https:// (avatar subido) o data:image/ (preview local) — bloquea
  // javascript:/vbscript:/etc. inyectados vía innerHTML.
  function isSafeAvatarSrc(src) {
    return /^https:\/\//i.test(src) || /^data:image\//i.test(src);
  }

  function avatarHtml() {
    var src = config.avatarUrl || config.avatarBase64;
    return src && isSafeAvatarSrc(src)
      ? '<img alt="" src="' + src + '"/>'
      : config.avatarEmoji || "🤖";
  }

  function applyConfig(next) {
    config = Object.assign(config, next || {});
    // Mezclar SOBRE los defaults, no sobre el objeto que la línea anterior ya ha
    // pisado con el `template` del servidor (que puede venir vacío).
    config.template = Object.assign({}, DEFAULT_TEMPLATE, config.template || {});
    document.documentElement.style.setProperty("--aa-primary", config.primaryColor);
    document.documentElement.style.setProperty("--aa-secondary", config.secondaryColor);
    var side = config.template.position === "left" ? "left" : "right";
    bubble.style.left = side === "left" ? "24px" : "";
    bubble.style.right = side === "right" ? "24px" : "";
    panel.style.left = side === "left" ? "24px" : "";
    panel.style.right = side === "right" ? "24px" : "";
    bubble.style.borderRadius = config.template.launcherShape === "rounded" ? "14px" : "50%";
    panel.style.width = config.template.panelSize === "wide" ? "440px" : config.template.panelSize === "compact" ? "320px" : "360px";
    bubble.innerHTML = avatarHtml();
    panel.querySelector("#aa-head-avatar").innerHTML = avatarHtml();
    panel.querySelector("#aa-head-title").textContent = config.name || "Asistente";
    // El visitante puede abrir el panel antes de que llegue la config real (Render
    // arranca en frío). El saludo ya pintado diría el nombre por defecto, así que se
    // reescribe aquí. Dos condiciones para no tocar nada más: la referencia al nodo
    // concreto y que siga siendo el único mensaje del panel — en cuanto hay
    // conversación real, no se toca.
    if (greetingEl && msgs.children.length === 1) renderText(greetingEl, greetingText());
  }

  function greetingText() {
    return "Hola, soy " + (config.name || "Asistente") + ". ¿Cómo te llamas?";
  }

  // Enlace markdown [texto](url) o URL suelta. Misma gramática que
  // back/src/lib/channels/links.ts: este fichero se sirve a webs de terceros y no
  // puede importar de src/, así que la copia es deliberada y ambas van con tests.
  var LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()[\]"']+)/gi;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Negrita y saltos de línea de un fragmento YA escapado.
  function inlineHtml(safe) {
    return safe.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  }

  function anchorHtml(label, url) {
    // Siempre en una pestaña nueva, y siempre con noopener: sin él, la página que se
    // abre recibe un window.opener vivo hacia la web del cliente.
    return (
      '<a href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(label) +
      "</a>"
    );
  }

  // Escapa HTML, convierte **negrita** y monta los enlaces. Escapar va primero: así la
  // etiqueta de un enlace no puede inyectar marcado.
  function renderText(el, text) {
    var src = String(text);
    var re = new RegExp(LINK_PATTERN.source, "gi");
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(src)) !== null) {
      out += inlineHtml(escapeHtml(src.slice(last, m.index)));
      last = m.index + m[0].length;
      if (m[3]) {
        // URL suelta: la puntuación final es de la frase, no de la URL.
        var bare = m[3].replace(/[.,;:!?]+$/, "");
        out += anchorHtml(bare, bare) + inlineHtml(escapeHtml(m[3].slice(bare.length)));
      } else if (/^https?:\/\//i.test(m[2])) {
        out += anchorHtml(m[1], m[2]);
      } else {
        // Cualquier otro esquema se queda como texto literal.
        out += inlineHtml(escapeHtml(m[0]));
      }
    }
    el.innerHTML = out + inlineHtml(escapeHtml(src.slice(last)));
  }

  function add(text, cls) {
    var div = document.createElement("div");
    div.className = "aa-m " + cls;
    renderText(div, text);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  // La conversación vive lo que viva la pestaña. sessionStorage y no localStorage: el
  // requisito es "mientras la pestaña esté abierta", y localStorage resucitaría la
  // conversación de otra persona en un ordenador compartido días después.
  var STORE_KEY = "aa-chat:" + KEY;
  var MAX_STORED = 100;
  var history = [];

  function persist() {
    // Envuelto: Safari en navegación privada lanza al escribir, y un chat que no puede
    // recordar tiene que seguir siendo un chat que funciona.
    try {
      window.sessionStorage.setItem(
        STORE_KEY,
        JSON.stringify({ conversationId: conversationId, messages: history })
      );
    } catch (e) {}
  }

  function remember(text, cls) {
    history.push({ t: String(text), c: cls });
    if (history.length > MAX_STORED) history = history.slice(-MAX_STORED);
    persist();
  }

  function restore() {
    var data = null;
    try {
      var raw = window.sessionStorage.getItem(STORE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) {}
    if (!data || !data.messages || !data.messages.length) return;
    conversationId = data.conversationId || null;
    history = data.messages.slice(-MAX_STORED);
    for (var i = 0; i < history.length; i++) add(history[i].t, history[i].c);
  }

  restore();

  // Auto-verificación de instalación (F7): avisa al backend de que el widget se
  // cargó en el sitio del cliente → el panel de Implementación lo marca como
  // "instalado". Best-effort: no bloquea ni afecta a la carga del widget.
  try {
    fetch(BASE + "/api/widget/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: KEY }),
      keepalive: true,
    }).catch(function () {});
  } catch (e) {}

  applyConfig(config);
  fetch(BASE + "/api/widget/config?publicKey=" + encodeURIComponent(KEY))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data) {
        applyConfig({
          name: data.name,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
          avatarUrl: data.avatarUrl || "",
          avatarBase64: data.avatarBase64,
          avatarEmoji: data.avatarEmoji,
          template: data.template,
        });
      }
    })
    .catch(function () {});

  bubble.addEventListener("click", function () {
    panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    if (!msgs.children.length) greetingEl = add(greetingText(), "aa-bot");
  });

  panel.querySelector("#aa-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    add(text, "aa-user");
    remember(text, "aa-user");
    var thinking = add("...", "aa-bot");
    fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: KEY, message: text, conversationId: conversationId }),
    })
      // Un 502 de Render en arranque en frío devuelve HTML, y `r.json()` revienta. Antes eso caía
      // al `.catch` y se pintaba "Error de conexión" — mensaje equivocado: la conexión funcionó.
      .then(function (r) {
        return r.json().then(
          function (data) { return data || {}; },
          function () { return {}; }
        );
      })
      .then(function (data) {
        conversationId = data.conversationId || conversationId;
        // El back ya sanea lo que puede leer un visitante (ver `visitor-error.ts`), pero este
        // fichero se sirve a webs de terceros: si un día llega una respuesta sin texto, se pinta
        // algo del propio widget antes que "undefined" o un "Error" pelado.
        var reply = data.text || data.error || FALLBACK_ERROR;
        renderText(thinking, reply);
        // Se guarda la respuesta final, nunca el "..." : una recarga a mitad de petición
        // no debe dejar unos puntos suspensivos colgados en el historial.
        remember(reply, "aa-bot");
      })
      .catch(function () { thinking.textContent = "No se pudo conectar con el asistente."; });
  });
})();
