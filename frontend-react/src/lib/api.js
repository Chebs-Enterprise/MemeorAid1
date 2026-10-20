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
  if (res.status === 401 && auth && !path.startsWith('/auth/')) {
    tokenStore.clear();
    window.dispatchEvent(new Event('memoraid:unauthorized'));
    throw new ApiError('Your session has ended. Please sign in again.', 401, data);
  }
  if (!res.ok) {
    throw new ApiError(
      data.message || 'Something went wrong. Please try again.',
      res.status,
      data,
    );
  }
  return data;
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
  getNextExercise: () => request('/exercises/next'),
  completeExercise: (payload) => request('/exercises/complete', { method: 'POST', body: payload }),
  getExerciseHistory: () => request('/exercises/history'),

  // --- chat companion ---
  getChatHistory: () => request('/chat/history'),
  sendChatMessage: (message) => request('/chat', { method: 'POST', body: { message } }),

  // --- check-in / notifications ---
  getCheckin: () => request('/checkin'),
  completeCheckin: () => request('/checkin/complete', { method: 'POST' }),
  getNotifications: () => request('/notifications'),

  // --- analytics ---
  getAnalytics: () => request('/analytics'),
};

export { API_BASE, BASE };
