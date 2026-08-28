/* ═══════════════════════════════════════════════════════════
   CATÁLOGO — INTENCIONAL
   Catálogo → seleccionar colores → revisar pedido → datos del
   local → hacer pedido → confirmación. Todo el stock que se ve
   acá es el mismo de la tabla "colores" que usa el panel de
   gestión: no hay ningún número propio de este sitio.
   ═══════════════════════════════════════════════════════════ */

var _catColores = [];
var _catProductos = [];
var _catPacks = [];
var _catPackItems = [];
var _catCargando = true;
var _catError = '';

/* El carrito ahora puede tener colores (esmaltes/semipermanentes),
   productos simples (cremas, colágeno) y packs mezclados, así que
   la clave deja de ser solo el id: es "tipo_id" (ej. "color_5",
   "producto_2", "pack_1"), y cada entrada guarda tipo+id+cantidad. */
var _catCarrito = {};           // "tipo_id" -> { tipo, id, cantidad }
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

/* Pestañas de tipo de producto — todo junto con un filtro, como en
   el panel de gestión, en vez de una sección aparte por tipo. */
var VISTAS_CATALOGO = [
  { id: 'pack',           etiqueta: 'Packs',             corta: 'Packs',      icono: 'box',      singular: 'pack',     plural: 'packs' },
  { id: 'tradicional',    etiqueta: 'Esmaltes',          corta: 'Esmaltes',   icono: 'droplet',  singular: 'color',    plural: 'colores' },
  { id: 'semipermanente', etiqueta: 'Semipermanentes',   corta: 'Semiperm.',  icono: 'sparkles', singular: 'color',    plural: 'colores' },
  { id: 'producto',       etiqueta: 'Cremas y colágeno', corta: 'Cremas',     icono: 'pill',     singular: 'producto', plural: 'productos' }
];
var _catTipo = 'tradicional';

function catVistaActual() {
  return VISTAS_CATALOGO.filter(function (v) { return v.id === _catTipo; })[0] || VISTAS_CATALOGO[0];
}

document.addEventListener('DOMContentLoaded', iniciarCatalogo);

async function iniciarCatalogo() {
  renderShell();
  await cargarCatalogo(true);
  setInterval(function () { cargarCatalogo(false); }, 25000);
}

/* Trae colores, productos, packs y pack_items en paralelo — todo lo
   que puede aparecer en el catálogo y en un pedido mezclado. */
