// Base URL of the hours server. Override with VITE_API_URL when deploying.
//
// Trailing slashes are stripped: paths below all start with "/", so a value
// like "https://host/" would produce "https://host//api/...". That double
// slash 404s *before* the CORS middleware runs, so the browser blocks the
// response and the app reports a connection failure instead of a 404 —
// an unpleasant amount of time to spend on one character.
export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export const formUrl = token => `${API_BASE}/t/${token}`;

async function request(path, { method = 'GET', body, managerSecret } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(managerSecret ? { 'X-Manager-Secret': managerSecret } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor de horas.');
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `Error del servidor (${res.status}).`);
  return payload;
}

/**
 * Push the roster so the form can show the name picker.
 * Only ids and names are sent — wages stay in this browser.
 */
export function syncList({ listId, name, workers, managerSecret }) {
  return request(`/api/lists/${encodeURIComponent(listId)}`, {
    method: 'PUT',
    managerSecret,
    body: { name, workers: workers.map(w => ({ id: w.id, name: w.name })) }
  });
}

/** Remove the list from the server so it stops sending weekly reminders. */
export function deleteRemoteList({ listId, managerSecret }) {
  return request(`/api/lists/${encodeURIComponent(listId)}`, { method: 'DELETE', managerSecret });
}

export function fetchSubmissions({ listId, managerSecret, weekOf }) {
  const query = weekOf ? `?weekOf=${encodeURIComponent(weekOf)}` : '';
  return request(`/api/lists/${encodeURIComponent(listId)}/submissions${query}`, { managerSecret });
}

export function fetchReminder({ listId, managerSecret }) {
  return request(`/api/lists/${encodeURIComponent(listId)}/reminder`, { managerSecret });
}

/** Send the weekly notification immediately, to check it arrives. */
export function testReminderPush({ listId, managerSecret }) {
  return request(`/api/lists/${encodeURIComponent(listId)}/reminder/test`, {
    method: 'POST',
    managerSecret
  });
}

export function markReminderSent({ listId, managerSecret }) {
  return request(`/api/lists/${encodeURIComponent(listId)}/reminder/sent`, {
    method: 'POST',
    managerSecret
  });
}

export function markApplied({ listId, managerSecret, ids }) {
  return request(`/api/lists/${encodeURIComponent(listId)}/submissions/applied`, {
    method: 'POST',
    managerSecret,
    body: { ids }
  });
}
