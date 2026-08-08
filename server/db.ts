import bcrypt from 'bcryptjs';
import { supabaseServer, isSupabaseServerConfigured } from './supabaseServer.js';

export interface UserDB {
  id: number;
  nome: string;
  usuario: string;
  email?: string;
  senhaHash: string;
  permissao: 'Administrador' | 'Dirigente' | 'Usuário comum';
  createdAt: string;
}

export interface CidadeDB {
  id: number;
  nome: string;
  createdAt: string;
}

export interface BairroDB {
  id: number;
  cidadeId: number;
  nome: string;
  createdAt: string;
}

export interface QuadraDB {
  id: number;
  cidadeId: number;
  bairroId: number;
  numero: string;
  status: 'Não feita' | 'Feita';
  concluidaEm: string | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  createdAt: string;
}

export interface CartaoDesignacaoDB {
  id: number;
  dirigenteNome: string;
  dataDesignacao: string;
  dataConclusao?: string | null;
}

export interface CartaoDB {
  id: number;
  titulo: string;
  descricao?: string;
  cidadeId?: number | null;
  bairroId?: number | null;
  usuarioId: number | null;
  usuarioNome?: string | null;
  quadraIds: number[];
  createdAt: string;
  ultimaDataConcluida?: string | null;
  designacoes?: CartaoDesignacaoDB[];
}

export interface HistoricoDB {
  id: number;
  quadraId: number;
  cidadeNome: string;
  bairroNome: string;
  numero: string;
  acao: 'Concluída' | 'Resetada' | 'Criada';
  usuarioNome: string;
  dataHora: string;
}

export interface AuditLogDB {
  id: number;
  usuarioId: number | null;
  usuarioNome: string;
  acao: string;
  detalhes: string;
  ip: string;
  dataHora: string;
}

export interface SchemaDB {
  users: UserDB[];
  cidades: CidadeDB[];
  bairros: BairroDB[];
  quadras: QuadraDB[];
  cartoes: CartaoDB[];
  historico: HistoricoDB[];
  auditLogs: AuditLogDB[];
  counters: {
    userId: number;
    cidadeId: number;
    bairroId: number;
    quadraId: number;
    cartaoId: number;
    historicoId: number;
    auditLogId: number;
  };
}

let dbData: SchemaDB | null = null;

export function getDB(): SchemaDB {
  if (dbData) return dbData;
  dbData = seedDefaultDB();
  return dbData;
}

export function saveDB() {
  // In-memory update. No disk/data/db.json writing!
}

function seedDefaultDB(): SchemaDB {
  const salt = bcrypt.genSaltSync(10);
  const adminHash = bcrypt.hashSync('admin123', salt);
  const userHash = bcrypt.hashSync('user123', salt);

  const now = new Date().toISOString();

  const users: UserDB[] = [
    {
      id: 1,
      nome: 'Administrador do Sistema',
      usuario: 'admin',
      email: 'admin@quadras.com',
      senhaHash: adminHash,
      permissao: 'Administrador',
      createdAt: now,
    },
    {
      id: 2,
      nome: 'Carlos Silva',
      usuario: 'carlos',
      email: 'carlos@quadras.com',
      senhaHash: userHash,
      permissao: 'Dirigente',
      createdAt: now,
    },
    {
      id: 3,
      nome: 'Ana Santos',
      usuario: 'ana',
      email: 'ana@quadras.com',
      senhaHash: userHash,
      permissao: 'Dirigente',
      createdAt: now,
    },
    {
      id: 4,
      nome: 'Marcos Oliveira',
      usuario: 'marcos',
      senhaHash: userHash,
      permissao: 'Dirigente',
      createdAt: now,
    },
  ];

  const cidades: CidadeDB[] = [];
  const bairros: BairroDB[] = [];
  const quadras: QuadraDB[] = [];
  const cartoes: CartaoDB[] = [];
  const historico: HistoricoDB[] = [];

  const auditLogs: AuditLogDB[] = [
    {
      id: 1,
      usuarioId: 1,
      usuarioNome: 'Administrador do Sistema',
      acao: 'Inicialização do Sistema',
      detalhes: 'Base de dados inicializada para primeiro acesso.',
      ip: '127.0.0.1',
      dataHora: now,
    },
  ];

  return {
    users,
    cidades,
    bairros,
    quadras,
    cartoes,
    historico,
    auditLogs,
    counters: {
      userId: 5,
      cidadeId: 1,
      bairroId: 1,
      quadraId: 1,
      cartaoId: 1,
      historicoId: 1,
      auditLogId: 2,
    },
  };
}

export function addAuditLog(
  usuarioId: number | null,
  usuarioNome: string,
  acao: string,
  detalhes: string,
  ip = '127.0.0.1'
) {
  const db = getDB();
  const id = db.counters.auditLogId++;
  const log: AuditLogDB = {
    id,
    usuarioId,
    usuarioNome,
    acao,
    detalhes,
    ip,
    dataHora: new Date().toISOString(),
  };
  db.auditLogs.unshift(log);

  // If Supabase is configured, record audit log asynchronously in Supabase as well
  if (isSupabaseServerConfigured && supabaseServer) {
    supabaseServer
      .from('audit_logs')
      .insert({
        usuario_id: usuarioId,
        usuario_nome: usuarioNome,
        acao,
        detalhes,
        ip,
        data_hora: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('Error inserting audit log into Supabase:', error.message);
      });
  }
}
