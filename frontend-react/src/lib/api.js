/**
 * MemorAid API client.
 *
 * Single place where the React app talks to the Flask REST backend. All
 * feature modules go through this, so auth, error handling and the base URL
 * are defined once (separation of concerns — no fetch() calls in components).
 *
 * The backend is the single source of truth: there is no mock data layer.
 */
const BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5000';
const API_BASE = `${BASE}/api`;

const TOKEN_KEY = 'memoraid_token';
const USER_KEY = 'memoraid_user';

/** Raised for any non-2xx response, carrying the friendly backend message. */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Flask-JWT-Extended reports a malformed or wrongly-signed token as 422,
 * not 401. Treat those as an ended session so the app can clear the stale
 * token instead of surfacing "Signature verification failed" to the user.
 */
function isEndedSession(status, data) {
  if (status === 401) return true;
  if (status !== 422) return false;
  const message = String(data?.msg || data?.message || '');
  return /token|signature|header padding|segments|verification|expired/i.test(message);
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userStore = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set: (user) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      'We could not reach MemorAid. Please check your connection and try again.',
      0,
    );
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  // An expired or invalid token means the session is over.
  if (auth && !path.startsWith('/auth/') && isEndedSession(res.status, data)) {
    tokenStore.clear();
    window.dispatchEvent(new Event('memoraid:unauthorized'));
    throw new ApiError('Your session has ended. Please sign in again.', res.status, data);
  }
  if (!res.ok) {
    throw new ApiError(
      data.message || data.msg || 'Something went wrong. Please try again.',
      res.status,
      data,
    );
  }
  return data;
}

/**
 * Parse one Server-Sent Event block into { event, data }.
 * The backend sends `event: <name>` followed by a JSON `data:` line.
 */
function parseSseChunk(chunk) {
  let event = 'message';
  const dataLines = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/**
 * POST and read a Server-Sent Event stream.
 *
 * `EventSource` cannot POST, so the stream is read from fetch() with a
 * ReadableStream and parsed here. onEvent is called for every event the
 * backend sends (meta / token / done / error).
 */
async function streamRequest(path, body, { onEvent, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    throw new ApiError(
      'We could not reach MemorAid. Please check your connection and try again.',
      0,
    );
  }

  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (isEndedSession(res.status, data)) {
      tokenStore.clear();
      window.dispatchEvent(new Event('memoraid:unauthorized'));
      throw new ApiError('Your session has ended. Please sign in again.', res.status, data);
    }
    throw new ApiError(
      data.message || data.msg || 'Something went wrong. Please try again.',
      res.status,
      data,
    );
  }
  if (!res.body) {
    throw new ApiError('This browser cannot display streaming replies.', 0);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const parsed = parseSseChunk(chunk);
      if (parsed && onEvent) onEvent(parsed);
      split = buffer.indexOf('\n\n');
    }
  }
}

export const api = {
  // --- auth ---
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  // --- profile ---
  getProfile: () => request('/profile'),
  updateProfile: (payload) => request('/profile', { method: 'PUT', body: payload }),

  // --- memories ---
  getCategories: () => request('/categories'),
  getMemories: () => request('/memories'),
  createMemory: (payload) => request('/memories', { method: 'POST', body: payload }),

  // --- recall (SM-2 session flow) ---
  getDueReviews: () => request('/recall/due'),
  revealAnswer: (questionid) => request(`/recall/question/${questionid}/answer`),
  submitRecall: (payload) => request('/recall/submit', { method: 'POST', body: payload }),
  getRecallSummary: () => request('/recall/summary'),

  // --- exercises ---
  getNextExercise: (technique) =>
    request(`/exercises/next${technique ? `?technique=${encodeURIComponent(technique)}` : ''}`),
  completeExercise: (payload) => request('/exercises/complete', { method: 'POST', body: payload }),
  getExerciseHistory: () => request('/exercises/history'),

  // --- chat companion ---
  getChatHistory: () => request('/chat/history'),
  sendChatMessage: (message, mode) =>
    request('/chat', { method: 'POST', body: { message, mode } }),
  streamChatMessage: (message, { mode, onEvent, signal } = {}) =>
    streamRequest('/chat/stream', { message, mode }, { onEvent, signal }),
  getChatFacts: () => request('/chat/facts'),
  deleteChatFact: (factid) => request(`/chat/facts/${factid}`, { method: 'DELETE' }),
  deleteChatMessage: (messageid) =>
    request(`/chat/messages/${messageid}`, { method: 'DELETE' }),
  confirmChatMemory: () => request('/chat/memory/confirm', { method: 'POST', body: {} }),
  declineChatMemory: () => request('/chat/memory/decline', { method: 'POST', body: {} }),

  // --- check-in / notifications ---
  getCheckin: () => request('/checkin'),
  completeCheckin: () => request('/checkin/complete', { method: 'POST' }),
  getNotifications: ({ unreadOnly, limit } = {}) => {
    const params = new URLSearchParams();
    if (unreadOnly) params.set('unread', '1');
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return request(`/notifications${query ? `?${query}` : ''}`);
  },
  getUnreadCount: () => request('/notifications/unread-count'),
  markNotificationRead: (id) =>
    request(`/notifications/${id}/read`, { method: 'POST', body: {} }),
  deleteNotification: (id) =>
    request(`/notifications/${id}`, { method: 'DELETE' }),
  markAllNotificationsRead: () => request('/notifications/read', { method: 'POST', body: {} }),
  getNotificationPreferences: () => request('/notifications/preferences'),
  updateNotificationPreferences: (prefs) =>
    request('/notifications/preferences', { method: 'PUT', body: prefs }),
  getPushPublicKey: () => request('/notifications/push/public-key'),
  subscribePush: (subscription) =>
    request('/notifications/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: (endpoint) =>
    request('/notifications/push/unsubscribe', { method: 'POST', body: { endpoint } }),

  // --- analytics ---
  getAnalytics: () => request('/analytics'),
};

export { API_BASE, BASE };
