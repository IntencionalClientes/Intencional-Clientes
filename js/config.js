/* ═══════════════════════════════════════════════════════════
   CONEXIÓN — mismo proyecto de Supabase que usa el panel de
   gestión. La clave publishable es pública por diseño: quien
   protege los datos son las políticas RLS del proyecto (ver
   migracion_catalogo_b2b.sql). Este catálogo NUNCA guarda stock
   propio: siempre lee y descuenta el de la tabla "colores".
   ═══════════════════════════════════════════════════════════ */
var SB_URL = 'https://mcobunyyuahxtjkykfby.supabase.co';
var SB_KEY = 'sb_publishable_BWiNB58kOu1NQOXbFZPbQw_N-BOcaDn';

/* Número de WhatsApp para las dos ayudas de la pantalla (formato
   internacional, solo dígitos: ej. 5491122334455). Vacío hasta
   que lo completes acá. */
var WHATSAPP_NUMERO = '';

function linkWhatsApp(mensaje) {
  if (!WHATSAPP_NUMERO) return '';
  return 'https://wa.me/' + WHATSAPP_NUMERO + (mensaje ? '?text=' + encodeURIComponent(mensaje) : '');
}
