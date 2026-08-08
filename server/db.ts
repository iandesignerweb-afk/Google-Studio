import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export interface UserDB {
  id: number;
  nome: string;
  usuario: string;
  email?: string;
  senhaHash: string;
  permissao: 'Administrador' | 'Usuário comum';
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

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      dbData = JSON.parse(content);

      // Ensure backward compatibility for cartoes
      if (!dbData!.cartoes) {
        dbData!.cartoes = [];
      }
      if (!dbData!.counters.cartaoId) {
        dbData!.counters.cartaoId = 1;
      }

      return dbData!;
    } catch (e) {
      console.error('Erro ao ler banco de dados, recriando inicial...', e);
    }
  }

  // Seed default data
  dbData = seedDefaultDB();
  saveDB();
  return dbData!;
}

export function saveDB() {
  if (!dbData) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');
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
      permissao: 'Usuário comum',
      createdAt: now,
    },
    {
      id: 3,
      nome: 'Ana Santos',
      usuario: 'ana',
      email: 'ana@quadras.com',
      senhaHash: userHash,
      permissao: 'Usuário comum',
      createdAt: now,
    },
    {
      id: 4,
      nome: 'Marcos Oliveira',
      usuario: 'marcos',
      senhaHash: userHash,
      permissao: 'Usuário comum',
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
  db.auditLogs.unshift(log); // newest first
  saveDB();
}
