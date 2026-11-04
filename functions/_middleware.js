function unauthorized() {
  return new Response('Acceso restringido.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mesa POS", charset="UTF-8"' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.POS_USER || !env.POS_PASSWORD) {
    return new Response('Falta configurar las credenciales de acceso de Mesa POS.', { status: 503 });
  }
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized();
  let decoded = '';
  try { decoded = atob(header.slice(6)); } catch { return unauthorized(); }
  const splitAt = decoded.indexOf(':');
  if (splitAt < 0 || decoded.slice(0, splitAt) !== env.POS_USER || decoded.slice(splitAt + 1) !== env.POS_PASSWORD) return unauthorized();
  return context.next();
}