async function cargarCatalogo(primeraVez) {
  try {
    var resultados = await Promise.all([traerColores(), traerProductos(), traerPacks(), traerPackItems()]);
    _catColores = resultados[0];
    _catProductos = resultados[1];
    _catPacks = resultados[2];
    _catPackItems = resultados[3];
    _catCargando = false;
    _catError = '';

    /* Si mientras alguien tenía cosas en el carrito el stock bajó
       (otro local compró, o lo ajustaron desde el panel), se
       recorta el pedido a lo que realmente queda — sea color,
       producto o pack. */
    var recortado = false;
    Object.keys(_catCarrito).forEach(function (k) {
      var it = _catCarrito[k];
      var disponible = catStock(it.tipo, it.id);
      var activo = catActivo(it.tipo, it.id);
      if (!activo || disponible <= 0) { delete _catCarrito[k]; recortado = true; }
      else if (it.cantidad > disponible) { it.cantidad = disponible; recortado = true; }
    });
    if (recortado && !primeraVez) toast('Actualizamos tu pedido: cambió el stock de algún producto', 'error');

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

/* ── Helpers genéricos por tipo (color / producto / pack) ────── */
function catClave(tipo, id) { return tipo + '_' + id; }

function catEntidad(tipo, id) {
  if (tipo === 'producto') return _catProductos.find(function (x) { return x.id === id; });
  if (tipo === 'pack') return _catPacks.find(function (x) { return x.id === id; });
  return _catColores.find(function (x) { return x.id === id; });
}

function catActivo(tipo, id) {
  var e = catEntidad(tipo, id);
  return !!(e && bool(e.activo));
}

/* El "stock" de un pack no es un número propio: es lo máximo que se
   puede armar con el stock actual de lo que trae (el mínimo entre
   todos sus renglones, cada uno dividido por cuántas unidades lleva
   el pack) — puede traer colores Y productos simples mezclados. */
function catStock(tipo, id) {
  if (tipo === 'producto') { var p = catEntidad('producto', id); return p ? (+p.stock || 0) : 0; }
  if (tipo === 'pack') {
    var items = _catPackItems.filter(function (it) { return it.pack_id === id; });
    if (!items.length) return 0;
    var min = Infinity;
    items.forEach(function (it) {
      var disp;
      if (it.tipo_item === 'producto') {
        var prod = _catProductos.find(function (x) { return x.id === it.producto_id; });
        disp = prod ? (+prod.stock || 0) : 0;
      } else {
        var c = _catColores.find(function (x) { return x.id === it.color_id; });
        disp = c ? (+c.stock || 0) : 0;
      }
      min = Math.min(min, Math.floor(disp / (+it.cantidad || 1)));
    });
    return Math.max(0, min);
  }
  var col = catEntidad('color', id);
  return col ? (+col.stock || 0) : 0;
}

/* ── Armado de la pantalla (una sola vez) ────────────────── */
function renderShell() {
  document.body.innerHTML =
    '<div class="cat-top" id="cat-top">' +
      '<header class="cat-header">' +
        '<div class="cat-marca"><img src="' + LOGO_INTENCIONAL + '" alt=""/>' +
          '<div><div class="cat-marca-nombre">Intencional</div><div class="cat-marca-sub">Esmaltes · Catálogo</div></div>' +
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
      '<div class="cat-tipo-tabs-bar" id="cat-tipo-tabs-bar"></div>' +
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
  renderTipoTabs();
  renderFiltros();
  renderPedido();
  ajustarAlturaTop();
  window.addEventListener('resize', ajustarAlturaTop);
}

/* Pestañas Esmaltes / Semipermanentes / Cremas y colágeno / Packs.
   Cambiar de pestaña limpia los filtros que no le pertenecen a la
   nueva (colección/acabado/oferta son solo de colores) y vuelve a
   la primera página. */
function renderTipoTabs() {
  var cont = porId('cat-tipo-tabs-bar');
  if (!cont) return;
  cont.innerHTML = '<div class="tipo-tabs">' +
    VISTAS_CATALOGO.map(function (v) {
      return '<button class="tipo-tab' + (v.id === _catTipo ? ' activo' : '') + '" onclick="catCambiarTipo(\'' + v.id + '\')">' +
        ic(v.icono, 15) +
        '<span class="tipo-tab-full">' + esc(v.etiqueta) + '</span>' +
        '<span class="tipo-tab-corta">' + esc(v.corta) + '</span>' +
      '</button>';
    }).join('') +
  '</div>';
}

function catCambiarTipo(id) {
  if (id === _catTipo) return;
  _catTipo = id;
  _catBusca = ''; _catColecciones = {}; _catAcabados = {}; _catSoloOfertas = false; _catPagina = 1;
  renderBuscadorBar();
  renderTipoTabs();
  renderFiltros();
  renderCatalogo();
  ajustarAlturaTop();
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

  /* Los filtros y las pestañas de tipo son del catálogo: en "Cómo
     comprar" no pintan nada */
  var toggle = document.querySelector('.cat-filtros-toggle');
  if (toggle) toggle.style.display = vista === 'catalogo' ? '' : 'none';
  var filtros = porId('cat-filtros');
  if (filtros) filtros.style.display = vista === 'catalogo' ? '' : 'none';
  var tabsBar = porId('cat-tipo-tabs-bar');
  if (tabsBar) tabsBar.style.display = vista === 'catalogo' ? '' : 'none';

  renderCatalogo();
  window.scrollTo(0, 0);
  ajustarAlturaTop();
}

function catAlternarFiltros() {
  _catFiltrosVisibles = !_catFiltrosVisibles;
  porId('cat-filtros').className = 'cat-filtros' + (_catFiltrosVisibles ? ' visible' : '');
}

/* ── Filtros ──────────────────────────────────────────────── */
/* Colección, acabado y "solo en oferta" son filtros de colores —
   no tienen sentido para cremas/colágeno ni para packs. */
function catEsColores() { return _catTipo === 'tradicional' || _catTipo === 'semipermanente'; }

function catColoresDeVista() {
  return _catColores.filter(function (c) { return (c.tipo || 'tradicional') === _catTipo; });
}

function valoresUnicosCat(campo) {
  var s = {};
  catColoresDeVista().forEach(function (c) { if (c[campo]) s[c[campo]] = 1; });
  return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}

function renderFiltros() {
  var cont = porId('cat-filtros');
  if (!cont) return;
  var esColores = catEsColores();
  var colecciones = esColores ? valoresUnicosCat('coleccion') : [];
  var acabados = esColores ? valoresUnicosCat('acabado') : [];

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
      (esColores ? '<label class="cat-toggle"><input type="checkbox"' + (_catSoloOfertas ? ' checked' : '') +
        ' onchange="catToggleOfertas(this.checked)"/> Solo en oferta</label>' : '') +
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
/* La fuente "cruda" según la pestaña activa, antes de aplicar
   búsqueda/filtros — sirve para distinguir "todavía no hay nada de
   esto cargado" de "hay, pero ninguno coincide con lo que buscás". */
function catFuenteVista() {
  if (_catTipo === 'producto') return _catProductos;
  if (_catTipo === 'pack') return _catPacks;
  return catColoresDeVista();
}

function catItemsFiltrados() {
  var q = normalizar(_catBusca);

  if (catEsColores()) {
    var colSel = Object.keys(_catColecciones).length > 0;
    var acaSel = Object.keys(_catAcabados).length > 0;
    return catColoresDeVista().filter(function (c) {
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

  if (_catTipo === 'producto') {
    return _catProductos.filter(function (p) {
      if (_catSoloDisponibles && (+p.stock || 0) <= 0) return false;
      if (!q) return true;
      return normalizar(p.nombre).indexOf(q) !== -1;
    }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  }

  /* packs */
  return _catPacks.filter(function (p) {
    if (_catSoloDisponibles && catStock('pack', p.id) <= 0) return false;
    if (!q) return true;
    return normalizar(p.nombre).indexOf(q) !== -1;
  }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

function itemCardHTML(item) {
  if (_catTipo === 'producto') return cardProductoHTML(item);
  if (_catTipo === 'pack') return cardPackHTML(item);
  return cardColorHTML(item);
}

function renderCatalogo() {
  var cont = porId('cat-main');
  if (!cont) return;

  if (_catVista === 'comprar') { cont.innerHTML = comoComprarHTML(); return; }

  if (_catCargando) { cont.innerHTML = cargando('Cargando catálogo…'); return; }
  if (_catError) {
    cont.innerHTML = avisoHTML('danger', '<strong>No se pudo cargar el catálogo.</strong><br>' + esc(_catError) +
      '<br><button class="btn btn-secundario" style="margin-top:10px" onclick="cargarCatalogo(true)">Reintentar</button>');
    return;
  }

  var vista = catVistaActual();
  var fuente = catFuenteVista();
  if (!fuente.length) {
    cont.innerHTML =
      '<div class="cat-cab-fila"><div><h1 class="cat-cab-titulo">' + esc(vista.etiqueta) + '</h1></div></div>' +
      vacio('palette', 'Todavía no hay nada acá', 'En cuanto se cargue en el sistema, va a aparecer.');
    return;
  }

  var lista = catItemsFiltrados();
  var total = lista.length;
  var totalPaginas = Math.max(1, Math.ceil(total / CAT_POR_PAGINA));
  if (_catPagina > totalPaginas) _catPagina = totalPaginas;
  var desde = (_catPagina - 1) * CAT_POR_PAGINA;
  var visibles = lista.slice(desde, desde + CAT_POR_PAGINA);

  if (!total) {
    cont.innerHTML =
      '<div class="cat-cab-fila"><div><h1 class="cat-cab-titulo">' + esc(vista.etiqueta) + '</h1></div></div>' +
      vacio('search', 'Nada coincide', 'Probá cambiar la búsqueda o los filtros.');
    return;
  }

  cont.innerHTML =
    '<div class="cat-cab-fila">' +
      '<div><h1 class="cat-cab-titulo">' + esc(vista.etiqueta) + '</h1>' +
        '<div class="cat-cab-sub">Mostrando ' + plural(total, vista.singular, vista.plural) + '</div></div>' +
    '</div>' +

    '<div class="cat-grid">' + visibles.map(itemCardHTML).join('') + '</div>' +

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
function cartThumbHTML(tipo, e) {
  if (tipo === 'color') {
    if (e.imagen_una_url) {
      return { clase: ' cat-nail-swatch-wrap', html: '<img class="cat-nail-swatch" src="' + esc(e.imagen_una_url) + '" alt=""/>' };
    }
    if (e.imagen_url) {
      return { clase: '', html: '<img src="' + esc(e.imagen_url) + '" alt="' + esc(e.nombre || e.codigo) + '"/>' };
    }
    return { clase: ' cat-nail-swatch-wrap', html: nailSwatchHTML(e.hex, 'cart' + e.id) };
  }
  if (e.imagen_url) {
    return { clase: '', html: '<img src="' + esc(e.imagen_url) + '" alt="' + esc(e.nombre) + '"/>' };
  }
  return { clase: ' cat-nail-swatch-wrap', html: '<div class="cat-tipo-icono cat-tipo-icono-mini">' + ic(tipo === 'pack' ? 'box' : 'pill', 18) + '</div>' };
}

/* ── Ícono genérico para productos y packs sin foto ──────────── */
function tipoIconoHTML(tipo) {
  return '<div class="cat-tipo-icono">' + ic(tipo === 'pack' ? 'box' : 'pill', 30) + '</div>';
}

/* Precio de lista, y si el color está en oferta, el precio de
   oferta al lado (tachando el de lista) más la letra chica: desde
   qué cantidad vale y cualquier aclaración que se haya cargado.
   Sin precio de lista cargado, no se muestra nada — no se inventa
   ningún número. */
function precioHTML(c) {
  var lista = +c.precio || 0;
  if (!lista) return '';
  var oferta = bool(c.en_oferta) && c.precio_oferta != null && +c.precio_oferta > 0 ? +c.precio_oferta : 0;
  if (!oferta) return '<span class="cat-precio-lista">' + plata(lista) + '</span>';

  var pack = +c.oferta_pack || 0;
  return '<span class="cat-precio-tachado">' + plata(lista) + '</span> ' +
    '<span class="cat-precio-oferta">' + plata(oferta) + (pack ? ' <span class="cat-precio-pack">c/u desde ' + pack + ' u.</span>' : '') + '</span>' +
    (c.oferta_nota ? '<div class="cat-precio-nota">' + esc(c.oferta_nota) + '</div>' : '');
}

function cardColorHTML(c) {
  var stock = +c.stock || 0;
  var disponible = stock > 0;
  var cantidad = (_catCarrito[catClave('color', c.id)] || {}).cantidad || 0;

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
        ? '<button class="cat-card-agregar" onclick="catAgregar(\'color\',' + c.id + ')" aria-label="Agregar al pedido">' + ic('plus', 15) + '</button>'
        : '<div class="cat-card-stepper">' +
            '<button onclick="catCambiarCantidad(\'color\',' + c.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
            '<span>' + cantidad + '</span>' +
            '<button ' + (cantidad >= stock ? 'disabled' : '') + ' onclick="catCambiarCantidad(\'color\',' + c.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
          '</div>');

  return '<div class="cat-card' + (disponible ? '' : ' agotado') + '">' +
    '<button type="button" class="cat-card-vidriera' + ((c.imagen_una_url || c.imagen_url) ? '' : ' sin-foto') + '" ' +
      'onclick="catAbrirDetalle(\'color\',' + c.id + ')" aria-label="Ver el detalle de ' + esc(c.nombre || c.codigo) + '">' + vidriera +
      (c.en_oferta ? '<span class="cat-card-oferta">Oferta</span>' : '') +
      '<span class="cat-card-estado"><span class="pin pin-' + (disponible ? 'ok' : 'danger') + '">' +
        (disponible ? 'Disponible' : 'Sin stock') + '</span></span>' +
    '</button>' +
    '<div class="cat-card-cuerpo">' +
      '<div class="cat-card-codigo">' + esc(c.codigo) + '</div>' +
      '<div class="cat-card-nombre">' + esc(c.nombre || c.codigo) + '</div>' +
      '<div class="cat-card-tags">' + [c.coleccion, c.acabado].filter(Boolean).map(esc).join(' · ') + '</div>' +
      (precioHTML(c) ? '<div class="cat-card-precio">' + precioHTML(c) + '</div>' : '') +
      '<div class="cat-card-pie">' +
        (disponible ? '<div class="cat-card-stock">' + stock + ' u. disp.</div>' : '<div class="cat-card-stock agotado">Sin stock</div>') +
        control +
      '</div>' +
    '</div>' +
  '</div>';
}

/* ── Tarjetas de producto simple (cremas, colágeno) y de pack ─
   Mismo molde visual que la tarjeta de color (.cat-card), pero sin
   colección/acabado y con un ícono en vez de la uña dibujada
   cuando no hay foto propia. */
var CATEGORIAS_PRODUCTO_CAT = { crema: 'Crema', colageno: 'Colágeno', otro: 'Otro' };

function cardProductoHTML(p) {
  var stock = +p.stock || 0;
  var disponible = stock > 0;
  var cantidad = (_catCarrito[catClave('producto', p.id)] || {}).cantidad || 0;
  var vidriera = p.imagen_url
    ? '<img class="cat-card-img-principal" src="' + esc(p.imagen_url) + '" alt="' + esc(p.nombre) + '"/>'
    : tipoIconoHTML('producto');

  var control = !disponible
    ? '<button class="cat-card-agregar" disabled aria-label="Sin stock">' + ic('plus', 15) + '</button>'
    : (cantidad <= 0
        ? '<button class="cat-card-agregar" onclick="catAgregar(\'producto\',' + p.id + ')" aria-label="Agregar al pedido">' + ic('plus', 15) + '</button>'
        : '<div class="cat-card-stepper">' +
            '<button onclick="catCambiarCantidad(\'producto\',' + p.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
            '<span>' + cantidad + '</span>' +
            '<button ' + (cantidad >= stock ? 'disabled' : '') + ' onclick="catCambiarCantidad(\'producto\',' + p.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
          '</div>');

  return '<div class="cat-card' + (disponible ? '' : ' agotado') + '">' +
    '<button type="button" class="cat-card-vidriera' + (p.imagen_url ? '' : ' sin-foto') + '" ' +
      'onclick="catAbrirDetalle(\'producto\',' + p.id + ')" aria-label="Ver el detalle de ' + esc(p.nombre) + '">' + vidriera +
      '<span class="cat-card-estado"><span class="pin pin-' + (disponible ? 'ok' : 'danger') + '">' +
        (disponible ? 'Disponible' : 'Sin stock') + '</span></span>' +
    '</button>' +
    '<div class="cat-card-cuerpo">' +
      '<div class="cat-card-nombre">' + esc(p.nombre) + '</div>' +
      (CATEGORIAS_PRODUCTO_CAT[p.categoria] ? '<div class="cat-card-tags">' + esc(CATEGORIAS_PRODUCTO_CAT[p.categoria]) + '</div>' : '') +
      (+p.precio ? '<div class="cat-card-precio"><span class="cat-precio-lista">' + plata(+p.precio) + '</span></div>' : '') +
      '<div class="cat-card-pie">' +
        (disponible ? '<div class="cat-card-stock">' + stock + ' u. disp.</div>' : '<div class="cat-card-stock agotado">Sin stock</div>') +
        control +
      '</div>' +
    '</div>' +
  '</div>';
}

function cardPackHTML(pk) {
  var stock = catStock('pack', pk.id);
  var disponible = stock > 0;
  var cantidad = (_catCarrito[catClave('pack', pk.id)] || {}).cantidad || 0;
  var vidriera = pk.imagen_url
    ? '<img class="cat-card-img-principal" src="' + esc(pk.imagen_url) + '" alt="' + esc(pk.nombre) + '"/>'
    : tipoIconoHTML('pack');

  var control = !disponible
    ? '<button class="cat-card-agregar" disabled aria-label="Sin stock">' + ic('plus', 15) + '</button>'
    : (cantidad <= 0
        ? '<button class="cat-card-agregar" onclick="catAgregar(\'pack\',' + pk.id + ')" aria-label="Agregar al pedido">' + ic('plus', 15) + '</button>'
        : '<div class="cat-card-stepper">' +
            '<button onclick="catCambiarCantidad(\'pack\',' + pk.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
            '<span>' + cantidad + '</span>' +
            '<button ' + (cantidad >= stock ? 'disabled' : '') + ' onclick="catCambiarCantidad(\'pack\',' + pk.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
          '</div>');

  return '<div class="cat-card' + (disponible ? '' : ' agotado') + '">' +
    '<button type="button" class="cat-card-vidriera' + (pk.imagen_url ? '' : ' sin-foto') + '" ' +
      'onclick="catAbrirDetalle(\'pack\',' + pk.id + ')" aria-label="Ver el detalle de ' + esc(pk.nombre) + '">' + vidriera +
      '<span class="cat-card-estado"><span class="pin pin-' + (disponible ? 'ok' : 'danger') + '">' +
        (disponible ? 'Disponible' : 'Sin stock') + '</span></span>' +
    '</button>' +
    '<div class="cat-card-cuerpo">' +
      '<div class="cat-card-nombre">' + esc(pk.nombre) + '</div>' +
      (+pk.precio ? '<div class="cat-card-precio"><span class="cat-precio-lista">' + plata(+pk.precio) + '</span></div>' : '') +
      '<div class="cat-card-pie">' +
        (disponible ? '<div class="cat-card-stock">' + stock + ' u. disp.</div>' : '<div class="cat-card-stock agotado">Sin stock</div>') +
        control +
      '</div>' +
    '</div>' +
  '</div>';
}

/* Qué trae un pack (colores y/o productos), para mostrarlo en su
   ficha de detalle. */
function packContenidoHTML(packId) {
  var items = _catPackItems.filter(function (it) { return it.pack_id === packId; });
  if (!items.length) return '';
  return '<div class="cat-pack-contenido"><div class="campo-etiq">Este pack incluye</div>' +
    items.map(function (it) {
      var etiqueta;
      if (it.tipo_item === 'producto') {
        var prod = _catProductos.find(function (x) { return x.id === it.producto_id; });
        etiqueta = prod ? prod.nombre : 'Producto eliminado';
      } else {
        var c = _catColores.find(function (x) { return x.id === it.color_id; });
        etiqueta = c ? (c.codigo + (c.nombre ? ' — ' + c.nombre : '')) : 'Color eliminado';
      }
      return '<div class="cat-pack-fila"><span>' + esc(etiqueta) + '</span><span>x' + it.cantidad + '</span></div>';
    }).join('') +
  '</div>';
}

/* Ficha de detalle de un color, producto o pack: imagen grande
   (deslizable si hay más de una), descripción, y la posibilidad de
   agregarlo al pedido con la cantidad que se elija, todo sin salir
   de la ventana. Si a un color le falta alguna foto no se inventa
   nada de más — solo se muestra la que hay (y si no hay ninguna
   real, la uña dibujada; productos y packs usan un ícono). */
var _catDetalle = null; // { tipo, id, imgs:[{etiq,html}], idx, cantidad }
var _catSwipeX = null;

function catAbrirDetalle(tipo, id) {
  var e = catEntidad(tipo, id);
  if (!e) return;

  var imgs = [];
  var titulo;
  if (tipo === 'color') {
    if (e.imagen_url) imgs.push({ etiq: 'Frasco', html: '<img src="' + esc(e.imagen_url) + '" alt="' + esc(e.nombre || e.codigo) + '"/>' });
    if (e.imagen_una_url) imgs.push({ etiq: 'Uña de muestra', html: '<img src="' + esc(e.imagen_una_url) + '" alt=""/>' });
    if (!imgs.length) imgs.push({ etiq: 'Uña de muestra', html: nailSwatchHTML(e.hex, 'det' + e.id) });
    titulo = e.codigo + (e.nombre ? ' · ' + e.nombre : '');
  } else {
    imgs.push({ etiq: e.nombre, html: e.imagen_url ? '<img src="' + esc(e.imagen_url) + '" alt="' + esc(e.nombre) + '"/>' : tipoIconoHTML(tipo) });
    titulo = e.nombre;
  }

  var stock = catStock(tipo, id);
  var actual = (_catCarrito[catClave(tipo, id)] || {}).cantidad || 0;
  _catDetalle = { tipo: tipo, id: id, imgs: imgs, idx: 0, cantidad: Math.min(Math.max(actual, 1), Math.max(stock, 1)) };

  abrirModal(titulo, catDetalleHTML());
}

function catDetalleHTML() {
  var d = _catDetalle;
  if (!d) return '';
  var e = catEntidad(d.tipo, d.id);
  if (!e) return '';
  var stock = catStock(d.tipo, d.id);
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

  var codigoLinea = d.tipo === 'color' ? '<div class="cat-detalle-codigo">' + esc(e.codigo) + '</div>' : '';
  var nombreLinea = '<h2 class="cat-detalle-nombre">' + esc(d.tipo === 'color' ? (e.nombre || e.codigo) : e.nombre) + '</h2>';

  var precio = '', desc = '', extra = '';
  if (d.tipo === 'color') {
    precio = precioHTML(e);
    var tags = [e.coleccion, e.acabado].filter(Boolean).map(esc).join(' · ');
    desc = e.descripcion
      ? '<p class="cat-detalle-desc">' + textoConFormato(e.descripcion) + '</p>'
      : (tags ? '<p class="cat-detalle-desc cat-detalle-desc-generica">' + tags + '</p>' : '');
  } else {
    precio = (+e.precio) ? '<span class="cat-precio-lista">' + plata(+e.precio) + '</span>' : '';
    desc = e.descripcion ? '<p class="cat-detalle-desc">' + textoConFormato(e.descripcion) + '</p>' : '';
    if (d.tipo === 'pack') extra = packContenidoHTML(d.id);
  }

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
      codigoLinea +
      nombreLinea +
      (precio ? '<div class="cat-detalle-precio">' + precio + '</div>' : '') +
      desc +
      extra +
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
  var stock = catStock(d.tipo, d.id);
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
  var stock = catStock(d.tipo, d.id);
  if (stock <= 0) return;
  _catCarrito[catClave(d.tipo, d.id)] = { tipo: d.tipo, id: d.id, cantidad: Math.max(1, Math.min(stock, d.cantidad)) };
  cerrarModal();
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
  toast('Agregado al pedido');
}

/* ── Carrito ──────────────────────────────────────────────── */
function catAgregar(tipo, id) {
  if (catStock(tipo, id) <= 0) return;
  _catCarrito[catClave(tipo, id)] = { tipo: tipo, id: id, cantidad: 1 };
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
}
function catCambiarCantidad(tipo, id, delta) {
  var k = catClave(tipo, id);
  var stock = catStock(tipo, id);
  var actual = _catCarrito[k] ? _catCarrito[k].cantidad : 0;
  var nuevo = Math.max(0, Math.min(stock, actual + delta));
  if (nuevo <= 0) delete _catCarrito[k]; else _catCarrito[k] = { tipo: tipo, id: id, cantidad: nuevo };
  renderCatalogo(); renderPedido(); actualizarBadgeCarrito();
}
function catQuitar(tipo, id) {
  delete _catCarrito[catClave(tipo, id)];
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

  var items = Object.keys(_catCarrito).map(function (k) {
    var it = _catCarrito[k];
    var e = catEntidad(it.tipo, it.id);
    return e ? { tipo: it.tipo, entidad: e, cantidad: it.cantidad, stockMax: catStock(it.tipo, it.id) } : null;
  }).filter(Boolean);

  panel.innerHTML =
    '<div class="cat-pedido-cab">' +
      '<div class="cat-pedido-titulo">Tu pedido (' + items.length + ')</div>' +
      '<button class="btn btn-fantasma" style="margin-left:auto;padding:4px" aria-label="Cerrar" onclick="catCerrarPedido()">' + ic('x', 18) + '</button>' +
    '</div>' +
    '<div class="cat-pedido-cuerpo">' +
      (items.length
        ? items.map(function (it) {
            var miniatura = cartThumbHTML(it.tipo, it.entidad);
            var codigo = it.tipo === 'color' ? it.entidad.codigo : (it.tipo === 'pack' ? 'Pack' : 'Producto');
            var nombre = it.tipo === 'color' ? (it.entidad.nombre || it.entidad.codigo) : it.entidad.nombre;
            return '<div class="cat-pedido-fila">' +
              '<div class="cat-pedido-swatch' + miniatura.clase + '">' + miniatura.html + '</div>' +
              '<div class="cat-pedido-fila-info">' +
                '<div class="cat-pedido-fila-codigo">' + esc(codigo) + '</div>' +
                '<div class="cat-pedido-fila-nombre">' + esc(nombre) + '</div>' +
              '</div>' +
              '<div class="cat-pedido-fila-acciones">' +
                '<div class="cat-card-stepper">' +
                  '<button onclick="catCambiarCantidad(\'' + it.tipo + '\',' + it.entidad.id + ',-1)" aria-label="Restar">' + ic('minus', 12) + '</button>' +
                  '<span>' + it.cantidad + '</span>' +
                  '<button ' + (it.cantidad >= it.stockMax ? 'disabled' : '') + ' onclick="catCambiarCantidad(\'' + it.tipo + '\',' + it.entidad.id + ',1)" aria-label="Sumar">' + ic('plus', 12) + '</button>' +
                '</div>' +
                '<button class="cat-pedido-fila-trash" onclick="catQuitar(\'' + it.tipo + '\',' + it.entidad.id + ')" aria-label="Quitar">' + ic('trash', 15) + '</button>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="cat-pedido-vacio">' + ic('cart', 26) + '<div style="margin-top:8px">Todavía no agregaste nada</div></div>') +
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
  var claves = Object.keys(_catCarrito);
  if (!claves.length) { toast('Agregá al menos un producto', 'error'); return; }
  if (!_catForm.local.trim()) { toast('Falta el nombre del local', 'error'); return; }
  if (!_catForm.telefono.trim()) { toast('Falta el teléfono', 'error'); return; }
  if (!_catForm.localidad.trim()) { toast('Falta la localidad', 'error'); return; }

  var items = claves.map(function (k) {
    var it = _catCarrito[k];
    return { tipo: it.tipo, id: it.id, cantidad: it.cantidad };
  });

  /* Revalidación de stock justo antes de mandar el pedido — cubre
     colores directos, productos simples y packs (cuyo "stock" sale
     de los colores que traen). El chequeo atómico final lo hace la
     función del lado del servidor; esto es solo para avisar rápido
     si algo cambió sin tener que esperar el error del servidor. */
  for (var i = 0; i < items.length; i++) {
    var stockAhora = catStock(items[i].tipo, items[i].id);
    if (stockAhora < items[i].cantidad) {
      var e = catEntidad(items[i].tipo, items[i].id);
      toast('Cambió el stock de ' + (e ? (e.codigo || e.nombre) : 'un producto') + ': revisá tu pedido', 'error');
      await cargarCatalogo(false);
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
    await cargarCatalogo(false);
  } catch (e) {
    toast(e.message, 'error');
    await cargarCatalogo(false);
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
