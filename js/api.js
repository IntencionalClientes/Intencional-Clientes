/* ═══════════════════════════════════════════════════════════
   API — todo lo que este catálogo necesita de Supabase: leer los
   colores (con su stock real) y crear un pedido a través de la
   función que reserva stock de forma atómica. Nada de esto pasa
   por localStorage ni guarda un stock propio: siempre se lee en
   vivo de la misma base que usa el panel de gestión.
   ═══════════════════════════════════════════════════════════ */

var TOPE_PAGINA = 1000;

async function rest(ruta, opciones) {
  opciones = opciones || {};
  var res = await fetch(SB_URL + '/rest/v1/' + ruta, Object.assign({
    method: opciones.method || 'GET',
    body: opciones.body,
    headers: Object.assign({
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      Prefer: opciones.prefer || 'return=representation'
    }, opciones.headers || {})
  }, {}));
  var txt = await res.text();
  var data = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    var msg = (data && (data.message || data.hint || data.error)) || ('Error ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* Colores activos, paginando por si hay más de 1000 (no debería,
   pero por las dudas no se corta en silencio). */
async function traerColores() {
  var filas = [], offset = 0;
  for (;;) {
    var lote = await rest('colores?select=*&activo=eq.true&order=piso.asc,orden.asc,codigo.asc' +
      '&limit=' + TOPE_PAGINA + '&offset=' + offset);
    filas = filas.concat(lote);
    if (lote.length < TOPE_PAGINA) break;
    offset += TOPE_PAGINA;
    if (offset > 200000) break;
  }
  return filas;
}

/* Productos simples (cremas, colágeno, etc.) activos. */
async function traerProductos() {
  var filas = [], offset = 0;
  for (;;) {
    var lote = await rest('productos?select=*&activo=eq.true&order=nombre.asc' +
      '&limit=' + TOPE_PAGINA + '&offset=' + offset);
    filas = filas.concat(lote);
    if (lote.length < TOPE_PAGINA) break;
    offset += TOPE_PAGINA;
    if (offset > 200000) break;
  }
  return filas;
}

/* Packs activos. */
async function traerPacks() {
  var filas = [], offset = 0;
  for (;;) {
    var lote = await rest('packs?select=*&activo=eq.true&order=nombre.asc' +
      '&limit=' + TOPE_PAGINA + '&offset=' + offset);
    filas = filas.concat(lote);
    if (lote.length < TOPE_PAGINA) break;
    offset += TOPE_PAGINA;
    if (offset > 200000) break;
  }
  return filas;
}

/* Qué colores (y cuántos de cada uno) trae cada pack — se necesita
   completo, sin paginar por pack, para calcular el stock disponible
   de cada pack (el mínimo entre lo que permite cada color que trae). */
async function traerPackItems() {
  var filas = [], offset = 0;
  for (;;) {
    var lote = await rest('pack_items?select=*&limit=' + TOPE_PAGINA + '&offset=' + offset);
    filas = filas.concat(lote);
    if (lote.length < TOPE_PAGINA) break;
    offset += TOPE_PAGINA;
    if (offset > 200000) break;
  }
  return filas;
}

/* Crea el pedido reservando stock de forma atómica: si dos locales
   piden el último frasco (o la última unidad de un pack) al mismo
   tiempo, solo uno se queda con él y el otro recibe el error de "no
   queda stock" para avisarle. Cada ítem del pedido puede ser un
   color (esmalte o semipermanente), un producto simple o un pack. */
async function crearPedidoB2B(local, telefono, contacto, observaciones, localidad, items) {
  var r = await rest('rpc/crear_pedido_b2b', {
    method: 'POST',
    body: JSON.stringify({
      p_local: local, p_telefono: telefono, p_contacto: contacto || '',
      p_observaciones: observaciones || '', p_localidad: localidad || '',
      p_items: items.map(function (it) { return { tipo: it.tipo, id: it.id, cantidad: it.cantidad }; })
    })
  });
  return Array.isArray(r) ? r[0] : r;
}
