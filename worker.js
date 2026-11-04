function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function unauthorized() {
  return new Response('Acceso restringido.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mesa POS", charset="UTF-8"' }
  });
}

function isAuthorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const splitAt = decoded.indexOf(':');
  return splitAt > -1 && decoded.slice(0, splitAt) === env.POS_USER && decoded.slice(splitAt + 1) === env.POS_PASSWORD;
}

async function printOrder(request, env) {
  if (!env.MP_ACCESS_TOKEN) return json({ message: 'Falta configurar el token de Mercado Pago.' }, 503);
  let input;
  try { input = await request.json(); } catch { return json({ message: 'Solicitud inválida.' }, 400); }
  const { terminalId, externalReference, content, subtype = 'custom' } = input || {};
  if (!terminalId || !content) return json({ message: 'Falta el ID de terminal o el contenido.' }, 400);
  if (!['custom', 'image'].includes(subtype)) return json({ message: 'Tipo de impresión no válido.' }, 400);
  if (typeof content !== 'string') return json({ message: 'El contenido de impresión no es válido.' }, 400);
  if (subtype === 'custom' && (content.length < 100 || content.length > 4096)) return json({ message: 'El texto debe tener entre 100 y 4096 caracteres.' }, 400);
  if (subtype === 'image' && (content.length > 1000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content))) return json({ message: 'La imagen debe ser PNG o JPEG codificada en Base64 y no superar 1 MB.' }, 400);
  const reference = String(externalReference || `CMD_${Date.now()}`).slice(0, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(reference)) return json({ message: 'Referencia de comanda inválida.' }, 400);
  try {
    const response = await fetch('https://api.mercadopago.com/terminals/v1/actions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        type: 'print',
        external_reference: reference,
        config: { point: { terminal_id: terminalId, subtype } },
        content
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({
      message: result.message || 'Mercado Pago rechazó la impresión.',
      apiStatus: response.status,
      error: result.error || null,
      cause: Array.isArray(result.cause) ? result.cause.map(item => ({ code: item.code, description: item.description })) : []
    }, response.status);
    return json({ id: result.id, status: result.status });
  } catch {
    return json({ message: 'No se pudo conectar con Mercado Pago.' }, 502);
  }
}

async function listTerminals(env) {
  if (!env.MP_ACCESS_TOKEN) return json({ message: 'Falta configurar el token de Mercado Pago.' }, 503);
  try {
    const response = await fetch('https://api.mercadopago.com/terminals/v1/list?limit=50', {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ message: result.message || 'Mercado Pago no pudo listar las terminales.', apiStatus: response.status, error: result.error || null }, response.status);
    const terminals = result?.data?.terminals || [];
    return json({ terminals: terminals.map(item => ({ id: item.id, operating_mode: item.operating_mode })) });
  } catch {
    return json({ message: 'No se pudo conectar con la lista de terminales de Mercado Pago.' }, 502);
  }
}

async function getPrintAction(actionId, env) {
  if (!env.MP_ACCESS_TOKEN) return json({ message: 'Falta configurar el token de Mercado Pago.' }, 503);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(actionId)) return json({ message: 'ID de impresión no válido.' }, 400);
  try {
    const response = await fetch(`https://api.mercadopago.com/terminals/v1/actions/${encodeURIComponent(actionId)}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ message: result.message || 'No se pudo consultar el estado de la impresión.', apiStatus: response.status, error: result.error || null }, response.status);
    return json({ id: result.id, status: result.status });
  } catch {
    return json({ message: 'No se pudo consultar el estado de la impresión.' }, 502);
  }
}

async function emailSale(request, env) {
  if (!env.GOOGLE_SCRIPT_URL || !env.GOOGLE_SCRIPT_SECRET) {
    return json({ message: 'Falta configurar el correo de ventas en Cloudflare.' }, 503);
  }
  let sale;
  try { sale = await request.json(); } catch { return json({ message: 'Venta inválida.' }, 400); }
  if (!sale || typeof sale.name !== 'string' || !Array.isArray(sale.items) || !Number.isFinite(Number(sale.total))) {
    return json({ message: 'Los datos de la venta no son válidos.' }, 400);
  }
  const items = sale.items.slice(0, 100).map(item => ({
    qty: Math.max(0, Number(item.qty) || 0),
    name: String(item.name || '').slice(0, 120),
    price: Math.max(0, Number(item.price) || 0)
  }));
  const details = items.map(item => `${item.qty} x ${item.name} — $${(item.qty * item.price).toFixed(2)}`).join('\n');
  const lines = [
    'VENTA REGISTRADA — CAPITÁN', '',
    `Mesa: ${sale.name.slice(0, 80)}`,
    `Fecha: ${String(sale.date || new Date().toLocaleString('es-MX')).slice(0, 100)}`,
    `Forma de pago: ${String(sale.method || 'No indicada').slice(0, 40)}`,
    '', 'Productos:', details || '(sin productos)', '',
    `Total: $${Number(sale.total).toFixed(2)}`
  ];
  if (sale.method === 'Efectivo') {
    lines.push(`Recibido: $${(Number(sale.cashReceived) || 0).toFixed(2)}`);
    lines.push(`Cambio: $${(Number(sale.change) || 0).toFixed(2)}`);
  }
  try {
    const response = await fetch(env.GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.GOOGLE_SCRIPT_SECRET,
        to: 'yohedespertado@gmail.com',
        subject: `Venta ${sale.name.slice(0, 80)} · $${Number(sale.total).toFixed(2)}`,
        text: lines.join('\n')
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) return json({ message: result.message || 'No se pudo enviar el correo de la venta.' }, 502);
    return json({ sent: true, id: result.id });
  } catch {
    return json({ message: 'No se pudo conectar con el servicio de correo.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (!env.POS_USER || !env.POS_PASSWORD) return json({ message: 'Falta configurar usuario y contraseña de la app.' }, 503);
    if (!isAuthorized(request, env)) return unauthorized();

    const url = new URL(request.url);
    if (url.pathname === '/api/print' && request.method === 'POST') return printOrder(request, env);
    if (url.pathname === '/api/sales/email' && request.method === 'POST') return emailSale(request, env);
    if (url.pathname === '/api/terminals' && request.method === 'GET') return listTerminals(env);
    const actionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)$/);
    if (actionMatch && request.method === 'GET') return getPrintAction(decodeURIComponent(actionMatch[1]), env);
    if (url.pathname.startsWith('/api/')) return json({ message: 'Ruta no encontrada.' }, 404);
    return env.ASSETS.fetch(request);
  }
};
