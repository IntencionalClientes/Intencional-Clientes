/* ═══════════════════════════════════════════════════════════
   CATÁLOGO B2B — INTENCIONAL
   Catálogo → seleccionar colores → revisar pedido → datos del
   local → hacer pedido → confirmación. Todo el stock que se ve
   acá es el mismo de la tabla "colores" que usa el panel de
   gestión: no hay ningún número propio de este sitio.
   ═══════════════════════════════════════════════════════════ */

var _catColores = [];
var _catCargando = true;
var _catError = '';

var _catCarrito = {};          // id -> cantidad
var _catBusca = '';
var _catColecciones = {};      // colección -> true si está tildada
var _catAcabados = {};
var _catSoloDisponibles = false;
var _catSoloOfertas = false;
var _catPagina = 1;
var CAT_POR_PAGINA = 40;
var _catFiltrosVisibles = false;
var _catPedidoVisible = false;
var _catVista = 'catalogo';    // catalogo | comprar
var _catConfirmacion = null;   // { numero } después de hacer el pedido
var _catEnviando = false;

var _catForm = { local: '', telefono: '', localidad: '', contacto: '', observaciones: '' };

document.addEventListener('DOMContentLoaded', iniciarCatalogo);

async function iniciarCatalogo() {
  renderShell();
  await cargarColores(true);
  setInterval(function () { cargarColores(false); }, 25000);
}

async function cargarColores(primeraVez) {
  try {
    var nuevos = await traerColores();
    var stockAnterior = {};
    _catColores.forEach(function (c) { stockAnterior[c.id] = c.stock; });
    _catColores = nuevos;
    _catCargando = false;
    _catError = '';

    /* Si mientras alguien tenía cosas en el carrito el stock bajó
       (otro local compró, o lo ajustaron desde el panel), se
       recorta el pedido a lo que realmente queda. */
    var recortado = false;
    Object.keys(_catCarrito).forEach(function (idStr) {
      var id = +idStr;
      var c = _catColores.find(function (x) { return x.id === id; });
      var disponible = c ? (+c.stock || 0) : 0;
      if (!c || !bool(c.activo) || disponible <= 0) { delete _catCarrito[id]; recortado = true; }
      else if (_catCarrito[id] > disponible) { _catCarrito[id] = disponible; recortado = true; }
    });
    if (recortado && !primeraVez) toast('Actualizamos tu pedido: cambió el stock de algún color', 'error');

    if (primeraVez) renderFiltros();
    renderCatalogo();
    renderPedido();
    actualizarBadgeCarrito();
  } catch (e) {
    _catCargando = false;
    _catError = e.message || 'No se pudo conectar con el catálogo';
    renderCatalogo();
  }
}

/* ── Armado de la pantalla (una sola vez) ────────────────── */
function renderShell() {
  document.body.innerHTML =
    '<div class="cat-top" id="cat-top">' +
      '<header class="cat-header">' +
        '<div class="cat-marca"><img src="' + LOGO_INTENCIONAL + '" alt=""/>' +
          '<div><div class="cat-marca-nombre">Intencional</div><div class="cat-marca-sub">Esmaltes · Catálogo B2B</div></div>' +
        '</div>' +
        '<nav class="cat-nav">' +
          '<button class="cat-nav-item" id="cat-tab-catalogo" onclick="catIrA(\'catalogo\')" aria-current="page">Catálogo</button>' +
          '<button class="cat-nav-item" id="cat-tab-comprar" onclick="catIrA(\'comprar\')">Cómo comprar</button>' +
        '</nav>' +
        '<div class="cat-header-espaciador"></div>' +
        '<button class="cat-btn-carrito" onclick="catAbrirPedido()">' + ic('cart', 17) +
          '<span>Tu pedido</span><span class="cat-badge" id="cat-badge">0</span></button>' +
      '</header>' +
      '<div class="cat-buscador-bar" id="cat-buscador-bar"></div>' +
    '</div>' +
    '<div class="cat-shell">' +
      '<button class="btn btn-secundario cat-filtros-toggle" onclick="catAlternarFiltros()">' + ic('settings', 15) + ' Filtros</button>' +
      '<aside class="cat-filtros" id="cat-filtros"></aside>' +
      '<main class="cat-main" id="cat-main"></main>' +
    '</div>' +
    '<div class="cat-pedido-overlay" id="cat-overlay" onclick="catCerrarPedido()"></div>' +
    '<aside class="cat-pedido-panel" id="cat-panel"></aside>' +
    '<button class="cat-fab-carrito" id="cat-fab" onclick="catAbrirPedido()" aria-label="Ver tu pedido">' +
      ic('cart', 20) + '<span class="cat-badge" id="cat-fab-badge">0</span></button>' +
    '<div class="modal" id="modal"></div>' +
    '<div class="toast" id="toast"></div>';

  renderBuscadorBar();
  renderFiltros();
  renderPedido();
  ajustarAlturaTop();
  window.addEventListener('resize', ajustarAlturaTop);
}

