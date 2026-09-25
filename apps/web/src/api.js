let csrf = '';
export function setCsrf(value) { csrf = value || ''; }
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch('/api' + path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch { const e = new Error('NETWORK_ERROR'); e.code = 'NETWORK_ERROR'; throw e; }
  const body = await response.json().catch(() => ({ error: 'SERVER_ERROR' }));
  if (!response.ok) { const e = new Error(body.error); e.code = body.error; e.status = response.status; e.fields = body.fields; throw e; }
  return body;
}
