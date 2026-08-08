import {
  User,
  Cidade,
  Bairro,
  Quadra,
  Cartao,
  QuadraHistorico,
  AuditLog,
  DashboardStats,
  ReportData,
} from '../types';

const TOKEN_KEY = 'quadras_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Ocorreu um erro na requisição.');
  }

  return data as T;
}

export const api = {
  // Auth
  login: async (usuario: string, senha: string) => {
    const res = await request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, senha }),
    });
    setStoredToken(res.token);
    return res;
  },

  register: async (data: {
    usuario: string;
    email: string;
    senha: string;
    confirmarSenha: string;
  }) => {
    const res = await request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setStoredToken(res.token);
    return res;
  },

  loginWithGoogle: async (googleData: { email: string; name?: string; googleId?: string }) => {
    const res = await request<{ token: string; user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(googleData),
    });
    setStoredToken(res.token);
    return res;
  },

  logout: async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    } finally {
      clearStoredToken();
    }
  },

  getMe: async () => {
    return request<User>('/api/auth/me');
  },

  recoverPassword: async (usuario: string) => {
    return request<{ message: string }>('/api/auth/recover-password', {
      method: 'POST',
      body: JSON.stringify({ usuario }),
    });
  },

  // Users (Admin)
  getUsers: async () => request<User[]>('/api/users'),
  createUser: async (user: Omit<User, 'id'> & { senha: string }) =>
    request<User>('/api/users', { method: 'POST', body: JSON.stringify(user) }),
  updateUser: async (id: number, user: Partial<User> & { senha?: string }) =>
    request<User>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(user) }),
  deleteUser: async (id: number) =>
    request<{ message: string }>(`/api/users/${id}`, { method: 'DELETE' }),

  // Cidades
  getCidades: async () => request<Cidade[]>('/api/cidades'),
  createCidade: async (nome: string) =>
    request<Cidade>('/api/cidades', {
      method: 'POST',
      body: JSON.stringify({ nome }),
    }),
  updateCidade: async (id: number, nome: string) =>
    request<Cidade>(`/api/cidades/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome }),
    }),
  deleteCidade: async (id: number) =>
    request<{ message: string }>(`/api/cidades/${id}`, { method: 'DELETE' }),

  // Bairros
  getBairros: async (cidadeId?: string) => {
    const query = cidadeId ? `?cidadeId=${cidadeId}` : '';
    return request<Bairro[]>(`/api/bairros${query}`);
  },
  createBairro: async (cidadeId: number, nome: string) =>
    request<Bairro>('/api/bairros', {
      method: 'POST',
      body: JSON.stringify({ cidadeId, nome }),
    }),
  updateBairro: async (id: number, data: { nome?: string; cidadeId?: number }) =>
    request<Bairro>(`/api/bairros/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteBairro: async (id: number) =>
    request<{ message: string }>(`/api/bairros/${id}`, { method: 'DELETE' }),
  resetBairro: async (id: number) =>
    request<{ message: string; countReset: number }>(`/api/bairros/${id}/reset`, {
      method: 'POST',
    }),

  // Quadras
  getQuadras: async (filters?: {
    cidadeId?: string;
    bairroId?: string;
    status?: string;
    usuarioId?: string;
    numero?: string;
    search?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.cidadeId) params.append('cidadeId', filters.cidadeId);
    if (filters?.bairroId) params.append('bairroId', filters.bairroId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.usuarioId) params.append('usuarioId', filters.usuarioId);
    if (filters?.numero) params.append('numero', filters.numero);
    if (filters?.search) params.append('search', filters.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Quadra[]>(`/api/quadras${query}`);
  },
  createQuadra: async (cidadeId: number, bairroId: number, numero: string) =>
    request<Quadra>('/api/quadras', {
      method: 'POST',
      body: JSON.stringify({ cidadeId, bairroId, numero }),
    }),
  createQuadrasBulk: async (
    cidadeId: number,
    bairroId: number,
    inicio: number,
    fim: number
  ) =>
    request<{ message: string; count: number }>('/api/quadras/bulk', {
      method: 'POST',
      body: JSON.stringify({ cidadeId, bairroId, inicio, fim }),
    }),
  updateQuadra: async (id: number, numero: string) =>
    request<Quadra>(`/api/quadras/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ numero }),
    }),
  deleteQuadra: async (id: number) =>
    request<{ message: string }>(`/api/quadras/${id}`, { method: 'DELETE' }),
  toggleQuadra: async (id: number) =>
    request<Quadra>(`/api/quadras/${id}/toggle`, { method: 'PATCH' }),
  getQuadraHistorico: async (id: number) =>
    request<QuadraHistorico[]>(`/api/quadras/${id}/historico`),

  // Cartões
  getCartoes: async () => request<Cartao[]>('/api/cartoes'),
  getCartao: async (id: number) => request<Cartao>(`/api/cartoes/${id}`),
  createCartao: async (data: {
    titulo: string;
    descricao?: string;
    cidadeId?: number | null;
    bairroId?: number | null;
    usuarioId?: number | null;
    quadraIds: number[];
  }) =>
    request<Cartao>('/api/cartoes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCartao: async (
    id: number,
    data: {
      titulo?: string;
      descricao?: string;
      cidadeId?: number | null;
      bairroId?: number | null;
      usuarioId?: number | null;
      quadraIds?: number[];
    }
  ) =>
    request<Cartao>(`/api/cartoes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteCartao: async (id: number) =>
    request<{ message: string }>(`/api/cartoes/${id}`, { method: 'DELETE' }),
  createQuadrasParaCartao: async (
    cartaoId: number,
    data: { numero?: string; inicio?: number; fim?: number; numeros?: string[] }
  ) =>
    request<{ cartao: Cartao; countCriadas: number }>(`/api/cartoes/${cartaoId}/quadras`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleCartaoQuadra: async (cartaoId: number, quadraId: number) =>
    request<Quadra>(`/api/cartoes/${cartaoId}/quadras/${quadraId}/toggle`, {
      method: 'PATCH',
    }),

  // Dashboard & Reports & Audit
  getDashboardStats: async () => request<DashboardStats>('/api/dashboard/stats'),
  getRelatorios: async () => request<ReportData>('/api/relatorios'),
  getAuditoria: async (search?: string) => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<AuditLog[]>(`/api/auditoria${query}`);
  },
};
