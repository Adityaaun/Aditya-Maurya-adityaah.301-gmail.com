let memoryToken = null;

export function setToken(token) {
  memoryToken = token;
}

export function getToken() {
  return memoryToken;
}

export async function apiFetch(path, options = {}) {
  const headers = { ...options.headers };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }
  
  if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/v1${path}`, { ...options, headers });
  
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    if (res.status === 401 && errorBody.error?.code === 'TOKEN_STALE') {
      // Trigger a global re-login or emit an event if needed
      window.dispatchEvent(new Event('auth:stale'));
    }
    if (res.status === 401 && errorBody.error?.code === 'UNAUTHENTICATED') {
      window.dispatchEvent(new Event('auth:unauthenticated'));
    }
    const err = new Error(errorBody.error?.message || res.statusText);
    err.status = res.status;
    err.code = errorBody.error?.code;
    throw err;
  }
  
  return res.json();
}
