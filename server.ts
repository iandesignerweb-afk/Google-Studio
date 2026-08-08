import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  getDB,
  saveDB,
  addAuditLog,
  UserDB,
  CidadeDB,
  BairroDB,
  QuadraDB,
  CartaoDB,
  HistoricoDB,
} from './server/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'quadras-secret-key-2026-safe-auth';

interface AuthRequest extends Request {
  user?: {
    id: number;
    usuario: string;
    nome: string;
    permissao: 'Administrador' | 'Dirigente' | 'Usuário comum';
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize DB
  getDB();

  // Helper middleware for JWT Authentication
  const authenticateToken = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Acesso não autorizado. Faça login.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res
          .status(403)
          .json({ error: 'Sessão expirada ou inválida. Entre novamente.' });
      }
      req.user = decoded as AuthRequest['user'];
      next();
    });
  };

  const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.permissao !== 'Administrador') {
      return res
        .status(403)
        .json({ error: 'Acesso restrito para administradores.' });
    }
    next();
  };

  // -------------------------------------------------------------
  // AUTH ROUTES
  // -------------------------------------------------------------
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { usuario, email, senha, confirmarSenha } = req.body;

    if (!usuario || !email || !senha || !confirmarSenha) {
      return res.status(400).json({ error: 'Por favor, preencha todos os campos obrigatórios.' });
    }

    const cleanUsuario = String(usuario).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanSenha = String(senha).trim();
    const cleanConfirmar = String(confirmarSenha).trim();

    if (cleanSenha !== cleanConfirmar) {
      return res.status(400).json({ error: 'A senha e a confirmação de senha não coincidem.' });
    }

    if (cleanSenha.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
    }

    const db = getDB();

    // Check if user or email already exists
    const userExists = db.users.some(
      (u) => u.usuario.toLowerCase() === cleanUsuario.toLowerCase()
    );
    if (userExists) {
      return res.status(400).json({ error: 'Este nome de usuário já está cadastrado no sistema.' });
    }

    const emailExists = db.users.some(
      (u) => u.email && u.email.toLowerCase() === cleanEmail
    );
    if (emailExists) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado no sistema.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const senhaHash = bcrypt.hashSync(cleanSenha, salt);

    const id = db.counters.userId++;
    const isFirstUser = db.users.length === 0;
    const newUser: UserDB = {
      id,
      nome: cleanUsuario,
      usuario: cleanUsuario,
      email: cleanEmail,
      senhaHash,
      permissao: isFirstUser ? 'Administrador' : 'Dirigente',
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    saveDB();

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    addAuditLog(
      newUser.id,
      newUser.nome,
      'Cadastro de Usuário',
      `Novo usuário registrado com e-mail: ${cleanEmail}`,
      String(clientIp)
    );

    const tokenPayload = {
      id: newUser.id,
      usuario: newUser.usuario,
      email: newUser.email,
      nome: newUser.nome,
      permissao: newUser.permissao,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    return res.status(201).json({
      token,
      user: {
        id: newUser.id,
        nome: newUser.nome,
        usuario: newUser.usuario,
        email: newUser.email,
        permissao: newUser.permissao,
      },
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res
        .status(400)
        .json({ error: 'Informe usuário/e-mail e senha para continuar.' });
    }

    const db = getDB();
    const inputClean = String(usuario).trim().toLowerCase();
    
    // Search by username or email
    const user = db.users.find(
      (u) =>
        u.usuario.toLowerCase() === inputClean ||
        (u.email && u.email.toLowerCase() === inputClean)
    );

    if (!user) {
      return res
        .status(401)
        .json({ error: 'Usuário/E-mail ou senha incorretos.' });
    }

    const passwordMatch = bcrypt.compareSync(String(senha), user.senhaHash);
    if (!passwordMatch) {
      return res
        .status(401)
        .json({ error: 'Usuário/E-mail ou senha incorretos.' });
    }

    const tokenPayload = {
      id: user.id,
      usuario: user.usuario,
      email: user.email,
      nome: user.nome,
      permissao: user.permissao,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    addAuditLog(
      user.id,
      user.nome,
      'Login',
      `Login realizado com sucesso.`,
      String(clientIp)
    );

    return res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        email: user.email,
        permissao: user.permissao,
      },
    });
  });

  app.post('/api/auth/google', (req: Request, res: Response) => {
    const { email, name, googleId } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-mail do Google é obrigatório.' });
    }

    const db = getDB();
    const cleanEmail = String(email).trim().toLowerCase();
    
    let user = db.users.find(
      (u) =>
        (u.email && u.email.toLowerCase() === cleanEmail) ||
        u.usuario.toLowerCase() === cleanEmail.split('@')[0].toLowerCase()
    );

    if (!user) {
      // Auto register google user
      const baseUser = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-0]/g, '') || 'googleuser';
      let uniqueUser = baseUser;
      let count = 1;
      while (db.users.some(u => u.usuario.toLowerCase() === uniqueUser.toLowerCase())) {
        uniqueUser = `${baseUser}${count++}`;
      }

      const salt = bcrypt.genSaltSync(10);
      const dummyHash = bcrypt.hashSync(googleId || 'google-oauth-pass-2026', salt);

      const id = db.counters.userId++;
      const isFirstUser = db.users.length === 0;
      user = {
        id,
        nome: name || cleanEmail.split('@')[0],
        usuario: uniqueUser,
        email: cleanEmail,
        senhaHash: dummyHash,
        permissao: isFirstUser ? 'Administrador' : 'Dirigente',
        createdAt: new Date().toISOString(),
      };

      db.users.push(user);
      saveDB();

      addAuditLog(
        user.id,
        user.nome,
        'Cadastro via Google',
        `Nova conta vinculada ao Google: ${cleanEmail}`
      );
    } else if (!user.email) {
      user.email = cleanEmail;
      saveDB();
    }

    const tokenPayload = {
      id: user.id,
      usuario: user.usuario,
      email: user.email,
      nome: user.nome,
      permissao: user.permissao,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    addAuditLog(
      user.id,
      user.nome,
      'Login Google',
      `Login via conta do Google (${cleanEmail}).`,
      String(clientIp)
    );

    return res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        email: user.email,
        permissao: user.permissao,
      },
    });
  });

  app.post(
    '/api/auth/logout',
    authenticateToken,
    (req: AuthRequest, res: Response) => {
      if (req.user) {
        addAuditLog(
          req.user.id,
          req.user.nome,
          'Logout',
          'Sessão encerrada pelo usuário.'
        );
      }
      return res.json({ message: 'Logout realizado com sucesso.' });
    }
  );

  app.get(
    '/api/auth/me',
    authenticateToken,
    (req: AuthRequest, res: Response) => {
      const db = getDB();
      const user = db.users.find((u) => u.id === req.user?.id);
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      return res.json({
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        permissao: user.permissao,
      });
    }
  );

  app.post('/api/auth/recover-password', (req: Request, res: Response) => {
    const { usuario } = req.body;
    if (!usuario) {
      return res.status(400).json({ error: 'Informe o nome de usuário.' });
    }
    const db = getDB();
    const user = db.users.find(
      (u) => u.usuario.toLowerCase() === String(usuario).trim().toLowerCase()
    );
    if (!user) {
      return res
        .status(404)
        .json({ error: 'Usuário não localizado no sistema.' });
    }
    addAuditLog(
      user.id,
      user.nome,
      'Recuperação de Senha',
      'Solicitação de redefinição de senha gerada.'
    );
    return res.json({
      message:
        'Solicitação registrada! Por favor, entre em contato com o Administrador do sistema para redefinir sua senha.',
    });
  });

  // -------------------------------------------------------------
  // USERS MANAGEMENT (Admin Only)
  // -------------------------------------------------------------
  app.get(
    '/api/users',
    authenticateToken,
    requireAdmin,
    (req: Request, res: Response) => {
      const db = getDB();
      const safeUsers = db.users.map((u) => ({
        id: u.id,
        nome: u.nome,
        usuario: u.usuario,
        permissao: u.permissao,
        createdAt: u.createdAt,
      }));
      return res.json(safeUsers);
    }
  );

  app.post(
    '/api/users',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const { nome, usuario, senha, permissao } = req.body;

      if (!nome || !usuario || !senha || !permissao) {
        return res
          .status(400)
          .json({ error: 'Todos os campos são obrigatórios.' });
      }

      const db = getDB();
      const cleanUser = String(usuario).trim().toLowerCase();
      if (db.users.some((u) => u.usuario.toLowerCase() === cleanUser)) {
        return res
          .status(400)
          .json({ error: 'Este nome de usuário já está em uso.' });
      }

      const salt = bcrypt.genSaltSync(10);
      const senhaHash = bcrypt.hashSync(String(senha), salt);

      const id = db.counters.userId++;
      const newUser: UserDB = {
        id,
        nome: String(nome).trim(),
        usuario: String(usuario).trim(),
        senhaHash,
        permissao: permissao === 'Administrador' ? 'Administrador' : 'Dirigente',
        createdAt: new Date().toISOString(),
      };

      db.users.push(newUser);
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Cadastro Usuário',
        `Cadastrou o usuário "${newUser.nome}" (${newUser.usuario}) como ${newUser.permissao}.`
      );

      return res.status(201).json({
        id: newUser.id,
        nome: newUser.nome,
        usuario: newUser.usuario,
        permissao: newUser.permissao,
        createdAt: newUser.createdAt,
      });
    }
  );

  app.put(
    '/api/users/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const userId = Number(req.params.id);
      const { nome, usuario, senha, permissao } = req.body;

      const db = getDB();
      const user = db.users.find((u) => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      if (usuario) {
        const cleanUser = String(usuario).trim().toLowerCase();
        if (
          db.users.some(
            (u) => u.id !== userId && u.usuario.toLowerCase() === cleanUser
          )
        ) {
          return res
            .status(400)
            .json({ error: 'O nome de usuário informado já pertence a outro usuário.' });
        }
        user.usuario = String(usuario).trim();
      }

      if (nome) user.nome = String(nome).trim();
      if (permissao) {
        user.permissao =
          permissao === 'Administrador' ? 'Administrador' : 'Dirigente';
      }

      if (senha && String(senha).trim().length > 0) {
        const salt = bcrypt.genSaltSync(10);
        user.senhaHash = bcrypt.hashSync(String(senha), salt);
      }

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Edição Usuário',
        `Atualizou os dados do usuário ID ${userId} (${user.usuario}).`
      );

      return res.json({
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        permissao: user.permissao,
        createdAt: user.createdAt,
      });
    }
  );

  app.delete(
    '/api/users/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const userId = Number(req.params.id);
      if (userId === req.user!.id) {
        return res
          .status(400)
          .json({ error: 'Não é possível excluir o próprio usuário logado.' });
      }

      const db = getDB();
      const idx = db.users.findIndex((u) => u.id === userId);
      if (idx === -1) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      const deleted = db.users.splice(idx, 1)[0];
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Exclusão Usuário',
        `Excluiu o usuário "${deleted.nome}" (${deleted.usuario}).`
      );

      return res.json({ message: 'Usuário removido com sucesso.' });
    }
  );

  // -------------------------------------------------------------
  // CIDADES (CITIES)
  // -------------------------------------------------------------
  app.get('/api/cidades', authenticateToken, (req: Request, res: Response) => {
    const db = getDB();
    return res.json(db.cidades);
  });

  app.post(
    '/api/cidades',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const { nome } = req.body;
      if (!nome || String(nome).trim().length === 0) {
        return res
          .status(400)
          .json({ error: 'Informe o nome da cidade.' });
      }

      const db = getDB();
      const cleanNome = String(nome).trim();

      if (db.cidades && db.cidades.length >= 1) {
        return res
          .status(400)
          .json({ error: 'O sistema permite o cadastro de apenas 1 cidade. Altere o nome da cidade existente se necessário.' });
      }

      if (
        db.cidades.some(
          (c) => c.nome.toLowerCase() === cleanNome.toLowerCase()
        )
      ) {
        return res
          .status(400)
          .json({ error: 'Esta cidade já está cadastrada.' });
      }

      const newCity: CidadeDB = {
        id: db.counters.cidadeId++,
        nome: cleanNome,
        createdAt: new Date().toISOString(),
      };

      db.cidades.push(newCity);
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Cadastro Cidade',
        `Cadastrou a cidade "${cleanNome}".`
      );

      return res.status(201).json(newCity);
    }
  );

  app.put(
    '/api/cidades/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const { nome } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome obrigatório.' });

      const db = getDB();
      const city = db.cidades.find((c) => c.id === id);
      if (!city) {
        return res.status(404).json({ error: 'Cidade não encontrada.' });
      }

      city.nome = String(nome).trim();
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Edição Cidade',
        `Alterou o nome da cidade ID ${id} para "${city.nome}".`
      );

      return res.json(city);
    }
  );

  app.delete(
    '/api/cidades/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const db = getDB();
      const idx = db.cidades.findIndex((c) => c.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Cidade não encontrada.' });
      }

      const deleted = db.cidades.splice(idx, 1)[0];

      // Cascade remove bairros and quadras
      const bairrosToRemove = db.bairros.filter((b) => b.cidadeId === id);
      const bairroIds = bairrosToRemove.map((b) => b.id);

      db.bairros = db.bairros.filter((b) => b.cidadeId !== id);
      db.quadras = db.quadras.filter(
        (q) => q.cidadeId !== id && !bairroIds.includes(q.bairroId)
      );

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Exclusão Cidade',
        `Excluiu a cidade "${deleted.nome}" e seus respectivos bairros e quadras.`
      );

      return res.json({ message: 'Cidade removida com sucesso.' });
    }
  );

  // -------------------------------------------------------------
  // BAIRROS (NEIGHBORHOODS)
  // -------------------------------------------------------------
  app.get('/api/bairros', authenticateToken, (req: Request, res: Response) => {
    const db = getDB();
    const { cidadeId } = req.query;

    let result = db.bairros.map((b) => {
      const cid = db.cidades.find((c) => c.id === b.cidadeId);
      return {
        ...b,
        cidadeNome: cid ? cid.nome : 'Desconhecida',
      };
    });

    if (cidadeId) {
      result = result.filter((b) => b.cidadeId === Number(cidadeId));
    }

    return res.json(result);
  });

  app.post(
    '/api/bairros',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const { cidadeId, nome } = req.body;
      if (!cidadeId || !nome || String(nome).trim().length === 0) {
        return res
          .status(400)
          .json({ error: 'Cidade e nome do bairro são obrigatórios.' });
      }

      const db = getDB();
      const cid = db.cidades.find((c) => c.id === Number(cidadeId));
      if (!cid) {
        return res.status(404).json({ error: 'Cidade não encontrada.' });
      }

      const cleanNome = String(nome).trim();
      if (
        db.bairros.some(
          (b) =>
            b.cidadeId === Number(cidadeId) &&
            b.nome.toLowerCase() === cleanNome.toLowerCase()
        )
      ) {
        return res
          .status(400)
          .json({ error: 'Este bairro já está cadastrado nesta cidade.' });
      }

      const newBairro: BairroDB = {
        id: db.counters.bairroId++,
        cidadeId: Number(cidadeId),
        nome: cleanNome,
        createdAt: new Date().toISOString(),
      };

      db.bairros.push(newBairro);
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Cadastro Bairro',
        `Cadastrou o bairro "${cleanNome}" na cidade "${cid.nome}".`
      );

      return res.status(201).json({
        ...newBairro,
        cidadeNome: cid.nome,
      });
    }
  );

  app.put(
    '/api/bairros/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const { nome, cidadeId } = req.body;

      const db = getDB();
      const bairro = db.bairros.find((b) => b.id === id);
      if (!bairro) {
        return res.status(404).json({ error: 'Bairro não encontrado.' });
      }

      if (nome) bairro.nome = String(nome).trim();
      if (cidadeId) bairro.cidadeId = Number(cidadeId);

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Edição Bairro',
        `Atualizou informações do bairro ID ${id} (${bairro.nome}).`
      );

      return res.json(bairro);
    }
  );

  app.delete(
    '/api/bairros/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const db = getDB();
      const idx = db.bairros.findIndex((b) => b.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Bairro não encontrado.' });
      }

      const deleted = db.bairros.splice(idx, 1)[0];
      db.quadras = db.quadras.filter((q) => q.bairroId !== id);

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Exclusão Bairro',
        `Excluiu o bairro "${deleted.nome}" e suas respectivas quadras.`
      );

      return res.json({ message: 'Bairro removido com sucesso.' });
    }
  );

  // RESET BAIRRO
  app.post(
    '/api/bairros/:id/reset',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const bairroId = Number(req.params.id);
      const db = getDB();
      const bairro = db.bairros.find((b) => b.id === bairroId);
      if (!bairro) {
        return res.status(404).json({ error: 'Bairro não encontrado.' });
      }

      const cidade = db.cidades.find((c) => c.id === bairro.cidadeId);
      const cidadeNome = cidade ? cidade.nome : 'Desconhecida';

      const quadrasDoBairro = db.quadras.filter((q) => q.bairroId === bairroId);
      let countReset = 0;

      const nowStr = new Date().toISOString();

      quadrasDoBairro.forEach((q) => {
        if (q.status === 'Feita') {
          q.status = 'Não feita';
          q.concluidaEm = null;
          q.usuarioId = null;
          q.usuarioNome = null;
          countReset++;

          // Record in history
          db.historico.unshift({
            id: db.counters.historicoId++,
            quadraId: q.id,
            cidadeNome,
            bairroNome: bairro.nome,
            numero: q.numero,
            acao: 'Resetada',
            usuarioNome: req.user!.nome,
            dataHora: nowStr,
          });
        }
      });

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Reset de Bairro',
        `Resetou o andamento de ${countReset} quadras do bairro "${bairro.nome}" (${cidadeNome}).`
      );

      return res.json({
        message: `Bairro "${bairro.nome}" resetado com sucesso. ${countReset} quadra(s) voltaram para "Não feita".`,
        countReset,
      });
    }
  );

  // -------------------------------------------------------------
  // QUADRAS (BLOCKS)
  // -------------------------------------------------------------
  app.get('/api/quadras', authenticateToken, (req: Request, res: Response) => {
    const db = getDB();
    const { cidadeId, bairroId, status, usuarioId, numero, search } = req.query;

    let result = db.quadras.map((q) => {
      const cid = db.cidades.find((c) => c.id === q.cidadeId);
      const bai = db.bairros.find((b) => b.id === q.bairroId);
      return {
        ...q,
        cidadeNome: cid ? cid.nome : 'Desconhecida',
        bairroNome: bai ? bai.nome : 'Desconhecido',
      };
    });

    if (cidadeId) {
      result = result.filter((q) => q.cidadeId === Number(cidadeId));
    }
    if (bairroId) {
      result = result.filter((q) => q.bairroId === Number(bairroId));
    }
    if (status && status !== 'Todos') {
      result = result.filter((q) => q.status === status);
    }
    if (usuarioId) {
      result = result.filter((q) => q.usuarioId === Number(usuarioId));
    }
    if (numero) {
      result = result.filter((q) =>
        q.numero.toLowerCase().includes(String(numero).toLowerCase())
      );
    }
    if (search && String(search).trim().length > 0) {
      const term = String(search).trim().toLowerCase();
      result = result.filter(
        (q) =>
          q.numero.toLowerCase().includes(term) ||
          q.cidadeNome.toLowerCase().includes(term) ||
          q.bairroNome.toLowerCase().includes(term) ||
          (q.usuarioNome && q.usuarioNome.toLowerCase().includes(term))
      );
    }

    // Sort by integer value of number if available
    result.sort((a, b) => {
      const numA = parseInt(a.numero, 10);
      const numB = parseInt(b.numero, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.numero.localeCompare(b.numero);
    });

    return res.json(result);
  });

  app.post(
    '/api/quadras',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const { cidadeId, bairroId, numero } = req.body;
      if (!cidadeId || !bairroId || !numero) {
        return res
          .status(400)
          .json({ error: 'Cidade, Bairro e Número da quadra são obrigatórios.' });
      }

      const db = getDB();
      const cid = db.cidades.find((c) => c.id === Number(cidadeId));
      const bai = db.bairros.find((b) => b.id === Number(bairroId));

      if (!cid || !bai) {
        return res
          .status(404)
          .json({ error: 'Cidade ou Bairro não localizados.' });
      }

      const cleanNum = String(numero).trim().padStart(2, '0');

      if (
        db.quadras.some(
          (q) =>
            q.bairroId === Number(bairroId) &&
            q.numero.toLowerCase() === cleanNum.toLowerCase()
        )
      ) {
        return res
          .status(400)
          .json({ error: `A quadra ${cleanNum} já existe neste bairro.` });
      }

      const newQuadra: QuadraDB = {
        id: db.counters.quadraId++,
        cidadeId: Number(cidadeId),
        bairroId: Number(bairroId),
        numero: cleanNum,
        status: 'Não feita',
        concluidaEm: null,
        usuarioId: null,
        usuarioNome: null,
        createdAt: new Date().toISOString(),
      };

      db.quadras.push(newQuadra);
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Cadastro Quadra',
        `Cadastrou a Quadra ${cleanNum} no bairro "${bai.nome}" (${cid.nome}).`
      );

      return res.status(201).json({
        ...newQuadra,
        cidadeNome: cid.nome,
        bairroNome: bai.nome,
      });
    }
  );

  // BULK CREATE QUADRAS (e.g. Quadras 01 to 50 for a neighborhood)
  app.post(
    '/api/quadras/bulk',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const { cidadeId, bairroId, inicio, fim } = req.body;

      const start = Number(inicio);
      const end = Number(fim);

      if (!cidadeId || !bairroId || isNaN(start) || isNaN(end) || start > end) {
        return res
          .status(400)
          .json({ error: 'Valores inicial e final inválidos para geração em lote.' });
      }

      const db = getDB();
      const cid = db.cidades.find((c) => c.id === Number(cidadeId));
      const bai = db.bairros.find((b) => b.id === Number(bairroId));

      if (!cid || !bai) {
        return res
          .status(404)
          .json({ error: 'Cidade ou Bairro não encontrados.' });
      }

      let created = 0;
      for (let i = start; i <= end; i++) {
        const numStr = String(i).padStart(2, '0');
        const exists = db.quadras.some(
          (q) => q.bairroId === Number(bairroId) && q.numero === numStr
        );

        if (!exists) {
          db.quadras.push({
            id: db.counters.quadraId++,
            cidadeId: Number(cidadeId),
            bairroId: Number(bairroId),
            numero: numStr,
            status: 'Não feita',
            concluidaEm: null,
            usuarioId: null,
            usuarioNome: null,
            createdAt: new Date().toISOString(),
          });
          created++;
        }
      }

      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Cadastro Lote Quadras',
        `Gerou ${created} quadras (do ${start} ao ${end}) para o bairro "${bai.nome}".`
      );

      return res.json({
        message: `Sucesso! ${created} quadras foram criadas para o bairro ${bai.nome}.`,
        count: created,
      });
    }
  );

  app.put(
    '/api/quadras/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const { numero } = req.body;

      const db = getDB();
      const quadra = db.quadras.find((q) => q.id === id);
      if (!quadra) {
        return res.status(404).json({ error: 'Quadra não encontrada.' });
      }

      if (numero) quadra.numero = String(numero).trim().padStart(2, '0');
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Edição Quadra',
        `Atualizou número da quadra ID ${id} para ${quadra.numero}.`
      );

      return res.json(quadra);
    }
  );

  app.delete(
    '/api/quadras/:id',
    authenticateToken,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const db = getDB();
      const idx = db.quadras.findIndex((q) => q.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Quadra não encontrada.' });
      }

      const deleted = db.quadras.splice(idx, 1)[0];
      saveDB();

      addAuditLog(
        req.user!.id,
        req.user!.nome,
        'Exclusão Quadra',
        `Excluiu a Quadra ${deleted.numero} (ID ${id}).`
      );

      return res.json({ message: 'Quadra removida com sucesso.' });
    }
  );

  // -------------------------------------------------------------
  // CARTÕES (CARDS) MANAGEMENT
  // -------------------------------------------------------------
  app.get('/api/cartoes', authenticateToken, (req: AuthRequest, res: Response) => {
    const db = getDB();
    const user = req.user!;

    let cartoesList = db.cartoes || [];
    if (user.permissao !== 'Administrador') {
      cartoesList = cartoesList.filter((c) => c.usuarioId === user.id);
    }

    const enrichedCartoes = cartoesList.map((c) => {
      const quadras = db.quadras
        .filter((q) => c.quadraIds && c.quadraIds.includes(q.id))
        .map((q) => {
          const cid = db.cidades.find((city) => city.id === q.cidadeId);
          const bai = db.bairros.find((b) => b.id === q.bairroId);
          return {
            ...q,
            cidadeNome: cid ? cid.nome : 'Desconhecida',
            bairroNome: bai ? bai.nome : 'Desconhecido',
          };
        });

      quadras.sort((a, b) => {
        const numA = parseInt(a.numero, 10);
        const numB = parseInt(b.numero, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.numero.localeCompare(b.numero);
      });

      const totalQuadras = quadras.length;
      const concluidasQuadras = quadras.filter((q) => q.status === 'Feita').length;

      const userObj = c.usuarioId ? db.users.find((u) => u.id === c.usuarioId) : null;
      const cidObj = c.cidadeId ? db.cidades.find((city) => city.id === c.cidadeId) : null;
      const baiObj = c.bairroId ? db.bairros.find((b) => b.id === c.bairroId) : null;

      const completedQuadras = quadras.filter((q) => q.status === 'Feita' && q.concluidaEm);
      let computedLastDate = c.ultimaDataConcluida || null;
      if (!computedLastDate && completedQuadras.length > 0) {
        const latestDateObj = completedQuadras.reduce((latest, q) => {
          const d = new Date(q.concluidaEm!);
          return d > latest ? d : latest;
        }, new Date(0));
        if (latestDateObj.getTime() > 0) {
          computedLastDate = latestDateObj.toLocaleDateString('pt-BR');
        }
      }

      let designacoesList = c.designacoes && Array.isArray(c.designacoes) ? [...c.designacoes] : [];
      if (designacoesList.length === 0 && userObj) {
        const isFullyDone = concluidasQuadras === totalQuadras && totalQuadras > 0;
        designacoesList = [
          {
            id: 1,
            dirigenteNome: userObj.nome,
            dataDesignacao: new Date(c.createdAt || Date.now()).toLocaleDateString('pt-BR'),
            dataConclusao: isFullyDone ? (computedLastDate || new Date().toLocaleDateString('pt-BR')) : null,
          },
        ];
      }

      return {
        ...c,
        usuarioNome: userObj ? userObj.nome : c.usuarioNome || 'Não atribuído',
        cidadeNome: cidObj ? cidObj.nome : null,
        bairroNome: baiObj ? baiObj.nome : null,
        quadras,
        totalQuadras,
        concluidasQuadras,
        ultimaDataConcluida: computedLastDate,
        designacoes: designacoesList,
      };
    });

    return res.json(enrichedCartoes);
  });

  app.get('/api/cartoes/:id', authenticateToken, (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    const db = getDB();
    const cartao = (db.cartoes || []).find((c) => c.id === id);

    if (!cartao) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    if (req.user!.permissao !== 'Administrador' && cartao.usuarioId !== req.user!.id) {
      return res.status(403).json({ error: 'Acesso negado a este cartão.' });
    }

    const quadras = db.quadras
      .filter((q) => cartao.quadraIds && cartao.quadraIds.includes(q.id))
      .map((q) => {
        const cid = db.cidades.find((city) => city.id === q.cidadeId);
        const bai = db.bairros.find((b) => b.id === q.bairroId);
        return {
          ...q,
          cidadeNome: cid ? cid.nome : 'Desconhecida',
          bairroNome: bai ? bai.nome : 'Desconhecido',
        };
      });

    quadras.sort((a, b) => {
      const numA = parseInt(a.numero, 10);
      const numB = parseInt(b.numero, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.numero.localeCompare(b.numero);
    });

    const userObj = cartao.usuarioId ? db.users.find((u) => u.id === cartao.usuarioId) : null;
    const cidObj = cartao.cidadeId ? db.cidades.find((city) => city.id === cartao.cidadeId) : null;
    const baiObj = cartao.bairroId ? db.bairros.find((b) => b.id === cartao.bairroId) : null;

    const totalQuadras = quadras.length;
    const concluidasQuadras = quadras.filter((q) => q.status === 'Feita').length;

    const completedQuadras = quadras.filter((q) => q.status === 'Feita' && q.concluidaEm);
    let computedLastDate = cartao.ultimaDataConcluida || null;
    if (!computedLastDate && completedQuadras.length > 0) {
      const latestDateObj = completedQuadras.reduce((latest, q) => {
        const d = new Date(q.concluidaEm!);
        return d > latest ? d : latest;
      }, new Date(0));
      if (latestDateObj.getTime() > 0) {
        computedLastDate = latestDateObj.toLocaleDateString('pt-BR');
      }
    }

    let designacoesList = cartao.designacoes && Array.isArray(cartao.designacoes) ? [...cartao.designacoes] : [];
    if (designacoesList.length === 0 && userObj) {
      const isFullyDone = concluidasQuadras === totalQuadras && totalQuadras > 0;
      designacoesList = [
        {
          id: 1,
          dirigenteNome: userObj.nome,
          dataDesignacao: new Date(cartao.createdAt || Date.now()).toLocaleDateString('pt-BR'),
          dataConclusao: isFullyDone ? (computedLastDate || new Date().toLocaleDateString('pt-BR')) : null,
        },
      ];
    }

    return res.json({
      ...cartao,
      usuarioNome: userObj ? userObj.nome : cartao.usuarioNome || 'Não atribuído',
      cidadeNome: cidObj ? cidObj.nome : null,
      bairroNome: baiObj ? baiObj.nome : null,
      quadras,
      totalQuadras,
      concluidasQuadras,
      ultimaDataConcluida: computedLastDate,
      designacoes: designacoesList,
    });
  });

  app.put('/api/cartoes/:id/designacoes', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    const { designacoes, ultimaDataConcluida } = req.body;
    const db = getDB();
    const cartao = (db.cartoes || []).find((c) => c.id === id);

    if (!cartao) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    if (Array.isArray(designacoes)) {
      cartao.designacoes = designacoes;
    }
    if (ultimaDataConcluida !== undefined) {
      cartao.ultimaDataConcluida = ultimaDataConcluida;
    }

    saveDB();

    addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição Designações Território',
      `Atualizou o registro de designações do Cartão "${cartao.titulo}".`
    );

    return res.json(cartao);
  });

  app.post('/api/cartoes', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
    const {
      titulo,
      descricao,
      cidadeId,
      cidadeNome,
      bairroId,
      bairroNome,
      usuarioId,
      quadraIds,
      quadrasIniciaisInicio,
      quadrasIniciaisFim,
    } = req.body;

    if (!titulo || String(titulo).trim().length === 0) {
      return res.status(400).json({ error: 'Nome do cartão é obrigatório.' });
    }

    const db = getDB();
    const cleanTitle = String(titulo).trim();

    // Resolve or Auto-create Cidade
    let resolvedCidadeId = cidadeId ? Number(cidadeId) : null;
    if (!resolvedCidadeId) {
      if (cidadeNome && String(cidadeNome).trim()) {
        const found = db.cidades.find((c) => c.nome.toLowerCase() === String(cidadeNome).trim().toLowerCase());
        if (found) {
          resolvedCidadeId = found.id;
        } else {
          const newCity: CidadeDB = {
            id: db.counters.cidadeId++,
            nome: String(cidadeNome).trim(),
            createdAt: new Date().toISOString(),
          };
          db.cidades.push(newCity);
          resolvedCidadeId = newCity.id;
        }
      } else if (db.cidades.length > 0) {
        resolvedCidadeId = db.cidades[0].id;
      }
    }

    // Resolve or Auto-create Bairro
    let resolvedBairroId = bairroId ? Number(bairroId) : null;
    if (!resolvedBairroId && bairroNome && String(bairroNome).trim()) {
      const cleanBairro = String(bairroNome).trim();
      const foundBairro = db.bairros.find(
        (b) =>
          (!resolvedCidadeId || b.cidadeId === resolvedCidadeId) &&
          b.nome.toLowerCase() === cleanBairro.toLowerCase()
      );

      if (foundBairro) {
        resolvedBairroId = foundBairro.id;
      } else if (resolvedCidadeId) {
        const newBairro: BairroDB = {
          id: db.counters.bairroId++,
          cidadeId: resolvedCidadeId,
          nome: cleanBairro,
          createdAt: new Date().toISOString(),
        };
        db.bairros.push(newBairro);
        resolvedBairroId = newBairro.id;
      }
    }

    const requestedQuadraIds = Array.isArray(quadraIds) ? quadraIds.map(Number) : [];

    // Optionally auto-create initial quadras for this card
    if (
      quadrasIniciaisInicio !== undefined &&
      quadrasIniciaisFim !== undefined &&
      resolvedCidadeId &&
      resolvedBairroId
    ) {
      const start = Number(quadrasIniciaisInicio);
      const end = Number(quadrasIniciaisFim);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          const numStr = String(i).padStart(2, '0');
          const newQuadra: QuadraDB = {
            id: db.counters.quadraId++,
            cidadeId: resolvedCidadeId,
            bairroId: resolvedBairroId,
            numero: numStr,
            status: 'Não feita',
            concluidaEm: null,
            usuarioId: null,
            usuarioNome: null,
            createdAt: new Date().toISOString(),
          };
          db.quadras.push(newQuadra);
          requestedQuadraIds.push(newQuadra.id);
        }
      }
    }

    // Exclusivity validation: Ensure no quadra is already linked to another cartão
    const takenQuadraIds = (db.cartoes || []).flatMap((c) => c.quadraIds || []);
    const conflictId = requestedQuadraIds.find((qId) => takenQuadraIds.includes(qId));
    if (conflictId !== undefined) {
      const conflictQuadra = (db.quadras || []).find((q) => q.id === conflictId);
      const quadraLabel = conflictQuadra ? `Quadra ${conflictQuadra.numero}` : `Quadra ID ${conflictId}`;
      return res.status(400).json({
        error: `A ${quadraLabel} já está vinculada a outro cartão e não pode ser reutilizada.`
      });
    }

    let assignedUser = null;
    if (usuarioId) {
      assignedUser = db.users.find((u) => u.id === Number(usuarioId));
    }

    const newCartao: CartaoDB = {
      id: db.counters.cartaoId++,
      titulo: cleanTitle,
      descricao: descricao ? String(descricao).trim() : '',
      cidadeId: resolvedCidadeId,
      bairroId: resolvedBairroId,
      usuarioId: assignedUser ? assignedUser.id : null,
      usuarioNome: assignedUser ? assignedUser.nome : null,
      quadraIds: requestedQuadraIds,
      createdAt: new Date().toISOString(),
    };

    if (!db.cartoes) db.cartoes = [];
    db.cartoes.push(newCartao);
    saveDB();

    addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Cadastro Cartão',
      `Criou o cartão "${cleanTitle}" com ${newCartao.quadraIds.length} quadras vinculadas${
        assignedUser ? ` para o usuário ${assignedUser.nome}` : ''
      }.`
    );

    return res.status(201).json(newCartao);
  });

  app.post('/api/cartoes/:id/quadras', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
    const cartaoId = Number(req.params.id);
    const { numero, inicio, fim, numeros } = req.body;
    const db = getDB();

    const cartao = (db.cartoes || []).find((c) => c.id === cartaoId);
    if (!cartao) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    // Ensure Cidade exists
    let cityId = cartao.cidadeId;
    if (!cityId) {
      if (db.cidades.length === 0) {
        const defaultCity: CidadeDB = {
          id: db.counters.cidadeId++,
          nome: 'Cidade Principal',
          createdAt: new Date().toISOString(),
        };
        db.cidades.push(defaultCity);
        cityId = defaultCity.id;
      } else {
        cityId = db.cidades[0].id;
      }
      cartao.cidadeId = cityId;
    }

    // Ensure Bairro exists
    let bairroId = cartao.bairroId;
    if (!bairroId) {
      const defaultBairro: BairroDB = {
        id: db.counters.bairroId++,
        cidadeId: cityId,
        nome: 'Geral',
        createdAt: new Date().toISOString(),
      };
      db.bairros.push(defaultBairro);
      bairroId = defaultBairro.id;
      cartao.bairroId = bairroId;
    }

    const quadrasCriadas: number[] = [];

    if (inicio !== undefined && fim !== undefined) {
      const start = Number(inicio);
      const end = Number(fim);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          const numStr = String(i).padStart(2, '0');
          const newQuadra: QuadraDB = {
            id: db.counters.quadraId++,
            cidadeId: cityId,
            bairroId: bairroId,
            numero: numStr,
            status: 'Não feita',
            concluidaEm: null,
            usuarioId: null,
            usuarioNome: null,
            createdAt: new Date().toISOString(),
          };
          db.quadras.push(newQuadra);
          quadrasCriadas.push(newQuadra.id);
        }
      }
    } else if (Array.isArray(numeros)) {
      for (const n of numeros) {
        const numStr = String(n).trim().padStart(2, '0');
        const newQuadra: QuadraDB = {
          id: db.counters.quadraId++,
          cidadeId: cityId,
          bairroId: bairroId,
          numero: numStr,
          status: 'Não feita',
          concluidaEm: null,
          usuarioId: null,
          usuarioNome: null,
          createdAt: new Date().toISOString(),
        };
        db.quadras.push(newQuadra);
        quadrasCriadas.push(newQuadra.id);
      }
    } else if (numero) {
      const numStr = String(numero).trim().padStart(2, '0');
      const newQuadra: QuadraDB = {
        id: db.counters.quadraId++,
        cidadeId: cityId,
        bairroId: bairroId,
        numero: numStr,
        status: 'Não feita',
        concluidaEm: null,
        usuarioId: null,
        usuarioNome: null,
        createdAt: new Date().toISOString(),
      };
      db.quadras.push(newQuadra);
      quadrasCriadas.push(newQuadra.id);
    }

    cartao.quadraIds = Array.from(new Set([...(cartao.quadraIds || []), ...quadrasCriadas]));
    saveDB();

    addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação de Quadras no Cartão',
      `Criou e vinculou ${quadrasCriadas.length} nova(s) quadra(s) ao Cartão "${cartao.titulo}".`
    );

    return res.json({
      cartao,
      countCriadas: quadrasCriadas.length,
    });
  });

  app.put('/api/cartoes/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    const { titulo, descricao, cidadeId, bairroId, usuarioId, quadraIds } = req.body;

    const db = getDB();
    const cartao = (db.cartoes || []).find((c) => c.id === id);

    if (!cartao) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    if (Array.isArray(quadraIds)) {
      const requestedQuadraIds = quadraIds.map(Number);

      // Exclusivity validation: Check if any requested quadra belongs to another cartão (excluding current cartão)
      const takenQuadraIds = (db.cartoes || [])
        .filter((c) => c.id !== id)
        .flatMap((c) => c.quadraIds || []);

      const conflictId = requestedQuadraIds.find((qId) => takenQuadraIds.includes(qId));
      if (conflictId !== undefined) {
        const conflictQuadra = (db.quadras || []).find((q) => q.id === conflictId);
        const quadraLabel = conflictQuadra ? `Quadra ${conflictQuadra.numero}` : `Quadra ID ${conflictId}`;
        return res.status(400).json({
          error: `A ${quadraLabel} já está vinculada a outro cartão e não pode ser reutilizada.`
        });
      }

      cartao.quadraIds = requestedQuadraIds;
    }

    if (titulo) cartao.titulo = String(titulo).trim();
    if (descricao !== undefined) cartao.descricao = String(descricao).trim();
    if (cidadeId !== undefined) cartao.cidadeId = cidadeId ? Number(cidadeId) : null;
    if (bairroId !== undefined) cartao.bairroId = bairroId ? Number(bairroId) : null;

    if (usuarioId !== undefined) {
      if (usuarioId) {
        const u = db.users.find((usr) => usr.id === Number(usuarioId));
        cartao.usuarioId = u ? u.id : null;
        cartao.usuarioNome = u ? u.nome : null;
      } else {
        cartao.usuarioId = null;
        cartao.usuarioNome = null;
      }
    }

    saveDB();

    addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição Cartão',
      `Atualizou o cartão "${cartao.titulo}" (ID ${id}).`
    );

    return res.json(cartao);
  });

  app.delete('/api/cartoes/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    const db = getDB();
    if (!db.cartoes) db.cartoes = [];
    const idx = db.cartoes.findIndex((c) => c.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    const deleted = db.cartoes.splice(idx, 1)[0];
    saveDB();

    addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão Cartão',
      `Excluiu o cartão "${deleted.titulo}" (ID ${id}).`
    );

    return res.json({ message: 'Cartão removido com sucesso.' });
  });

  app.patch(
    '/api/cartoes/:id/quadras/:quadraId/toggle',
    authenticateToken,
    (req: AuthRequest, res: Response) => {
      const cartaoId = Number(req.params.id);
      const quadraId = Number(req.params.quadraId);
      const db = getDB();

      const cartao = (db.cartoes || []).find((c) => c.id === cartaoId);
      if (!cartao) {
        return res.status(404).json({ error: 'Cartão não encontrado.' });
      }

      const user = req.user!;
      if (user.permissao !== 'Administrador' && cartao.usuarioId !== user.id) {
        return res.status(403).json({ error: 'Acesso negado a este cartão.' });
      }

      if (!cartao.quadraIds.includes(quadraId)) {
        return res.status(400).json({ error: 'Quadra não pertence a este cartão.' });
      }

      const quadra = db.quadras.find((q) => q.id === quadraId);
      if (!quadra) {
        return res.status(404).json({ error: 'Quadra não encontrada.' });
      }

      const cid = db.cidades.find((c) => c.id === quadra.cidadeId);
      const bai = db.bairros.find((b) => b.id === quadra.bairroId);
      const cidadeNome = cid ? cid.nome : 'Desconhecida';
      const bairroNome = bai ? bai.nome : 'Desconhecido';

      const nowStr = new Date().toISOString();

      if (quadra.status === 'Não feita') {
        quadra.status = 'Feita';
        quadra.concluidaEm = nowStr;
        quadra.usuarioId = user.id;
        quadra.usuarioNome = user.nome;

        db.historico.unshift({
          id: db.counters.historicoId++,
          quadraId: quadra.id,
          cidadeNome,
          bairroNome,
          numero: quadra.numero,
          acao: 'Concluída',
          usuarioNome: user.nome,
          dataHora: nowStr,
        });

        addAuditLog(
          user.id,
          user.nome,
          'Marcação via Cartão',
          `Marcou como FEITA a Quadra ${quadra.numero} (${bairroNome}) no Cartão "${cartao.titulo}".`
        );
      } else {
        quadra.status = 'Não feita';
        quadra.concluidaEm = null;
        quadra.usuarioId = null;
        quadra.usuarioNome = null;

        addAuditLog(
          user.id,
          user.nome,
          'Alteração via Cartão',
          `Desmarcou a Quadra ${quadra.numero} (${bairroNome}) no Cartão "${cartao.titulo}".`
        );
      }

      saveDB();

      return res.json({
        ...quadra,
        cidadeNome,
        bairroNome,
      });
    }
  );

  // TOGGLE STATUS (MARK DONE OR UNMARK)
  app.patch(
    '/api/quadras/:id/toggle',
    authenticateToken,
    (req: AuthRequest, res: Response) => {
      const id = Number(req.params.id);
      const db = getDB();
      const quadra = db.quadras.find((q) => q.id === id);

      if (!quadra) {
        return res.status(404).json({ error: 'Quadra não encontrada.' });
      }

      const cid = db.cidades.find((c) => c.id === quadra.cidadeId);
      const bai = db.bairros.find((b) => b.id === quadra.bairroId);
      const cidadeNome = cid ? cid.nome : 'Desconhecida';
      const bairroNome = bai ? bai.nome : 'Desconhecido';

      const user = req.user!;

      // If quadra is already 'Feita' and current user is common user, they CANNOT uncheck or modify it!
      if (quadra.status === 'Feita' && user.permissao !== 'Administrador') {
        return res.status(403).json({
          error:
            'Apenas administradores podem alterar o status de quadras já concluídas.',
        });
      }

      const nowStr = new Date().toISOString();

      if (quadra.status === 'Não feita') {
        // Mark as Feita
        quadra.status = 'Feita';
        quadra.concluidaEm = nowStr;
        quadra.usuarioId = user.id;
        quadra.usuarioNome = user.nome;

        db.historico.unshift({
          id: db.counters.historicoId++,
          quadraId: quadra.id,
          cidadeNome,
          bairroNome,
          numero: quadra.numero,
          acao: 'Concluída',
          usuarioNome: user.nome,
          dataHora: nowStr,
        });

        addAuditLog(
          user.id,
          user.nome,
          'Marcação de Quadra',
          `Marcou como CONCLUÍDA a Quadra ${quadra.numero} no bairro "${bairroNome}" (${cidadeNome}).`
        );
      } else {
        // Toggle back to Não Feita (Admin only passed earlier constraint)
        quadra.status = 'Não feita';
        quadra.concluidaEm = null;
        quadra.usuarioId = null;
        quadra.usuarioNome = null;

        addAuditLog(
          user.id,
          user.nome,
          'Alteração de Quadra',
          `Desmarcou a Quadra ${quadra.numero} no bairro "${bairroNome}" para Pendente.`
        );
      }

      saveDB();

      return res.json({
        ...quadra,
        cidadeNome,
        bairroNome,
      });
    }
  );

  // GET QUADRA HISTORY
  app.get(
    '/api/quadras/:id/historico',
    authenticateToken,
    (req: Request, res: Response) => {
      const id = Number(req.params.id);
      const db = getDB();
      const logs = db.historico.filter((h) => h.quadraId === id);
      return res.json(logs);
    }
  );

  // -------------------------------------------------------------
  // DASHBOARD STATS & REPORTS
  // -------------------------------------------------------------
  app.get(
    '/api/dashboard/stats',
    authenticateToken,
    (req: Request, res: Response) => {
      const db = getDB();

      const totalCidades = db.cidades.length;
      const totalBairros = db.bairros.length;
      const totalQuadras = db.quadras.length;

      const quadrasConcluidas = db.quadras.filter(
        (q) => q.status === 'Feita'
      ).length;
      const quadrasPendentes = totalQuadras - quadrasConcluidas;
      const percentualConcluido =
        totalQuadras > 0
          ? Math.round((quadrasConcluidas / totalQuadras) * 100)
          : 0;

      // Progress by City
      const progressoPorCidade = db.cidades.map((c) => {
        const qCid = db.quadras.filter((q) => q.cidadeId === c.id);
        const done = qCid.filter((q) => q.status === 'Feita').length;
        const total = qCid.length;
        return {
          cidade: c.nome,
          total,
          concluidas: done,
          percentual: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      });

      // Progress by User
      const userMap: Record<string, number> = {};
      db.quadras.forEach((q) => {
        if (q.status === 'Feita' && q.usuarioNome) {
          userMap[q.usuarioNome] = (userMap[q.usuarioNome] || 0) + 1;
        }
      });

      const progressoPorUsuario = Object.entries(userMap).map(
        ([usuario, totalConcluidas]) => ({
          usuario,
          totalConcluidas,
        })
      );

      // Bairros mais avançados
      const bairrosList = db.bairros.map((b) => {
        const cid = db.cidades.find((c) => c.id === b.cidadeId);
        const qBai = db.quadras.filter((q) => q.bairroId === b.id);
        const done = qBai.filter((q) => q.status === 'Feita').length;
        const total = qBai.length;
        return {
          bairro: b.nome,
          cidade: cid ? cid.nome : 'Desconhecida',
          total,
          concluidas: done,
          percentual: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      });

      bairrosList.sort((a, b) => b.percentual - a.percentual);

      return res.json({
        totalCidades,
        totalBairros,
        totalQuadras,
        quadrasConcluidas,
        quadrasPendentes,
        percentualConcluido,
        progressoPorCidade,
        progressoPorUsuario,
        bairrosMaisAvançados: bairrosList.slice(0, 5),
      });
    }
  );

  app.get(
    '/api/relatorios',
    authenticateToken,
    (req: Request, res: Response) => {
      const db = getDB();

      const totalQuadras = db.quadras.length;
      const quadrasConcluidas = db.quadras.filter(
        (q) => q.status === 'Feita'
      ).length;
      const quadrasPendentes = totalQuadras - quadrasConcluidas;
      const percentualConcluido =
        totalQuadras > 0
          ? Math.round((quadrasConcluidas / totalQuadras) * 100)
          : 0;

      // User stats breakdown
      const userStats = db.users.map((u) => {
        const qDone = db.quadras.filter(
          (q) => q.status === 'Feita' && q.usuarioId === u.id
        ).length;
        return {
          usuarioId: u.id,
          nome: u.nome,
          usuario: u.usuario,
          permissao: u.permissao,
          quadrasFeitas: qDone,
        };
      });

      // Cidade mais avançada
      let cidadeMaisAvançada = 'Nenhuma';
      let maxCidadePerc = -1;
      db.cidades.forEach((c) => {
        const qCid = db.quadras.filter((q) => q.cidadeId === c.id);
        const done = qCid.filter((q) => q.status === 'Feita').length;
        const perc = qCid.length > 0 ? (done / qCid.length) * 100 : 0;
        if (perc > maxCidadePerc) {
          maxCidadePerc = perc;
          cidadeMaisAvançada = `${c.nome} (${Math.round(perc)}%)`;
        }
      });

      // Bairro mais avançado
      let bairroMaisAvançado = 'Nenhum';
      let maxBairroPerc = -1;
      db.bairros.forEach((b) => {
        const cid = db.cidades.find((c) => c.id === b.cidadeId);
        const qBai = db.quadras.filter((q) => q.bairroId === b.id);
        const done = qBai.filter((q) => q.status === 'Feita').length;
        const perc = qBai.length > 0 ? (done / qBai.length) * 100 : 0;
        if (perc > maxBairroPerc) {
          maxBairroPerc = perc;
          bairroMaisAvançado = `${b.nome} - ${cid ? cid.nome : ''} (${Math.round(
            perc
          )}%)`;
        }
      });

      return res.json({
        totalQuadras,
        quadrasConcluidas,
        quadrasPendentes,
        percentualConcluido,
        userStats,
        cidadeMaisAvançada,
        bairroMaisAvançado,
        tempoMedioEstimado: 'Aproximadamente 4.5 horas por bairro',
      });
    }
  );

  app.get(
    '/api/auditoria',
    authenticateToken,
    requireAdmin,
    (req: Request, res: Response) => {
      const db = getDB();
      const { search } = req.query;

      let logs = [...db.auditLogs];
      if (search && String(search).trim().length > 0) {
        const term = String(search).trim().toLowerCase();
        logs = logs.filter(
          (l) =>
            l.usuarioNome.toLowerCase().includes(term) ||
            l.acao.toLowerCase().includes(term) ||
            l.detalhes.toLowerCase().includes(term)
        );
      }

      return res.json(logs);
    }
  );

  // -------------------------------------------------------------
  // VITE & STATIC FILE SERVING
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
