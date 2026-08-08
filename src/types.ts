export type UserRole = 'Administrador' | 'Usuário comum';

export interface User {
  id: number;
  nome: string;
  usuario: string;
  email?: string;
  permissao: UserRole;
  createdAt?: string;
}

export interface Cidade {
  id: number;
  nome: string;
  createdAt?: string;
}

export interface Bairro {
  id: number;
  cidadeId: number;
  cidadeNome?: string;
  nome: string;
  createdAt?: string;
}

export type QuadraStatus = 'Não feita' | 'Feita';

export interface Quadra {
  id: number;
  cidadeId: number;
  cidadeNome?: string;
  bairroId: number;
  bairroNome?: string;
  numero: string;
  status: QuadraStatus;
  concluidaEm?: string | null;
  usuarioId?: number | null;
  usuarioNome?: string | null;
  createdAt?: string;
}

export interface Cartao {
  id: number;
  titulo: string;
  descricao?: string;
  cidadeId?: number | null;
  cidadeNome?: string | null;
  bairroId?: number | null;
  bairroNome?: string | null;
  usuarioId: number | null;
  usuarioNome?: string | null;
  quadraIds: number[];
  quadras?: Quadra[];
  totalQuadras?: number;
  concluidasQuadras?: number;
  createdAt?: string;
}

export interface QuadraHistorico {
  id: number;
  quadraId: number;
  cidadeNome: string;
  bairroNome: string;
  numero: string;
  acao: 'Concluída' | 'Resetada' | 'Criada';
  usuarioNome: string;
  dataHora: string;
}

export interface AuditLog {
  id: number;
  usuarioId: number | null;
  usuarioNome: string;
  acao: string;
  detalhes: string;
  ip?: string;
  dataHora: string;
}

export interface DashboardStats {
  totalCidades: number;
  totalBairros: number;
  totalQuadras: number;
  quadrasConcluidas: number;
  quadrasPendentes: number;
  percentualConcluido: number;
  progressoPorCidade: Array<{
    cidade: string;
    total: number;
    concluidas: number;
    percentual: number;
  }>;
  progressoPorUsuario: Array<{
    usuario: string;
    totalConcluidas: number;
  }>;
  bairrosMaisAvançados: Array<{
    bairro: string;
    cidade: string;
    total: number;
    concluidas: number;
    percentual: number;
  }>;
}

export interface QuadraFilter {
  cidadeId?: string;
  bairroId?: string;
  status?: string;
  usuarioId?: string;
  numero?: string;
  search?: string;
}

export interface ReportData {
  geradoEm: string;
  totalQuadras: number;
  quadrasConcluidas: number;
  quadrasPendentes: number;
  percentualGeral: number;
  relatorioBairros: Array<{
    bairroId: number;
    bairroNome: string;
    cidadeNome: string;
    total: number;
    concluidas: number;
    pendentes: number;
    percentual: number;
  }>;
}