/* El bloque fijo de arriba (header + buscador) no tiene una altura
   fija: cambia según ancho de pantalla y tamaño de fuente. El
   panel de filtros necesita saber esa altura real para pegarse
   justo debajo, sin superponerse ni dejar un hueco. */
function ajustarAlturaTop() {
  var top = porId('cat-top');
  if (!top) return;
  document.documentElement.style.setProperty('--cat-top-h', top.getBoundingClientRect().height + 'px');
}

/* La búsqueda vive en su propia barra, fuera de los filtros
   colapsables, para que quede visible siempre (fija bajo el
   header) aunque se cierren los filtros o se haga scroll. */
function renderBuscadorBar() {
  var cont = porId('cat-buscador-bar');
  if (!cont) return;
  cont.innerHTML =
    '<div class="buscador"><span class="ic-lupa">' + ic('search', 15) + '</span>' +
      '<input class="campo-input" placeholder="Buscar por código o nombre…" value="' + esc(_catBusca) + '" oninput="catBuscar(this.value)"/></div>';
}

function catIrA(vista) {
  _catVista = vista;
  if (vista === 'catalogo') porId('cat-tab-catalogo').setAttribute('aria-current', 'page');
  else porId('cat-tab-catalogo').removeAttribute('aria-current');
  if (vista === 'comprar') porId('cat-tab-comprar').setAttribute('aria-current', 'page');
  else porId('cat-tab-comprar').removeAttribute('aria-current');

  /* Los filtros son del catálogo: en "Cómo comprar" no pintan nada */
  var toggle = document.querySelector('.cat-filtros-toggle');
  if (toggle) toggle.style.display = vista === 'catalogo' ? '' : 'none';
  var filtros = porId('cat-filtros');
  if (filtros) filtros.style.display = vista === 'catalogo' ? '' : 'none';

  renderCatalogo();
  window.scrollTo(0, 0);
}

function catAlternarFiltros() {
  _catFiltrosVisibles = !_catFiltrosVisibles;
  porId('cat-filtros').className = 'cat-filtros' + (_catFiltrosVisibles ? ' visible' : '');
}

/* ── Filtros ──────────────────────────────────────────────── */
function valoresUnicosCat(campo) {
  var s = {};
  _catColores.forEach(function (c) { if (c[campo]) s[c[campo]] = 1; });
  return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}

