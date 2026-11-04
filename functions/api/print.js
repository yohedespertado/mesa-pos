export async function onRequestPost({ request, env }) {
  if (!env.MP_ACCESS_TOKEN) return json({ message: 'Falta configurar el token de Mercado Pago en el servidor.' }, 503);
  let input;
  try { input = await request.json(); } catch { return json({ message: 'Solicitud inválida.' }, 400); }
  const { terminalId, externalReference, content } = input || {};
  if (!terminalId || !content) return json({ message: 'Falta el ID de terminal o el contenido.' }, 400);
  if (typeof content !== 'string' || content.length < 100 || content.length > 4096) return json({ message: 'El texto debe tener entre 100 y 4096 caracteres.' }, 400);
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
        config: { point: { terminal_id: terminalId, subtype: 'custom' } },
        content
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ message: result.message || 'Mercado Pago rechazó la impresión.' }, response.status);
    return json({ id: result.id, status: result.status });
  } catch {
    return json({ message: 'No se pudo conectar con Mercado Pago.' }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
