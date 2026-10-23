// test/helpers/api-client.mjs
// HTTP Client abstraction for E2E testing against Antigravity Cloud Hub API.

import { TARGET_URL, REQUEST_TIMEOUT_MS } from './test-env.mjs';

export class ApiClient {
  constructor(baseUrl = TARGET_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.jwtToken = null;
    this.apiKey = null;
    this.cookies = new Map();
  }

  setToken(token) {
    this.jwtToken = token;
    return this;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    return this;
  }

  clearAuth() {
    this.jwtToken = null;
    this.apiKey = null;
    this.cookies.clear();
    return this;
  }

  _parseSetCookie(cookieHeader) {
    if (!cookieHeader) return;
    const parts = cookieHeader.split(';')[0].trim().split('=');
    if (parts.length >= 2) {
      this.cookies.set(parts[0], parts.slice(1).join('='));
    }
  }

  _buildCookieHeader() {
    if (this.cookies.size === 0) return undefined;
    const items = [];
    for (const [k, v] of this.cookies.entries()) {
      items.push(`${k}=${v}`);
    }
    return items.join('; ');
  }

  async request(path, options = {}) {
    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    const headers = new Headers(options.headers || {});

    if (this.jwtToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.jwtToken}`);
    } else if (this.apiKey && !headers.has('X-API-Key') && !headers.has('Authorization')) {
      headers.set('X-API-Key', this.apiKey);
    }

    const cookieHeader = this._buildCookieHeader();
    if (cookieHeader && !headers.has('Cookie')) {
      headers.set('Cookie', cookieHeader);
    }

    let body = options.body;
    if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof FormData) && !(body instanceof Blob)) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body,
        signal: controller.signal,
        redirect: options.redirect || 'follow',
      });

      // Capture set-cookie
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        this._parseSetCookie(setCookieHeader);
      }

      const contentType = response.headers.get('content-type') || '';
      let data = null;
      let rawText = '';
      let buffer = null;

      if (contentType.includes('application/json')) {
        rawText = await response.text();
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          data = null;
        }
      } else if (contentType.includes('gzip') || contentType.includes('octet-stream') || options.asBuffer) {
        const arrayBuf = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } else {
        rawText = await response.text();
        data = rawText;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: response.headers,
        data,
        rawText,
        buffer,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${options.timeoutMs || REQUEST_TIMEOUT_MS}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  async post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  }

  async patch(path, body, options = {}) {
    return this.request(path, { ...options, method: 'PATCH', body });
  }

  async delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }

  async login(email, password) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.ok && res.data) {
      if (res.data.token) {
        this.setToken(res.data.token);
      } else if (res.data.data?.token) {
        this.setToken(res.data.data.token);
      }
    }
    return res;
  }
}

export function createApiClient(baseUrl = TARGET_URL) {
  return new ApiClient(baseUrl);
}