function renderFiltros() {
  var cont = porId('cat-filtros');
  if (!cont) return;
  var colecciones = valoresUnicosCat('coleccion');
  var acabados = valoresUnicosCat('acabado');

  cont.innerHTML =
    (colecciones.length ? '<div class="cat-filtros-grupo">' +
      '<div class="cat-filtros-titulo">Colección</div>' +
      colecciones.map(function (c) {
        return '<label class="cat-check"><input type="checkbox"' + (_catColecciones[c] ? ' checked' : '') +
          ' onchange="catFiltroToggle(\'_catColecciones\',\'' + esc(c).replace(/'/g, '&#39;') + '\')"/>' + esc(c) + '</label>';
      }).join('') +
    '</div>' : '') +

    (acabados.length ? '<div class="cat-filtros-grupo">' +
      '<div class="cat-filtros-titulo">Acabado</div>' +
      acabados.map(function (a) {
        return '<label class="cat-check"><input type="checkbox"' + (_catAcabados[a] ? ' checked' : '') +
          ' onchange="catFiltroToggle(\'_catAcabados\',\'' + esc(a).replace(/'/g, '&#39;') + '\')"/>' + esc(a) + '</label>';
      }).join('') +
    '</div>' : '') +

    '<div class="cat-filtros-grupo">' +
      '<label class="cat-toggle"><input type="checkbox"' + (_catSoloDisponibles ? ' checked' : '') +
        ' onchange="catToggleDisponibles(this.checked)"/> Solo disponibles</label>' +
      '<label class="cat-toggle"><input type="checkbox"' + (_catSoloOfertas ? ' checked' : '') +
        ' onchange="catToggleOfertas(this.checked)"/> Solo en oferta</label>' +
    '</div>' +

    '<button class="cat-filtros-limpiar" onclick="catLimpiarFiltros()">Limpiar filtros</button>';
}

function catBuscar(v) { _catBusca = v; _catPagina = 1; renderCatalogo(); }
function catFiltroToggle(varName, valor) {
  var mapa = window[varName];
  if (mapa[valor]) delete mapa[valor]; else mapa[valor] = true;
  _catPagina = 1;
  renderCatalogo();
}
function catToggleDisponibles(v) { _catSoloDisponibles = v; _catPagina = 1; renderCatalogo(); }
function catToggleOfertas(v) { _catSoloOfertas = v; _catPagina = 1; renderCatalogo(); }
function catLimpiarFiltros() {
  _catBusca = ''; _catColecciones = {}; _catAcabados = {}; _catSoloDisponibles = false; _catSoloOfertas = false; _catPagina = 1;
  renderBuscadorBar(); renderFiltros(); renderCatalogo();
}

/* ── Catálogo ─────────────────────────────────────────────── */
function catalogoFiltrado() {
  var q = normalizar(_catBusca);
  var colSel = Object.keys(_catColecciones).length > 0;
  var acaSel = Object.keys(_catAcabados).length > 0;
  return _catColores.filter(function (c) {
    if (colSel && !_catColecciones[c.coleccion]) return false;
    if (acaSel && !_catAcabados[c.acabado]) return false;
    if (_catSoloDisponibles && (+c.stock || 0) <= 0) return false;
    if (_catSoloOfertas && !c.en_oferta) return false;
    if (!q) return true;
    return normalizar(c.codigo).indexOf(q) !== -1 || normalizar(c.nombre).indexOf(q) !== -1;
  }).sort(function (a, b) {
    /* Los colores en oferta aparecen primero (así se ven apenas se
       entra, sin que el local tenga que buscarlos) — es la forma
       de darles empuje a los que cuesta más vender. Dentro de cada
       grupo, el orden es por código como siempre. */
    var oa = a.en_oferta ? 0 : 1, ob = b.en_oferta ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
  });
}

function renderCatalogo() {
  var cont = porId('cat-main');
  if (!cont) return;

  if (_catVista === 'comprar') { cont.innerHTML = comoComprarHTML(); return; }

  if (_catCargando) { cont.innerHTML = cargando('Cargando catálogo…'); return; }
  if (_catError) {
    cont.innerHTML = avisoHTML('danger', '<strong>No se pudo cargar el catálogo.</strong><br>' + esc(_catError) +
      '<br><button class="btn btn-secundario" style="margin-top:10px" onclick="cargarColores(true)">Reintentar</button>');
    return;
  }
  if (!_catColores.length) {
    cont.innerHTML = vacio('palette', 'Todavía no hay colores cargados', 'En cuanto se carguen en el sistema, van a aparecer acá.');
    return;
  }

  var lista = catalogoFiltrado();
  var total = lista.length;
  var totalPaginas = Math.max(1, Math.ceil(total / CAT_POR_PAGINA));
  if (_catPagina > totalPaginas) _catPagina = totalPaginas;
  var desde = (_catPagina - 1) * CAT_POR_PAGINA;
  var visibles = lista.slice(desde, desde + CAT_POR_PAGINA);

  if (!total) {
    cont.innerHTML =
      '<div class="cat-cab-fila"><div><h1 class="cat-cab-titulo">Catálogo de colores</h1></div></div>' +
      vacio('search', 'Ningún color coincide', 'Probá cambiar la búsqueda o los filtros.');
    return;
  }

  cont.innerHTML =
    '<div class="cat-cab-fila">' +
      '<div><h1 class="cat-cab-titulo">Catálogo de colores</h1>' +
        '<div class="cat-cab-sub">Mostrando ' + plural(total, 'color', 'colores') + '</div></div>' +
    '</div>' +

    '<div class="cat-grid">' + visibles.map(cardColorHTML).join('') + '</div>' +

    '<div class="cat-paginacion">' +
      '<button ' + (_catPagina <= 1 ? 'disabled' : '') + ' onclick="catPaginaAnterior()" aria-label="Anterior" style="transform:rotate(180deg)">' + ic('chevron', 15) + '</button>' +
      '<span class="cat-paginacion-info">Mostrando ' + (desde + 1) + '–' + Math.min(desde + CAT_POR_PAGINA, total) + ' de ' + total + '</span>' +
      '<button ' + (_catPagina >= totalPaginas ? 'disabled' : '') + ' onclick="catPaginaSiguiente()" aria-label="Siguiente">' + ic('chevron', 15) + '</button>' +
    '</div>';
}

function catPaginaAnterior() { if (_catPagina > 1) { _catPagina--; renderCatalogo(); window.scrollTo(0, 0); } }
function catPaginaSiguiente() { _catPagina++; renderCatalogo(); window.scrollTo(0, 0); }

/* La "uña de muestra": una uña pintada de verdad (forma almendrada,
   con brillo), no un frasco de fantasía. Se arma una sola vez acá y
   se pinta con el hex de cada color — así sirve tanto de insignia
   chica sobre la foto del producto como de representación única
   para los colores que todavía no tienen foto cargada. */
function ajustarHexCat(hex, porc) {
  var s = String(hex || '').replace('#', '');
  if (s.length === 3) s = s.split('').map(function (c) { return c + c; }).join('');
  var num = parseInt(s, 16);
  if (isNaN(num)) return hex;
  var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  function aj(c) { return porc >= 0 ? c + (255 - c) * porc : c * (1 + porc); }
  r = Math.min(255, Math.max(0, Math.round(aj(r))));
  g = Math.min(255, Math.max(0, Math.round(aj(g))));
  b = Math.min(255, Math.max(0, Math.round(aj(b))));
  return '#' + [r, g, b].map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
}

function nailSwatchHTML(hex, idSuffix) {
  hex = hex || '#c9b8ae';
  var claro = ajustarHexCat(hex, 0.32), oscuro = ajustarHexCat(hex, -0.30);
  var gShade = 'ngs' + idSuffix, gBlur = 'ngb' + idSuffix;
  var forma = 'M50,4 C75,4 90,35 90,70 C90,113 75,147 50,147 C25,147 10,113 10,70 C10,35 25,4 50,4 Z';
  return '<svg class="cat-nail-swatch" viewBox="0 0 100 150" aria-hidden="true">' +
    '<defs>' +
      '<radialGradient id="' + gShade + '" cx="38%" cy="30%" r="80%">' +
        '<stop offset="0%" stop-color="' + esc(claro) + '"/>' +
        '<stop offset="55%" stop-color="' + esc(hex) + '"/>' +
        '<stop offset="100%" stop-color="' + esc(oscuro) + '"/>' +
      '</radialGradient>' +
      '<filter id="' + gBlur + '" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="5"/>' +
      '</filter>' +
      '<clipPath id="ngc' + idSuffix + '"><path d="' + forma + '"/></clipPath>' +
    '</defs>' +
    '<path d="' + forma + '" fill="url(#' + gShade + ')"/>' +
    '<g clip-path="url(#ngc' + idSuffix + ')">' +
      '<ellipse cx="34" cy="34" rx="34" ry="52" fill="#fff" opacity=".55" filter="url(#' + gBlur + ')" transform="rotate(-24 34 34)"/>' +
      '<ellipse cx="30" cy="26" rx="8" ry="15" fill="#fff" opacity=".8" transform="rotate(-20 30 26)"/>' +
      '<ellipse cx="50" cy="132" rx="30" ry="16" fill="#000" opacity=".18" filter="url(#' + gBlur + ')"/>' +
    '</g>' +
    '<path d="' + forma + '" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="1.5"/>' +
  '</svg>';
}

/* En el carrito se muestra la uña de muestra (la representación real
   del color), igual que en la grilla del catálogo — así el local ve
   de un vistazo el mismo color que eligió, no un frasco genérico. Si
   todavía no hay foto de uña para ese color, se cae a la foto del
   frasco y, si tampoco hay, a la uña dibujada. */
function cartThumbHTML(c) {
  if (c.imagen_una_url) {
    return { clase: ' cat-nail-swatch-wrap', html: '<img class="cat-nail-swatch" src="' + esc(c.imagen_una_url) + '" alt=""/>' };
  }
  if (c.imagen_url) {
    return { clase: '', html: '<img src="' + esc(c.imagen_url) + '" alt="' + esc(c.nombre || c.codigo) + '"/>' };
  }
  return { clase: ' cat-nail-swatch-wrap', html: nailSwatchHTML(c.hex, 'cart' + c.id) };
}

function cardColorHTML(c) {
  var stock = +c.stock || 0;
  var disponible = stock > 0;
  var cantidad = _catCarrito[c.id] || 0;

  /* La imagen principal de la tarjeta es el frasco (el producto que
     se está pidiendo); la uña de muestra queda como insignia chica
     para dar una idea del color puesto. Si el color todavía no
     tiene foto de frasco, se cae a la uña y, recién si tampoco hay
     eso, a la uña con volumen dibujada. */
  var unaMini = c.imagen_una_url
    ? '<img class="cat-card-mini-badge" src="' + esc(c.imagen_una_url) + '" alt=""/>'
    : '';

  var vidriera = c.imagen_url
    ? '<img class="cat-card-img-principal" src="' + esc(c.imagen_url) + '" alt="' + esc(c.nombre) + '"/>' + unaMini
    : (c.imagen_una_url
        ? '<img class="cat-card-img-principal" src="' + esc(c.imagen_una_url) + '" alt="' + esc(c.nombre) + '"/>'
        : nailSwatchHTML(c.hex, 'card' + c.id));

  var control = !disponible
    ? '<button class="cat-card-agregar" disabled aria-label="Sin stock">' + ic('plus', 15) + '</button>'
    : (cantidad <= 0
        ? '<button class="cat-card-agregar" onclick="catAgregar(' + c.id + ')" aria-label="Agregar al pedido">' + ic('plus', 15) + '</button>'
        : '<div class="cat-card-stepper">' +
            '<button onclick="catCambiarCantidad(' + c.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
            '<span>' + cantidad + '</span>' +
            '<button ' + (cantidad >= stock ? 'disabled' : '') + ' onclick="catCambiarCantidad(' + c.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
          '</div>');

  return '<div class="cat-card' + (disponible ? '' : ' agotado') + '">' +
    '<button type="button" class="cat-card-vidriera' + ((c.imagen_una_url || c.imagen_url) ? '' : ' sin-foto') + '" ' +
      'onclick="catAbrirDetalle(' + c.id + ')" aria-label="Ver el detalle de ' + esc(c.nombre || c.codigo) + '">' + vidriera +
      (c.en_oferta ? '<span class="cat-card-oferta">Oferta</span>' : '') +
      '<span class="cat-card-estado"><span class="pin pin-' + (disponible ? 'ok' : 'danger') + '">' +
        (disponible ? 'Disponible' : 'Sin stock') + '</span></span>' +
    '</button>' +
    '<div class="cat-card-cuerpo">' +
      '<div class="cat-card-codigo">' + esc(c.codigo) + '</div>' +
      '<div class="cat-card-nombre">' + esc(c.nombre || c.codigo) + '</div>' +
      '<div class="cat-card-tags">' + [c.coleccion, c.acabado].filter(Boolean).map(esc).join(' · ') + '</div>' +
      '<div class="cat-card-pie">' +
        (disponible ? '<div class="cat-card-stock">' + stock + ' u. disp.</div>' : '<div class="cat-card-stock agotado">Sin stock</div>') +
        control +
      '</div>' +
    '</div>' +
  '</div>';
}

/* Ficha de detalle de un color: imagen grande (deslizable si hay
   más de una), descripción, y la posibilidad de agregarlo al pedido
   con la cantidad que se elija, todo sin salir de la ventana. Si a
   un color le falta alguna foto no se inventa nada de más — solo se
   muestra la que hay (y si no hay ninguna real, la uña dibujada). */
var _catDetalle = null; // { id, imgs:[{etiq,html}], idx, cantidad }
var _catSwipeX = null;

function catAbrirDetalle(id) {
  var c = _catColores.find(function (x) { return x.id === id; });
  if (!c) return;

  var imgs = [];
  if (c.imagen_url) {
    imgs.push({ etiq: 'Frasco', html: '<img src="' + esc(c.imagen_url) + '" alt="' + esc(c.nombre || c.codigo) + '"/>' });
  }
  if (c.imagen_una_url) {
    imgs.push({ etiq: 'Uña de muestra', html: '<img src="' + esc(c.imagen_una_url) + '" alt=""/>' });
  }
  if (!imgs.length) {
    imgs.push({ etiq: 'Uña de muestra', html: nailSwatchHTML(c.hex, 'det' + c.id) });
  }

  var stock = +c.stock || 0;
  var actual = _catCarrito[id] || 0;
  _catDetalle = { id: id, imgs: imgs, idx: 0, cantidad: Math.min(Math.max(actual, 1), Math.max(stock, 1)) };

  abrirModal(c.codigo + (c.nombre ? ' · ' + c.nombre : ''), catDetalleHTML());
}

function catDetalleHTML() {
  var d = _catDetalle;
  if (!d) return '';
  var c = _catColores.find(function (x) { return x.id === d.id; });
  if (!c) return '';
  var stock = +c.stock || 0;
  var disponible = stock > 0;

  var carrusel =
    '<div class="cat-detalle-carrusel">' +
      (d.imgs.length > 1 ? '<button type="button" class="cat-detalle-flecha izq" onclick="catDetalleImg(-1)" aria-label="Imagen anterior">' + ic('chevron', 15) + '</button>' : '') +
      '<div class="cat-detalle-img" ontouchstart="catDetalleSwipeStart(event)" ontouchend="catDetalleSwipeEnd(event)">' + d.imgs[d.idx].html + '</div>' +
      (d.imgs.length > 1 ? '<button type="button" class="cat-detalle-flecha der" onclick="catDetalleImg(1)" aria-label="Imagen siguiente">' + ic('chevron', 15) + '</button>' : '') +
    '</div>' +
    (d.imgs.length > 1
      ? '<div class="cat-detalle-puntos">' + d.imgs.map(function (img, i) {
          return '<button type="button" class="cat-detalle-punto' + (i === d.idx ? ' activo' : '') + '" onclick="catDetalleIrA(' + i + ')" aria-label="Ver ' + esc(img.etiq) + '"></button>';
        }).join('') + '</div>'
      : '') +
    '<div class="cat-detalle-etiq">' + esc(d.imgs[d.idx].etiq) + '</div>';

  var tags = [c.coleccion, c.acabado].filter(Boolean).map(esc).join(' · ');
  var desc = c.descripcion
    ? '<p class="cat-detalle-desc">' + esc(c.descripcion) + '</p>'
    : (tags ? '<p class="cat-detalle-desc cat-detalle-desc-generica">' + tags + '</p>' : '');

  var controlCant = !disponible
    ? '<div class="cat-detalle-sinstock">' + ic('alert', 14) + ' Sin stock por el momento</div>'
    : '<div class="cat-detalle-cantidad">' +
        '<div class="campo-etiq">Unidades</div>' +
        '<div class="cat-card-stepper cat-detalle-stepper">' +
          '<button type="button" onclick="catDetalleCantidad(-1)" aria-label="Restar">' + ic('minus', 13) + '</button>' +
          '<span>' + d.cantidad + '</span>' +
          '<button type="button" ' + (d.cantidad >= stock ? 'disabled' : '') + ' onclick="catDetalleCantidad(1)" aria-label="Sumar">' + ic('plus', 13) + '</button>' +
        '</div>' +
        '<div class="campo-ayuda">' + stock + ' u. disponibles</div>' +
      '</div>';

  return '<div class="cat-detalle">' +
      carrusel +
      '<div class="cat-detalle-codigo">' + esc(c.codigo) + '</div>' +
      '<h2 class="cat-detalle-nombre">' + esc(c.nombre || c.codigo) + '</h2>' +
      desc +
      controlCant +
      (disponible ? '<button type="button" class="btn btn-primario btn-bloque cat-detalle-agregar" onclick="catDetalleAgregar()">' + ic('plus', 15) + ' Agregar al pedido</button>' : '') +
    '</div>';
}

function catRepintarDetalle() {
  var cuerpo = document.querySelector('#modal .modal-cuerpo');
  if (cuerpo) cuerpo.innerHTML = catDetalleHTML();
}
function catDetalleImg(delta) {
  var d = _catDetalle;
  if (!d) return;
  d.idx = (d.idx + delta + d.imgs.length) % d.imgs.length;
  catRepintarDetalle();
}
function catDetalleIrA(i) {
  if (!_catDetalle) return;
  _catDetalle.idx = i;
  catRepintarDetalle();
}
function catDetalleCantidad(delta) {
  var d = _catDetalle;
  if (!d) return;
  var c = _catColores.find(function (x) { return x.id === d.id; });
  var stock = c ? (+c.stock || 0) : 0;
  d.cantidad = Math.max(1, Math.min(stock, d.cantidad + delta));
  catRepintarDetalle();
}
function catDetalleSwipeStart(e) { _catSwipeX = e.changedTouches[0].clientX; }
function catDetalleSwipeEnd(e) {
  if (_catSwipeX === null) return;
  var dx = e.changedTouches[0].clientX - _catSwipeX;
  _catSwipeX = null;
  if (Math.abs(dx) > 40) catDetalleImg(dx > 0 ? -1 : 1);
}
function catDetalleAgregar() {
  var d = _catDetalle;
  if (!d) return;
  var c = _catColores.find(function (x) { return x.id === d.id; });
  if (!c || (+c.stock || 0) <= 0) return;
  _catCarrito[d.id] = Math.max(1, Math.min(+c.stock || 0, d.cantidad));
  cerrarModal();
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
  toast('Agregado al pedido');
}

/* ── Carrito ──────────────────────────────────────────────── */
function catAgregar(id) {
  var c = _catColores.find(function (x) { return x.id === id; });
  if (!c || (+c.stock || 0) <= 0) return;
  _catCarrito[id] = 1;
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
}
function catCambiarCantidad(id, delta) {
  var c = _catColores.find(function (x) { return x.id === id; });
  var stock = c ? (+c.stock || 0) : 0;
  var actual = _catCarrito[id] || 0;
  var nuevo = Math.max(0, Math.min(stock, actual + delta));
  if (nuevo <= 0) delete _catCarrito[id]; else _catCarrito[id] = nuevo;
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
}
function catQuitar(id) {
  delete _catCarrito[id];
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
}

function actualizarBadgeCarrito() {
  var n = String(Object.keys(_catCarrito).length);
  var el = porId('cat-badge');
  if (el) el.textContent = n;
  var el2 = porId('cat-fab-badge');
  if (el2) el2.textContent = n;
}

/* El carrito queda accesible en todo momento con el botón flotante
   (mobile) o el botón del header (desktop), sin importar el scroll;
   se puede abrir y cerrar cuando se quiera. */
function catAbrirPedido() {
  _catPedidoVisible = true;
  porId('cat-overlay').className = 'cat-pedido-overlay visible';
  porId('cat-panel').className = 'cat-pedido-panel visible';
  var fab = porId('cat-fab');
  if (fab) fab.className = 'cat-fab-carrito oculto';
}
function catCerrarPedido() {
  _catPedidoVisible = false;
  porId('cat-overlay').className = 'cat-pedido-overlay';
  porId('cat-panel').className = 'cat-pedido-panel';
  var fab = porId('cat-fab');
  if (fab) fab.className = 'cat-fab-carrito';
}

function catActualizarCampo(campo, valor) { _catForm[campo] = valor; }

function renderPedido() {
  var panel = porId('cat-panel');
  if (!panel) return;

  if (_catConfirmacion) { panel.innerHTML = confirmacionHTML(); return; }

  var ids = Object.keys(_catCarrito);
  var items = ids.map(function (idStr) {
    var id = +idStr;
    var c = _catColores.find(function (x) { return x.id === id; });
    return c ? { color: c, cantidad: _catCarrito[id] } : null;
  }).filter(Boolean);

  panel.innerHTML =
    '<div class="cat-pedido-cab">' +
      '<div class="cat-pedido-titulo">Tu pedido (' + items.length + ')</div>' +
      '<button class="btn btn-fantasma" style="margin-left:auto;padding:4px" aria-label="Cerrar" onclick="catCerrarPedido()">' + ic('x', 18) + '</button>' +
    '</div>' +
    '<div class="cat-pedido-cuerpo">' +
      (items.length
        ? items.map(function (it) {
            var miniatura = cartThumbHTML(it.color);
            return '<div class="cat-pedido-fila">' +
              '<div class="cat-pedido-swatch' + miniatura.clase + '">' + miniatura.html + '</div>' +
              '<div class="cat-pedido-fila-info">' +
                '<div class="cat-pedido-fila-codigo">' + esc(it.color.codigo) + '</div>' +
                '<div class="cat-pedido-fila-nombre">' + esc(it.color.nombre || it.color.codigo) + '</div>' +
              '</div>' +
              '<div class="cat-pedido-fila-acciones">' +
                '<div class="cat-card-stepper">' +
                  '<button onclick="catCambiarCantidad(' + it.color.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
                  '<span>' + it.cantidad + '</span>' +
                  '<button ' + (it.cantidad >= (+it.color.stock || 0) ? 'disabled' : '') + ' onclick="catCambiarCantidad(' + it.color.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
                '</div>' +
                '<button class="cat-pedido-fila-trash" onclick="catQuitar(' + it.color.id + ')" aria-label="Quitar">' + ic('trash', 15) + '</button>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="cat-pedido-vacio">' + ic('cart', 26) + '<div style="margin-top:8px">Todavía no agregaste ningún color</div></div>') +
    '</div>' +

    '<div class="cat-datos">' +
      '<div class="cat-datos-titulo">Datos del local</div>' +
      '<div class="campo"><div class="campo-etiq">Nombre del local *</div>' +
        '<input class="campo-input" placeholder="Ej: Estética Bella" value="' + esc(_catForm.local) + '" oninput="catActualizarCampo(\'local\',this.value)"/></div>' +
      '<div class="campo"><div class="campo-etiq">Teléfono / WhatsApp *</div>' +
        '<input class="campo-input" placeholder="Ej: 11 1234-5678" value="' + esc(_catForm.telefono) + '" oninput="catActualizarCampo(\'telefono\',this.value)"/></div>' +
      '<div class="campo"><div class="campo-etiq">Localidad *</div>' +
        '<input class="campo-input" placeholder="Ej: San Isidro" value="' + esc(_catForm.localidad) + '" oninput="catActualizarCampo(\'localidad\',this.value)"/></div>' +
      '<div class="campo"><div class="campo-etiq">Nombre de contacto (opcional)</div>' +
        '<input class="campo-input" placeholder="Ej: Laura" value="' + esc(_catForm.contacto) + '" oninput="catActualizarCampo(\'contacto\',this.value)"/></div>' +
      '<div class="campo"><div class="campo-etiq">Observaciones (opcional)</div>' +
        '<textarea class="campo-input" rows="2" placeholder="Alguna aclaración sobre tu pedido…" oninput="catActualizarCampo(\'observaciones\',this.value)">' + esc(_catForm.observaciones) + '</textarea></div>' +
      (WHATSAPP_NUMERO ? '<div class="cat-ayuda-whatsapp"><div class="cat-ayuda-whatsapp-texto">¿Tenés dudas sobre algún color? Escribinos.</div>' +
        '<a class="btn btn-secundario" style="padding:7px 11px;font-size:12px" href="' + linkWhatsApp('Hola! Tengo una consulta sobre el catálogo de esmaltes.') + '" target="_blank" rel="noopener">' + ic('phone', 14) + ' WhatsApp</a></div>' : '') +
    '</div>' +

    '<div class="cat-pedido-pie">' +
      '<button class="btn btn-primario btn-bloque" ' + (_catEnviando ? 'disabled' : '') + ' onclick="catHacerPedido()">' +
        (_catEnviando ? cargando('Enviando…') : (ic('cart', 16) + ' Hacer pedido')) + '</button>' +
      '<div class="campo-ayuda" style="text-align:center;margin-top:6px">' + ic('lock', 11) + ' Tu pedido va directo al equipo, que lo confirma.</div>' +
    '</div>';
}

async function catHacerPedido() {
  var ids = Object.keys(_catCarrito);
  if (!ids.length) { toast('Agregá al menos un color', 'error'); return; }
  if (!_catForm.local.trim()) { toast('Falta el nombre del local', 'error'); return; }
  if (!_catForm.telefono.trim()) { toast('Falta el teléfono', 'error'); return; }
  if (!_catForm.localidad.trim()) { toast('Falta la localidad', 'error'); return; }

  var items = ids.map(function (idStr) {
    var id = +idStr;
    var c = _catColores.find(function (x) { return x.id === id; });
    return c ? { id: id, cantidad: _catCarrito[id] } : null;
  }).filter(Boolean);

  for (var i = 0; i < items.length; i++) {
    var c = _catColores.find(function (x) { return x.id === items[i].id; });
    if (!c || (+c.stock || 0) < items[i].cantidad) {
      toast('Cambió el stock de ' + (c ? c.codigo : 'un color') + ': revisá tu pedido', 'error');
      await cargarColores(false);
      return;
    }
  }

  _catEnviando = true;
  renderPedido();
  try {
    var r = await crearPedidoB2B(_catForm.local.trim(), _catForm.telefono.trim(), _catForm.contacto.trim(), _catForm.observaciones.trim(), _catForm.localidad.trim(), items);
    _catConfirmacion = { numero: r.numero };
    _catCarrito = {};
    _catForm = { local: '', telefono: '', localidad: '', contacto: '', observaciones: '' };
    renderPedido();
    actualizarBadgeCarrito();
    await cargarColores(false);
  } catch (e) {
    toast(e.message, 'error');
    await cargarColores(false);
  } finally {
    _catEnviando = false;
    if (!_catConfirmacion) renderPedido();
  }
}

function confirmacionHTML() {
  return '<div class="cat-pedido-cab"><div class="cat-pedido-titulo">Pedido enviado</div>' +
      '<button class="btn btn-fantasma" style="margin-left:auto;padding:4px" aria-label="Cerrar" onclick="catCerrarPedido()">' + ic('x', 18) + '</button></div>' +
    '<div class="cat-pedido-cuerpo">' +
      '<div class="cat-confirmacion">' +
        '<div class="cat-confirmacion-ic">' + ic('check', 26) + '</div>' +
        '<div class="campo-ayuda">Tu pedido quedó registrado</div>' +
        '<div class="cat-confirmacion-numero">' + esc(_catConfirmacion.numero) + '</div>' +
        '<span class="pin pin-warn">Pendiente</span>' +
        '<p style="font-size:12.5px;color:var(--muted);margin-top:16px">El equipo lo va a preparar y te contacta al teléfono que dejaste.</p>' +
      '</div>' +
    '</div>' +
    '<div class="cat-pedido-pie">' +
      '<button class="btn btn-secundario btn-bloque" onclick="catNuevoPedido()">Hacer otro pedido</button>' +
    '</div>';
}
function catNuevoPedido() { _catConfirmacion = null; renderPedido(); catCerrarPedido(); }

function comoComprarHTML() {
  return '<h1 class="cat-cab-titulo">Cómo comprar</h1>' +
    '<div class="cat-cab-sub" style="margin-bottom:20px">Es simple: elegís, revisás y confirmás.</div>' +
    [
      ['Catálogo', 'Recorré los colores disponibles, filtrá por colección o acabado y buscá por código o nombre.'],
      ['Seleccioná colores', 'Elegí la cantidad de cada color. Nunca vas a poder pedir más de lo que hay en stock.'],
      ['Revisá tu pedido', 'Abrí "Tu pedido" para ver todo lo que agregaste, con la opción de sumar, restar o quitar.'],
      ['Datos del local', 'Completá nombre del local y teléfono (obligatorios); contacto y observaciones son opcionales.'],
      ['Hacé el pedido', 'Confirmá y listo: te queda un número de pedido para hacer seguimiento.'],
      ['Confirmación', 'El equipo recibe tu pedido, lo prepara y te contacta al teléfono que dejaste.']
    ].map(function (p, i) {
      return '<div class="paso-envio"><div class="paso-num">' + (i + 1) + '</div>' +
        '<div><div class="paso-titulo">' + esc(p[0]) + '</div><div class="paso-texto">' + esc(p[1]) + '</div></div></div>';
    }).join('');
}
