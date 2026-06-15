import { API } from "@/lib/api";

/**
 * Bloque de reservas inyectable en la landing generada.
 * Es un <section> autocontenido (HTML + script inline) que postea al endpoint
 * público /api/public/reserve, el cual crea el evento en el Google Calendar del
 * negocio (agente) dueño de la publicKey. El HTML es la fuente de verdad y es
 * editable en el editor de la landing.
 */

const SECTION_RE = /<section[^>]*data-gru-reservation="[^"]*"[\s\S]*?<\/section>\s*/gi;
const KEY_RE = /<section[^>]*data-gru-reservation="([^"]*)"/i;

/** publicKey del agente embebido en el bloque de reservas, o null. */
export function getReservationKey(html: string): string | null {
  const m = html.match(KEY_RE);
  return m ? m[1] : null;
}

/** Quita cualquier bloque de reservas previo. */
export function removeReservation(html: string): string {
  return html.replace(SECTION_RE, "");
}

/** Construye el bloque de reservas para una publicKey concreta. */
export function buildReservationBlock(publicKey: string): string {
  const endpoint = `${API}/api/public/reserve`;
  return `<section data-gru-reservation="${publicKey}" style="max-width:480px;margin:48px auto;padding:24px;border:1px solid #e5e7eb;border-radius:16px;font-family:system-ui,sans-serif">
  <h2 style="margin:0 0 16px;font-size:1.5rem">Reserva</h2>
  <form data-reserve-form style="display:flex;flex-direction:column;gap:12px">
    <input name="name" placeholder="Nombre" required style="padding:10px;border:1px solid #d1d5db;border-radius:8px">
    <input name="email" type="email" placeholder="Email (opcional)" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">
    <input name="phone" placeholder="Teléfono (opcional)" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">
    <input name="startLocal" type="datetime-local" required style="padding:10px;border:1px solid #d1d5db;border-radius:8px">
    <input name="partySize" type="number" min="1" placeholder="Nº personas (opcional)" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">
    <textarea name="notes" placeholder="Notas (opcional)" rows="2" style="padding:10px;border:1px solid #d1d5db;border-radius:8px"></textarea>
    <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <button type="submit" style="padding:12px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer">Reservar</button>
    <p data-reserve-msg style="margin:0;font-size:0.9rem;min-height:1.2em"></p>
  </form>
  <script>
  (function(){
    var s = document.querySelector('section[data-gru-reservation="${publicKey}"]');
    if (!s) return;
    var f = s.querySelector('[data-reserve-form]');
    var msg = s.querySelector('[data-reserve-msg]');
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(f);
      if (fd.get('website')) { msg.textContent = '¡Gracias!'; f.reset(); return; }
      var local = fd.get('startLocal');
      var startIso = local ? new Date(local).toISOString() : '';
      var body = {
        publicKey: '${publicKey}',
        name: fd.get('name'),
        email: fd.get('email') || undefined,
        phone: fd.get('phone') || undefined,
        startIso: startIso,
        partySize: fd.get('partySize') ? Number(fd.get('partySize')) : undefined,
        notes: fd.get('notes') || undefined,
        website: fd.get('website') || undefined
      };
      msg.style.color = '#374151'; msg.textContent = 'Enviando...';
      fetch('${endpoint}', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
        .then(function(res){
          if (res.ok) { msg.style.color = '#16a34a'; msg.textContent = '✅ Reserva enviada'; f.reset(); }
          else { msg.style.color = '#dc2626'; msg.textContent = '❌ ' + (res.d.error || 'No se pudo reservar'); }
        })
        .catch(function(){ msg.style.color = '#dc2626'; msg.textContent = '❌ Error de red'; });
    });
  })();
  </script>
</section>
`;
}

/** Inserta (o reemplaza) el bloque de reservas antes de </body>. */
export function injectReservation(html: string, publicKey: string): string {
  const cleaned = removeReservation(html);
  const block = buildReservationBlock(publicKey);
  if (/<\/body>/i.test(cleaned)) {
    return cleaned.replace(/<\/body>/i, `${block}</body>`);
  }
  return `${cleaned}\n${block}`;
}
