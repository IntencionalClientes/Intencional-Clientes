# Catálogo B2B — Intencional

Sitio estático aparte, con el mismo sistema visual del panel de gestión. No tiene build: son archivos planos, listos para subir a Vercel (u otro hosting estático) tal cual.

## Antes de publicarlo

1. Corré `migracion_catalogo_b2b.sql` en el SQL Editor de tu proyecto de Supabase (el mismo que usa el panel: `mcobunyyuahxtjkykfby`). Crea las tablas `colores`, `pedidos_b2b`, `pedidos_b2b_items`, la función que reserva stock sin choques entre pedidos simultáneos, y los permisos (RLS).
2. Entrá al panel de gestión → sección **Colores** (nueva) → cargá los colores que querés mostrar en el catálogo, con su stock. Recién ahí van a aparecer acá.
3. Opcional: en `js/config.js` completá `WHATSAPP_NUMERO` (formato `5491122334455`, sin espacios ni signos) para que se activen los botones de ayuda por WhatsApp.

## Publicar

Subí esta carpeta a un proyecto nuevo de Vercel (o cualquier hosting estático): no necesita configuración adicional, `vercel.json` ya está incluido.

## Cómo funciona el stock

El catálogo lee el stock en vivo de la tabla `colores` (la misma que administrás desde el panel) y lo vuelve a leer cada 25 segundos. Nunca guarda un número propio. Cuando alguien hace un pedido, una función de la base (`crear_pedido_b2b`) bloquea esas filas, confirma que sigue habiendo stock suficiente y recién ahí descuenta — así, si dos locales piden el último frasco al mismo tiempo, solo uno se lo queda y el otro ve el aviso de que ya no hay.

## Pedidos

Cada pedido queda en la tabla `pedidos_b2b` con un número único (`PED-000001`, …) y aparece solo en la nueva sección **Pedidos** del panel, donde se le puede cambiar el estado (Pendiente → Preparando → Listo → Entregado, o Cancelado).
