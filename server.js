const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  if (!process.env.POS_USER || !process.env.POS_PASSWORD) {
    return json(res, 503, { message: 'Falta configurar POS_USER y POS_PASSWORD en el servidor.' });
  }
  if (!isAuthorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mesa POS", charset="UTF-8"' });
    return res.end('Acceso restringido.');
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/print') {
    try {
      const body = await readJson(req);
      const token = process.env.MP_ACCESS_TOKEN;
      if (!token) return json(res, 503, { message: 'Falta configurar MP_ACCESS_TOKEN en el servidor.' });
      if (!body.terminalId || !body.content) return json(res, 400, { message: 'Falta el ID de terminal o el contenido.' });
      if (body.content.length < 100 || body.content.length > 4096) return json(res, 400, { message: 'El texto de impresión debe tener entre 100 y 4096 caracteres.' });
      const reference = String(body.externalReference || `CMD_${Date.now()}`).slice(0, 64);
      if (!/^[a-zA-Z0-9_-]+$/.test(reference)) return json(res, 400, { message: 'Referencia de comanda inválida.' });
      const response = await fetch('https://api.mercadopago.com/terminals/v1/actions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({
          type: 'print',
          external_reference: reference,
          config: { point: { terminal_id: body.terminalId, subtype: 'custom' } },
          content: body.content
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status, {
        message: result.message || 'Mercado Pago rechazó la impresión.',
        error: result.error || null,
        cause: Array.isArray(result.cause) ? result.cause.map(item => ({ code: item.code, description: item.description })) : []
      });
      return json(res, 200, { id: result.id, status: result.status });
    } catch (error) {
      return json(res, 400, { message: error.message || 'Solicitud inválida.' });
    }
  }

  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(root, requested);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { message: 'No encontrado.' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 20000) { reject(new Error('Solicitud demasiado grande.')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON inválido.')); } });
    req.on('error', reject);
  });
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function isAuthorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const splitAt = decoded.indexOf(':');
  return splitAt > -1 && decoded.slice(0, splitAt) === process.env.POS_USER && decoded.slice(splitAt + 1) === process.env.POS_PASSWORD;
}

server.listen(port, () => console.log(`Mesa POS disponible en http://localhost:${port}`));
