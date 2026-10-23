export interface UserProfile {
  id: string;
  email: string;
  name?: string | null;
  role: 'admin' | 'user';
  isActive?: boolean;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
}

export interface ModelUsage {
  modelName: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  responseTokens?: number;
  costUsd: number;
  turns: number;
  percentage: number;
}

export interface WorkspaceUsage {
  workspaceName: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  turns: number;
  percentage?: number;
}

export interface DailyUsagePoint {
  date: string;
  totalTokens: number;
  costUsd: number;
  turns: number;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  workspaceName: string;
  primaryModel: string;
  turns: number;
  totalTokens: number;
  costUsd: number;
  lastActiveAt?: string;
}

export interface TelemetrySummaryResponse {
  ok: boolean;
  totalTokens: number;
  estimatedCostUsd: number;
  totals: {
    totalTokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    responseTokens: number;
    costUsd: number;
    turns: number;
  };
  models: ModelUsage[];
  workspaces: WorkspaceUsage[];
  daily: DailyUsagePoint[];
  recentConversations: ConversationSummary[];
}

export interface RegistryItem {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  latestVersion?: string;
  downloadsCount?: number;
  tags?: string[];
  skills?: string[];
  sidecars?: string[];
  hasRules?: boolean;
  hasMcp?: boolean;
  hasScripts?: boolean;
  publisher?: string;
  author?: string | {
    email: string;
    name?: string;
  };
}

export interface RegistryCatalogResponse {
  version: string;
  timestamp: string;
  plugins: RegistryItem[];
  skills: RegistryItem[];
}

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('agy_token') || sessionStorage.getItem('agy_token');
  }

  setToken(token: string, remember: boolean = true) {
    if (remember) {
      localStorage.setItem('agy_token', token);
    } else {
      sessionStorage.setItem('agy_token', token);
    }
  }

  clearToken() {
    localStorage.removeItem('agy_token');
    sessionStorage.removeItem('agy_token');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    const token = this.getToken();

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
    });

    if (response.status === 401 && !endpoint.includes('/api/auth/login')) {
      this.clearToken();
      window.dispatchEvent(new Event('agy_unauthorized'));
    }

    const contentType = response.headers.get('content-type') || '';
    let data: any = null;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMsg = data?.error || data?.message || `Request failed with status ${response.status}`;
      throw new Error(errorMsg);
    }

    return data as T;
  }

  // Auth
  async login(email: string, password: string): Promise<{ token: string; user: UserProfile }> {
    const res = await this.request<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(res.token, true);
    return res;
  }

  async getMe(): Promise<{ user: UserProfile }> {
    const res = await this.request<any>('/api/auth/me');
    return { user: res?.user || res };
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clearToken();
    }
  }

  // Telemetry
  async getTelemetrySummary(params: Record<string, string> = {}): Promise<TelemetrySummaryResponse> {
    const query = new URLSearchParams(params).toString();
    const endpoint = `/api/telemetry/summary${query ? `?${query}` : ''}`;
    return this.request<TelemetrySummaryResponse>(endpoint);
  }

  // Users (Admin only)
  async getUsers(): Promise<{ users: UserProfile[] }> {
    const res = await this.request<any>('/api/users');
    const users = Array.isArray(res) ? res : Array.isArray(res?.users) ? res.users : [];
    return { users };
  }

  async createUser(payload: { email: string; password: string; role?: 'admin' | 'user'; name?: string }): Promise<{ user: UserProfile }> {
    const res = await this.request<any>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { user: res?.user || res };
  }

  async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<{ user: UserProfile }> {
    const res = await this.request<any>(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    return { user: res?.user || res };
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/api/users/${userId}`, { method: 'DELETE' });
  }

  // API Keys
  async getApiKeys(): Promise<{ apiKeys: ApiKeyItem[] }> {
    const res = await this.request<any>('/api/api-keys');
    const apiKeys = Array.isArray(res) ? res : Array.isArray(res?.apiKeys) ? res.apiKeys : [];
    return { apiKeys };
  }

  async createApiKey(name: string): Promise<{ apiKey: ApiKeyItem & { key: string; secretKey: string } }> {
    const res = await this.request<any>('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const raw = res?.apiKey || res || {};
    const secret = raw?.key || raw?.secretKey || res?.key || '';
    return {
      apiKey: {
        ...raw,
        key: secret,
        secretKey: secret,
      },
    };
  }

  async deleteApiKey(keyId: string): Promise<void> {
    await this.request(`/api/api-keys/${keyId}`, { method: 'DELETE' });
  }

  // Registry
  async getRegistryCatalog(): Promise<RegistryCatalogResponse> {
    return this.request<RegistryCatalogResponse>('/api/registry.json');
  }

  async publishPlugin(formData: FormData): Promise<any> {
    return this.request('/api/plugins/publish', {
      method: 'POST',
      body: formData,
    });
  }

  async publishSkill(formData: FormData): Promise<any> {
    return this.request('/api/skills/publish', {
      method: 'POST',
      body: formData,
    });
  }
}

export const api = new ApiClient();
