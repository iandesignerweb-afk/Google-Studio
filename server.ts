import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { supabaseServer, isSupabaseServerConfigured } from './server/supabaseServer.js';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    usuario: string;
    nome: string;
    email?: string;
    permissao: 'Administrador' | 'Dirigente' | 'Usuário comum';
    sbUser?: any;
  };
}

export const app = express();
app.use(express.json());

// -------------------------------------------------------------
// HELPER: AUDIT LOG WRITER
// -------------------------------------------------------------
async function addAuditLog(
  usuarioId: number | null,
  usuarioNome: string,
  acao: string,
  detalhes: string,
  ip: string = '127.0.0.1'
) {
  if (!supabaseServer) return;
  try {
    await supabaseServer.from('audit_logs').insert({
      usuario_id: usuarioId,
      usuario_nome: usuarioNome,
      acao,
      detalhes,
      ip,
      data_hora: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erro ao gravar log de auditoria no Supabase:', err);
  }
}

// -------------------------------------------------------------
// MIDDLEWARES DE AUTENTICAÇÃO E PERMISSÃO
// -------------------------------------------------------------
const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login.' });
  }

  if (!isSupabaseServerConfigured || !supabaseServer) {
    return res.status(500).json({ error: 'Servidor Supabase não configurado.' });
  }

  try {
    const { data: { user: sbUser }, error: sbError } = await supabaseServer.auth.getUser(token);

    if (sbError || !sbUser) {
      return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    }

    const email = sbUser.email ? sbUser.email.toLowerCase() : '';

    // Buscar perfil do usuário na tabela public.users
    let userProfile: any = null;
    if (email) {
      const { data: users } = await supabaseServer
        .from('users')
        .select('*')
        .eq('email', email);
      if (users && users.length > 0) {
        userProfile = users[0];
      }
    }

    // Se não encontrou por email, busca por usuario
    if (!userProfile) {
      const username = sbUser.user_metadata?.username || email.split('@')[0];
      const { data: usersByUsername } = await supabaseServer
        .from('users')
        .select('*')
        .ilike('usuario', username);
      if (usersByUsername && usersByUsername.length > 0) {
        userProfile = usersByUsername[0];
      }
    }

    // Auto-criação do perfil em public.users caso o usuário exista apenas no Supabase Auth
    if (!userProfile) {
      const { count } = await supabaseServer
        .from('users')
        .select('*', { count: 'exact', head: true });

      const isFirstUser = (count === 0);
      const userName = sbUser.user_metadata?.name || sbUser.user_metadata?.username || (email ? email.split('@')[0] : 'Usuário');
      const userUsername = sbUser.user_metadata?.username || (email ? email.split('@')[0] : `user_${Date.now()}`);

      const { data: created, error: createError } = await supabaseServer
        .from('users')
        .insert({
          nome: userName,
          usuario: userUsername,
          email: email || `${userUsername}@quadras.com`,
          permissao: isFirstUser ? 'Administrador' : 'Dirigente',
        })
        .select()
        .single();

      if (createError) {
        console.error('Erro ao criar perfil de usuário no Supabase:', createError);
        return res.status(500).json({ error: 'Erro ao registrar perfil de usuário.' });
      }

      userProfile = created;
    }

    req.user = {
      id: userProfile.id,
      usuario: userProfile.usuario,
      nome: userProfile.nome,
      email: userProfile.email,
      permissao: userProfile.permissao,
      sbUser,
    };

    return next();
  } catch (err: any) {
    console.error('Erro na autenticação:', err);
    return res.status(401).json({ error: 'Falha na verificação da sessão: ' + err.message });
  }
};

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.permissao !== 'Administrador') {
    return res.status(403).json({ error: 'Acesso restrito para administradores.' });
  }
  next();
};

// -------------------------------------------------------------
// ROTAS DE AUTENTICAÇÃO (SUPABASE AUTH)
// -------------------------------------------------------------

// Login com Supabase Auth
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ error: 'Informe usuário/e-mail e senha para continuar.' });
  }

  if (!isSupabaseServerConfigured || !supabaseServer) {
    return res.status(500).json({ error: 'Banco de dados Supabase não está configurado.' });
  }

  const inputClean = String(usuario).trim();
  const cleanSenha = String(senha).trim();

  try {
    let targetEmail = inputClean.toLowerCase();

    // Se o usuário digitou nome de usuário e não um e-mail com '@'
    if (!inputClean.includes('@')) {
      const { data: profile } = await supabaseServer
        .from('users')
        .select('email, usuario')
        .ilike('usuario', inputClean)
        .maybeSingle();

      if (profile && profile.email) {
        targetEmail = profile.email.toLowerCase();
      } else {
        targetEmail = `${inputClean.toLowerCase()}@quadras.com`;
      }
    }

    // Autentica via Supabase Auth
    const { data: authData, error: authError } = await supabaseServer.auth.signInWithPassword({
      email: targetEmail,
      password: cleanSenha,
    });

    if (authError || !authData.session) {
      return res.status(401).json({ error: 'Usuário/E-mail ou senha incorretos.' });
    }

    // Busca perfil do usuário
    const { data: users } = await supabaseServer
      .from('users')
      .select('*')
      .eq('email', targetEmail);

    let userProfile = users && users.length > 0 ? users[0] : null;

    if (!userProfile) {
      const { count } = await supabaseServer
        .from('users')
        .select('*', { count: 'exact', head: true });

      const isFirst = count === 0;
      const { data: newProfile } = await supabaseServer
        .from('users')
        .insert({
          nome: inputClean,
          usuario: inputClean,
          email: targetEmail,
          permissao: isFirst ? 'Administrador' : 'Dirigente',
        })
        .select()
        .single();

      userProfile = newProfile;
    }

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    await addAuditLog(
      userProfile?.id || null,
      userProfile?.nome || inputClean,
      'Login',
      'Login efetuado com sucesso via Supabase Auth.',
      String(clientIp)
    );

    return res.json({
      token: authData.session.access_token,
      user: {
        id: userProfile.id,
        nome: userProfile.nome,
        usuario: userProfile.usuario,
        email: userProfile.email,
        permissao: userProfile.permissao,
      },
    });
  } catch (err: any) {
    console.error('Erro no login:', err);
    return res.status(500).json({ error: 'Erro interno ao processar login: ' + err.message });
  }
});

// Cadastro de novos usuários via Supabase Auth
app.post('/api/auth/register', async (req: Request, res: Response) => {
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

  if (!isSupabaseServerConfigured || !supabaseServer) {
    return res.status(500).json({ error: 'Banco de dados Supabase não está configurado.' });
  }

  try {
    // Verifica se usuario ou email ja existe em public.users
    const { data: existing } = await supabaseServer
      .from('users')
      .select('id')
      .or(`usuario.ilike.${cleanUsuario},email.ilike.${cleanEmail}`);

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Este nome de usuário ou e-mail já está cadastrado.' });
    }

    // Cria conta no Supabase Auth
    const { data: authData, error: authError } = await supabaseServer.auth.admin.createUser({
      email: cleanEmail,
      password: cleanSenha,
      email_confirm: true,
      user_metadata: {
        username: cleanUsuario,
        name: cleanUsuario,
      },
    });

    if (authError) {
      return res.status(400).json({ error: 'Erro no Supabase Auth: ' + authError.message });
    }

    // Define permissao (se for o primeiro usuario, vira Administrador)
    const { count } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact', head: true });

    const isFirstUser = count === 0;
    const permissao = isFirstUser ? 'Administrador' : 'Dirigente';

    // Insere perfil no public.users
    const { data: newUser, error: dbError } = await supabaseServer
      .from('users')
      .insert({
        nome: cleanUsuario,
        usuario: cleanUsuario,
        email: cleanEmail,
        permissao,
      })
      .select()
      .single();

    if (dbError) {
      return res.status(500).json({ error: 'Erro ao criar perfil no banco: ' + dbError.message });
    }

    // Faz login para obter a sessão
    const { data: sessionData } = await supabaseServer.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanSenha,
    });

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    await addAuditLog(
      newUser.id,
      newUser.nome,
      'Cadastro de Usuário',
      `Novo usuário registrado com e-mail: ${cleanEmail}`,
      String(clientIp)
    );

    return res.status(201).json({
      token: sessionData?.session?.access_token || '',
      user: {
        id: newUser.id,
        nome: newUser.nome,
        usuario: newUser.usuario,
        email: newUser.email,
        permissao: newUser.permissao,
      },
    });
  } catch (err: any) {
    console.error('Erro no cadastro:', err);
    return res.status(500).json({ error: 'Erro ao registrar conta: ' + err.message });
  }
});

// Autenticação com Google
app.post('/api/auth/google', async (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'E-mail do Google é obrigatório.' });
  }

  if (!isSupabaseServerConfigured || !supabaseServer) {
    return res.status(500).json({ error: 'Banco de dados Supabase não está configurado.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    let { data: users } = await supabaseServer
      .from('users')
      .select('*')
      .eq('email', cleanEmail);

    let userProfile = users && users.length > 0 ? users[0] : null;

    if (!userProfile) {
      const { count } = await supabaseServer
        .from('users')
        .select('*', { count: 'exact', head: true });

      const isFirst = count === 0;
      const baseUsuario = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');

      const { data: newP, error: insertErr } = await supabaseServer
        .from('users')
        .insert({
          nome: name || cleanEmail.split('@')[0],
          usuario: baseUsuario || `user_${Date.now()}`,
          email: cleanEmail,
          permissao: isFirst ? 'Administrador' : 'Dirigente',
        })
        .select()
        .single();

      if (insertErr) {
        return res.status(500).json({ error: 'Erro ao criar perfil Google: ' + insertErr.message });
      }

      userProfile = newP;
    }

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    await addAuditLog(
      userProfile.id,
      userProfile.nome,
      'Login Google',
      `Login via conta do Google (${cleanEmail}).`,
      String(clientIp)
    );

    return res.json({
      token: 'google_session_authenticated',
      user: {
        id: userProfile.id,
        nome: userProfile.nome,
        usuario: userProfile.usuario,
        email: userProfile.email,
        permissao: userProfile.permissao,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro no login Google: ' + err.message });
  }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user) {
    await addAuditLog(req.user.id, req.user.nome, 'Logout', 'Sessão encerrada pelo usuário.');
  }
  return res.json({ message: 'Logout realizado com sucesso.' });
});

// Retorna o usuário logado
app.get('/api/auth/me', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  return res.json({
    id: req.user.id,
    nome: req.user.nome,
    usuario: req.user.usuario,
    email: req.user.email,
    permissao: req.user.permissao,
  });
});

// Recuperação de senha
app.post('/api/auth/recover-password', async (req: Request, res: Response) => {
  const { usuario } = req.body;
  if (!usuario) {
    return res.status(400).json({ error: 'Informe o nome de usuário ou e-mail.' });
  }

  if (!isSupabaseServerConfigured || !supabaseServer) {
    return res.status(500).json({ error: 'Servidor Supabase não configurado.' });
  }

  try {
    const inputClean = String(usuario).trim().toLowerCase();
    const { data: profile } = await supabaseServer
      .from('users')
      .select('*')
      .or(`usuario.ilike.${inputClean},email.ilike.${inputClean}`)
      .maybeSingle();

    if (profile && profile.email) {
      await supabaseServer.auth.resetPasswordForEmail(profile.email);
      await addAuditLog(
        profile.id,
        profile.nome,
        'Recuperação de Senha',
        'Solicitação de redefinição de senha enviada para ' + profile.email
      );
    }

    return res.json({
      message: 'Solicitação registrada! Verifique seu e-mail para as instruções ou entre em contato com o Administrador.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao solicitar recuperação: ' + err.message });
  }
});

// -------------------------------------------------------------
// GESTÃO DE USUÁRIOS (ADMINISTRADOR)
// -------------------------------------------------------------
app.get('/api/users', authenticateToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { data: users, error } = await supabaseServer!
      .from('users')
      .select('id, nome, usuario, email, permissao, created_at')
      .order('id', { ascending: true });

    if (error) throw error;

    const formatted = (users || []).map((u) => ({
      id: u.id,
      nome: u.nome,
      usuario: u.usuario,
      email: u.email,
      permissao: u.permissao,
      createdAt: u.created_at,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao listar usuários: ' + err.message });
  }
});

app.post('/api/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { nome, usuario, senha, permissao, email } = req.body;

  if (!nome || !usuario || !senha || !permissao) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  const cleanUser = String(usuario).trim();
  const cleanEmail = email ? String(email).trim().toLowerCase() : `${cleanUser.toLowerCase()}@quadras.com`;

  try {
    // Verifica duplicidade no banco
    const { data: existing } = await supabaseServer!
      .from('users')
      .select('id')
      .or(`usuario.ilike.${cleanUser},email.ilike.${cleanEmail}`);

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Este nome de usuário ou e-mail já está em uso.' });
    }

    // Cria no Supabase Auth
    const { error: authErr } = await supabaseServer!.auth.admin.createUser({
      email: cleanEmail,
      password: String(senha).trim(),
      email_confirm: true,
      user_metadata: { username: cleanUser, name: String(nome).trim() },
    });

    if (authErr) {
      return res.status(400).json({ error: 'Erro ao criar usuário no Supabase Auth: ' + authErr.message });
    }

    // Insere no public.users
    const { data: newUser, error: dbErr } = await supabaseServer!
      .from('users')
      .insert({
        nome: String(nome).trim(),
        usuario: cleanUser,
        email: cleanEmail,
        permissao: permissao === 'Administrador' ? 'Administrador' : 'Dirigente',
      })
      .select()
      .single();

    if (dbErr) throw dbErr;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Cadastro Usuário',
      `Cadastrou o usuário "${newUser.nome}" (${newUser.usuario}) como ${newUser.permissao}.`
    );

    return res.status(201).json({
      id: newUser.id,
      nome: newUser.nome,
      usuario: newUser.usuario,
      email: newUser.email,
      permissao: newUser.permissao,
      createdAt: newUser.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar usuário: ' + err.message });
  }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);
  const { nome, usuario, senha, permissao, email } = req.body;

  try {
    const { data: user } = await supabaseServer!
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const updates: any = {};
    if (nome) updates.nome = String(nome).trim();
    if (usuario) updates.usuario = String(usuario).trim();
    if (email) updates.email = String(email).trim().toLowerCase();
    if (permissao) updates.permissao = permissao;

    const { data: updated, error } = await supabaseServer!
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Se a senha foi alterada, atualiza no Supabase Auth
    if (senha && String(senha).trim().length >= 6) {
      const targetEmail = updated.email || user.email;
      const { data: authList } = await supabaseServer!.auth.admin.listUsers();
      const authUser = authList?.users.find((u: any) => u.email?.toLowerCase() === targetEmail?.toLowerCase());
      if (authUser) {
        await supabaseServer!.auth.admin.updateUserById(authUser.id, {
          password: String(senha).trim(),
        });
      }
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição de Usuário',
      `Atualizou dados do usuário "${updated.nome}".`
    );

    return res.json({
      id: updated.id,
      nome: updated.nome,
      usuario: updated.usuario,
      email: updated.email,
      permissao: updated.permissao,
      createdAt: updated.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar usuário: ' + err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const userId = Number(req.params.id);

  try {
    const { data: user } = await supabaseServer!
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Tenta remover do Supabase Auth se houver email
    if (user.email) {
      const { data: authList } = await supabaseServer!.auth.admin.listUsers();
      const authUser = authList?.users.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
      if (authUser) {
        await supabaseServer!.auth.admin.deleteUser(authUser.id);
      }
    }

    // Deleta de public.users
    const { error } = await supabaseServer!.from('users').delete().eq('id', userId);
    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão de Usuário',
      `Excluiu o usuário "${user.nome}" (${user.usuario}).`
    );

    return res.json({ message: 'Usuário removido com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao deletar usuário: ' + err.message });
  }
});

// -------------------------------------------------------------
// CIDADES
// -------------------------------------------------------------
app.get('/api/cidades', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer!
      .from('cidades')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;

    const formatted = (data || []).map((c) => ({
      id: c.id,
      nome: c.nome,
      createdAt: c.created_at,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao buscar cidades: ' + err.message });
  }
});

app.post('/api/cidades', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { nome } = req.body;
  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Informe o nome da cidade.' });
  }

  const cleanNome = String(nome).trim();

  try {
    const { data, error } = await supabaseServer!
      .from('cidades')
      .insert({ nome: cleanNome })
      .select()
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação de Cidade',
      `Cadastrou a cidade "${data.nome}".`
    );

    return res.status(201).json({
      id: data.id,
      nome: data.nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar cidade: ' + err.message });
  }
});

app.put('/api/cidades/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { nome } = req.body;

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Informe o nome da cidade.' });
  }

  try {
    const { data, error } = await supabaseServer!
      .from('cidades')
      .update({ nome: String(nome).trim() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição de Cidade',
      `Alterou o nome da cidade ID ${id} para "${data.nome}".`
    );

    return res.json({
      id: data.id,
      nome: data.nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar cidade: ' + err.message });
  }
});

app.delete('/api/cidades/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: cidade } = await supabaseServer!.from('cidades').select('nome').eq('id', id).maybeSingle();
    const { error } = await supabaseServer!.from('cidades').delete().eq('id', id);

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão de Cidade',
      `Removeu a cidade "${cidade?.nome || id}".`
    );

    return res.json({ message: 'Cidade removida com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao remover cidade: ' + err.message });
  }
});

// -------------------------------------------------------------
// BAIRROS
// -------------------------------------------------------------
app.get('/api/bairros', authenticateToken, async (req: Request, res: Response) => {
  const { cidadeId } = req.query;

  try {
    let query = supabaseServer!.from('bairros').select('*, cidades(nome)').order('nome', { ascending: true });

    if (cidadeId) {
      query = query.eq('cidade_id', Number(cidadeId));
    }

    const { data, error } = await query;
    if (error) throw error;

    const formatted = (data || []).map((b) => ({
      id: b.id,
      cidadeId: b.cidade_id,
      cidadeNome: b.cidades?.nome || 'Cidade',
      nome: b.nome,
      createdAt: b.created_at,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao buscar bairros: ' + err.message });
  }
});

app.post('/api/bairros', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { cidadeId, nome } = req.body;

  if (!cidadeId || !nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Cidade e nome do bairro são obrigatórios.' });
  }

  try {
    const { data, error } = await supabaseServer!
      .from('bairros')
      .insert({
        cidade_id: Number(cidadeId),
        nome: String(nome).trim(),
      })
      .select('*, cidades(nome)')
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação de Bairro',
      `Cadastrou o bairro "${data.nome}" na cidade "${data.cidades?.nome || cidadeId}".`
    );

    return res.status(201).json({
      id: data.id,
      cidadeId: data.cidade_id,
      cidadeNome: data.cidades?.nome,
      nome: data.nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar bairro: ' + err.message });
  }
});

app.put('/api/bairros/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { nome, cidadeId } = req.body;

  const updates: any = {};
  if (nome) updates.nome = String(nome).trim();
  if (cidadeId) updates.cidade_id = Number(cidadeId);

  try {
    const { data, error } = await supabaseServer!
      .from('bairros')
      .update(updates)
      .eq('id', id)
      .select('*, cidades(nome)')
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição de Bairro',
      `Atualizou o bairro "${data.nome}".`
    );

    return res.json({
      id: data.id,
      cidadeId: data.cidade_id,
      cidadeNome: data.cidades?.nome,
      nome: data.nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar bairro: ' + err.message });
  }
});

app.delete('/api/bairros/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: bairro } = await supabaseServer!.from('bairros').select('nome').eq('id', id).maybeSingle();
    const { error } = await supabaseServer!.from('bairros').delete().eq('id', id);

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão de Bairro',
      `Excluiu o bairro "${bairro?.nome || id}".`
    );

    return res.json({ message: 'Bairro removido com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao remover bairro: ' + err.message });
  }
});

app.post('/api/bairros/:id/reset', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const bairroId = Number(req.params.id);

  try {
    const { data: bairro } = await supabaseServer!
      .from('bairros')
      .select('nome, cidades(nome)')
      .eq('id', bairroId)
      .maybeSingle();

    if (!bairro) {
      return res.status(404).json({ error: 'Bairro não encontrado.' });
    }

    // Busca quadras 'Feita' deste bairro para registrar no historico
    const { data: doneQuadras } = await supabaseServer!
      .from('quadras')
      .select('*')
      .eq('bairro_id', bairroId)
      .eq('status', 'Feita');

    const countReset = doneQuadras ? doneQuadras.length : 0;

    // Atualiza quadras para 'Não feita'
    await supabaseServer!
      .from('quadras')
      .update({
        status: 'Não feita',
        concluida_em: null,
        usuario_id: null,
        usuario_nome: null,
      })
      .eq('bairro_id', bairroId);

    // Registra resets no histórico
    if (doneQuadras && doneQuadras.length > 0) {
      const historicoEntries = doneQuadras.map((q) => ({
        quadra_id: q.id,
        cidade_nome: (bairro.cidades as any)?.nome || 'Cidade',
        bairro_nome: bairro.nome,
        numero: q.numero,
        acao: 'Resetada' as const,
        usuario_nome: req.user!.nome,
        data_hora: new Date().toISOString(),
      }));

      await supabaseServer!.from('historico').insert(historicoEntries);
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Reset de Bairro',
      `Resetou ${countReset} quadra(s) no bairro "${bairro.nome}".`
    );

    return res.json({
      message: `Bairro "${bairro.nome}" resetado com sucesso.`,
      countReset,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao resetar bairro: ' + err.message });
  }
});

// -------------------------------------------------------------
// QUADRAS
// -------------------------------------------------------------
app.get('/api/quadras', authenticateToken, async (req: Request, res: Response) => {
  const { cidadeId, bairroId, status, usuarioId, numero, search } = req.query;

  try {
    let query = supabaseServer!
      .from('quadras')
      .select('*, cidades(nome), bairros(nome)')
      .order('id', { ascending: true });

    if (cidadeId) query = query.eq('cidade_id', Number(cidadeId));
    if (bairroId) query = query.eq('bairro_id', Number(bairroId));
    if (status) query = query.eq('status', String(status));
    if (usuarioId) query = query.eq('usuario_id', Number(usuarioId));
    if (numero) query = query.ilike('numero', `%${String(numero)}%`);

    const { data, error } = await query;
    if (error) throw error;

    let formatted = (data || []).map((q) => ({
      id: q.id,
      cidadeId: q.cidade_id,
      cidadeNome: q.cidades?.nome || '',
      bairroId: q.bairro_id,
      bairroNome: q.bairros?.nome || '',
      numero: q.numero,
      status: q.status,
      concluidaEm: q.concluida_em,
      usuarioId: q.usuario_id,
      usuarioNome: q.usuario_nome,
      createdAt: q.created_at,
    }));

    if (search && String(search).trim()) {
      const term = String(search).trim().toLowerCase();
      formatted = formatted.filter(
        (q) =>
          q.numero.toLowerCase().includes(term) ||
          q.bairroNome.toLowerCase().includes(term) ||
          q.cidadeNome.toLowerCase().includes(term) ||
          (q.usuarioNome && q.usuarioNome.toLowerCase().includes(term))
      );
    }

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao listar quadras: ' + err.message });
  }
});

app.post('/api/quadras', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { cidadeId, bairroId, numero } = req.body;

  if (!cidadeId || !bairroId || !numero || !String(numero).trim()) {
    return res.status(400).json({ error: 'Cidade, Bairro e Número da quadra são obrigatórios.' });
  }

  try {
    const { data, error } = await supabaseServer!
      .from('quadras')
      .insert({
        cidade_id: Number(cidadeId),
        bairro_id: Number(bairroId),
        numero: String(numero).trim(),
        status: 'Não feita',
      })
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação de Quadra',
      `Criou a quadra ${data.numero} no bairro "${data.bairros?.nome || bairroId}".`
    );

    return res.status(201).json({
      id: data.id,
      cidadeId: data.cidade_id,
      cidadeNome: data.cidades?.nome,
      bairroId: data.bairro_id,
      bairroNome: data.bairros?.nome,
      numero: data.numero,
      status: data.status,
      concluidaEm: data.concluida_em,
      usuarioId: data.usuario_id,
      usuarioNome: data.usuario_nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar quadra: ' + err.message });
  }
});

app.post('/api/quadras/bulk', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { cidadeId, bairroId, inicio, fim } = req.body;

  if (!cidadeId || !bairroId || inicio === undefined || fim === undefined) {
    return res.status(400).json({ error: 'Cidade, Bairro e intervalo de quadras (Início e Fim) são obrigatórios.' });
  }

  const startNum = Number(inicio);
  const endNum = Number(fim);

  if (startNum > endNum) {
    return res.status(400).json({ error: 'O número inicial não pode ser maior que o final.' });
  }

  try {
    const inserts = [];
    for (let i = startNum; i <= endNum; i++) {
      const formattedNum = i < 10 ? `0${i}` : String(i);
      inserts.push({
        cidade_id: Number(cidadeId),
        bairro_id: Number(bairroId),
        numero: formattedNum,
        status: 'Não feita' as const,
      });
    }

    const { data, error } = await supabaseServer!.from('quadras').insert(inserts).select();
    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação em Massa de Quadras',
      `Criou ${data.length} quadras (da ${startNum} à ${endNum}) no bairro ID ${bairroId}.`
    );

    return res.status(201).json({
      message: `${data.length} quadras criadas com sucesso.`,
      count: data.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar quadras em lote: ' + err.message });
  }
});

app.put('/api/quadras/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { numero } = req.body;

  if (!numero || !String(numero).trim()) {
    return res.status(400).json({ error: 'Número da quadra é obrigatório.' });
  }

  try {
    const { data, error } = await supabaseServer!
      .from('quadras')
      .update({ numero: String(numero).trim() })
      .eq('id', id)
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição de Quadra',
      `Alterou o número da quadra ID ${id} para ${data.numero}.`
    );

    return res.json({
      id: data.id,
      cidadeId: data.cidade_id,
      cidadeNome: data.cidades?.nome,
      bairroId: data.bairro_id,
      bairroNome: data.bairros?.nome,
      numero: data.numero,
      status: data.status,
      concluidaEm: data.concluida_em,
      usuarioId: data.usuario_id,
      usuarioNome: data.usuario_nome,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar quadra: ' + err.message });
  }
});

app.delete('/api/quadras/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: q } = await supabaseServer!.from('quadras').select('numero').eq('id', id).maybeSingle();
    const { error } = await supabaseServer!.from('quadras').delete().eq('id', id);

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão de Quadra',
      `Excluiu a quadra ${q?.numero || id}.`
    );

    return res.json({ message: 'Quadra removida com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao deletar quadra: ' + err.message });
  }
});

app.patch('/api/quadras/:id/toggle', authenticateToken, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: quadra } = await supabaseServer!
      .from('quadras')
      .select('*, cidades(nome), bairros(nome)')
      .eq('id', id)
      .maybeSingle();

    if (!quadra) {
      return res.status(404).json({ error: 'Quadra não encontrada.' });
    }

    const newStatus = quadra.status === 'Feita' ? 'Não feita' : 'Feita';
    const now = new Date().toISOString();

    const updates = {
      status: newStatus,
      concluida_em: newStatus === 'Feita' ? now : null,
      usuario_id: newStatus === 'Feita' ? req.user!.id : null,
      usuario_nome: newStatus === 'Feita' ? req.user!.nome : null,
    };

    const { data: updated, error } = await supabaseServer!
      .from('quadras')
      .update(updates)
      .eq('id', id)
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (error) throw error;

    // Registra no histórico
    const acao = newStatus === 'Feita' ? ('Concluída' as const) : ('Resetada' as const);
    await supabaseServer!.from('historico').insert({
      quadra_id: id,
      cidade_nome: updated.cidades?.nome || 'Cidade',
      bairro_nome: updated.bairros?.nome || 'Bairro',
      numero: updated.numero,
      acao,
      usuario_nome: req.user!.nome,
      data_hora: now,
    });

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      `Quadra ${acao}`,
      `Marcou a quadra ${updated.numero} do bairro "${updated.bairros?.nome}" como ${newStatus}.`
    );

    return res.json({
      id: updated.id,
      cidadeId: updated.cidade_id,
      cidadeNome: updated.cidades?.nome,
      bairroId: updated.bairro_id,
      bairroNome: updated.bairros?.nome,
      numero: updated.numero,
      status: updated.status,
      concluidaEm: updated.concluida_em,
      usuarioId: updated.usuario_id,
      usuarioNome: updated.usuario_nome,
      createdAt: updated.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao alterar status da quadra: ' + err.message });
  }
});

app.get('/api/quadras/:id/historico', authenticateToken, async (req: Request, res: Response) => {
  const quadraId = Number(req.params.id);

  try {
    const { data, error } = await supabaseServer!
      .from('historico')
      .select('*')
      .eq('quadra_id', quadraId)
      .order('data_hora', { ascending: false });

    if (error) throw error;

    const formatted = (data || []).map((h) => ({
      id: h.id,
      quadraId: h.quadra_id,
      cidadeNome: h.cidade_nome,
      bairroNome: h.bairro_nome,
      numero: h.numero,
      acao: h.acao,
      usuarioNome: h.usuario_nome,
      dataHora: h.data_hora,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao buscar histórico da quadra: ' + err.message });
  }
});

// -------------------------------------------------------------
// CARTÕES DE TERRITÓRIO
// -------------------------------------------------------------
app.get('/api/cartoes', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { data: cartoes, error } = await supabaseServer!
      .from('cartoes')
      .select('*, cidades(nome), bairros(nome), users(nome), cartao_quadras(quadra_id), cartao_designacoes(*)')
      .order('id', { ascending: true });

    if (error) throw error;

    // Busca todas as quadras envolvidas
    const { data: allQuadras } = await supabaseServer!
      .from('quadras')
      .select('*, cidades(nome), bairros(nome)');

    const quadrasMap = new Map((allQuadras || []).map((q) => [q.id, q]));

    const result = (cartoes || []).map((c) => {
      const qIds = (c.cartao_quadras || []).map((cq: any) => cq.quadra_id);
      const cardQuadrasList = qIds
        .map((qid: number) => quadrasMap.get(qid))
        .filter(Boolean)
        .map((q: any) => ({
          id: q.id,
          cidadeId: q.cidade_id,
          cidadeNome: q.cidades?.nome,
          bairroId: q.bairro_id,
          bairroNome: q.bairros?.nome,
          numero: q.numero,
          status: q.status,
          concluidaEm: q.concluida_em,
          usuarioId: q.usuario_id,
          usuarioNome: q.usuario_nome,
        }));

      const totalQuadras = cardQuadrasList.length;
      const concluidasQuadras = cardQuadrasList.filter((q: any) => q.status === 'Feita').length;

      const designacoes = (c.cartao_designacoes || []).map((d: any) => ({
        id: d.id,
        dirigenteNome: d.dirigente_nome,
        dataDesignacao: d.data_designacao,
        dataConclusao: d.data_conclusao,
      }));

      return {
        id: c.id,
        titulo: c.titulo,
        descricao: c.descricao,
        cidadeId: c.cidade_id,
        cidadeNome: c.cidades?.nome,
        bairroId: c.bairro_id,
        bairroNome: c.bairros?.nome,
        usuarioId: c.usuario_id,
        usuarioNome: c.users?.nome || c.usuario_nome,
        quadraIds: qIds,
        quadras: cardQuadrasList,
        totalQuadras,
        concluidasQuadras,
        ultimaDataConcluida: c.ultima_data_concluida,
        designacoes,
        createdAt: c.created_at,
      };
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao listar cartões: ' + err.message });
  }
});

app.get('/api/cartoes/:id', authenticateToken, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: c, error } = await supabaseServer!
      .from('cartoes')
      .select('*, cidades(nome), bairros(nome), users(nome), cartao_quadras(quadra_id), cartao_designacoes(*)')
      .eq('id', id)
      .maybeSingle();

    if (error || !c) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    const qIds = (c.cartao_quadras || []).map((cq: any) => cq.quadra_id);

    let cardQuadrasList: any[] = [];
    if (qIds.length > 0) {
      const { data: qData } = await supabaseServer!
        .from('quadras')
        .select('*, cidades(nome), bairros(nome)')
        .in('id', qIds);

      cardQuadrasList = (qData || []).map((q: any) => ({
        id: q.id,
        cidadeId: q.cidade_id,
        cidadeNome: q.cidades?.nome,
        bairroId: q.bairro_id,
        bairroNome: q.bairros?.nome,
        numero: q.numero,
        status: q.status,
        concluidaEm: q.concluida_em,
        usuarioId: q.usuario_id,
        usuarioNome: q.usuario_nome,
      }));
    }

    const designacoes = (c.cartao_designacoes || []).map((d: any) => ({
      id: d.id,
      dirigenteNome: d.dirigente_nome,
      dataDesignacao: d.data_designacao,
      dataConclusao: d.data_conclusao,
    }));

    return res.json({
      id: c.id,
      titulo: c.titulo,
      descricao: c.descricao,
      cidadeId: c.cidade_id,
      cidadeNome: c.cidades?.nome,
      bairroId: c.bairro_id,
      bairroNome: c.bairros?.nome,
      usuarioId: c.usuario_id,
      usuarioNome: c.users?.nome || c.usuario_nome,
      quadraIds: qIds,
      quadras: cardQuadrasList,
      totalQuadras: cardQuadrasList.length,
      concluidasQuadras: cardQuadrasList.filter((q: any) => q.status === 'Feita').length,
      ultimaDataConcluida: c.ultima_data_concluida,
      designacoes,
      createdAt: c.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao obter cartão: ' + err.message });
  }
});

app.post('/api/cartoes', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { titulo, descricao, cidadeId, bairroId, usuarioId, quadraIds } = req.body;

  if (!titulo || !String(titulo).trim()) {
    return res.status(400).json({ error: 'O título do cartão é obrigatório.' });
  }

  try {
    const qIds = Array.isArray(quadraIds) ? quadraIds.map(Number) : [];

    // Insere o cartão em public.cartoes
    const { data: newCard, error: cErr } = await supabaseServer!
      .from('cartoes')
      .insert({
        titulo: String(titulo).trim(),
        descricao: descricao ? String(descricao).trim() : null,
        cidade_id: cidadeId ? Number(cidadeId) : null,
        bairro_id: bairroId ? Number(bairroId) : null,
        usuario_id: usuarioId ? Number(usuarioId) : null,
      })
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (cErr) throw cErr;

    // Vínculo das quadras no cartao_quadras
    if (qIds.length > 0) {
      const joins = qIds.map((qid: number) => ({
        cartao_id: newCard.id,
        quadra_id: qid,
      }));
      await supabaseServer!.from('cartao_quadras').insert(joins);
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Criação de Cartão',
      `Criou o cartão de território "${newCard.titulo}".`
    );

    return res.status(201).json({
      id: newCard.id,
      titulo: newCard.titulo,
      descricao: newCard.descricao,
      cidadeId: newCard.cidade_id,
      cidadeNome: newCard.cidades?.nome,
      bairroId: newCard.bairro_id,
      bairroNome: newCard.bairros?.nome,
      usuarioId: newCard.usuario_id,
      quadraIds: qIds,
      createdAt: newCard.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar cartão: ' + err.message });
  }
});

app.put('/api/cartoes/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { titulo, descricao, cidadeId, bairroId, usuarioId, quadraIds } = req.body;

  try {
    const updates: any = {};
    if (titulo !== undefined) updates.titulo = String(titulo).trim();
    if (descricao !== undefined) updates.descricao = String(descricao).trim();
    if (cidadeId !== undefined) updates.cidade_id = cidadeId ? Number(cidadeId) : null;
    if (bairroId !== undefined) updates.bairro_id = bairroId ? Number(bairroId) : null;
    if (usuarioId !== undefined) updates.usuario_id = usuarioId ? Number(usuarioId) : null;

    const { data: updatedCard, error } = await supabaseServer!
      .from('cartoes')
      .update(updates)
      .eq('id', id)
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (error) throw error;

    // Atualiza junção em cartao_quadras se quadraIds fornecido
    if (Array.isArray(quadraIds)) {
      const qIds = quadraIds.map(Number);
      await supabaseServer!.from('cartao_quadras').delete().eq('cartao_id', id);

      if (qIds.length > 0) {
        const joins = qIds.map((qid: number) => ({
          cartao_id: id,
          quadra_id: qid,
        }));
        await supabaseServer!.from('cartao_quadras').insert(joins);
      }
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Edição de Cartão',
      `Atualizou o cartão "${updatedCard.titulo}".`
    );

    return res.json({
      id: updatedCard.id,
      titulo: updatedCard.titulo,
      descricao: updatedCard.descricao,
      cidadeId: updatedCard.cidade_id,
      cidadeNome: updatedCard.cidades?.nome,
      bairroId: updatedCard.bairro_id,
      bairroNome: updatedCard.bairros?.nome,
      usuarioId: updatedCard.usuario_id,
      createdAt: updatedCard.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar cartão: ' + err.message });
  }
});

app.delete('/api/cartoes/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);

  try {
    const { data: c } = await supabaseServer!.from('cartoes').select('titulo').eq('id', id).maybeSingle();
    const { error } = await supabaseServer!.from('cartoes').delete().eq('id', id);

    if (error) throw error;

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Exclusão de Cartão',
      `Excluiu o cartão de território "${c?.titulo || id}".`
    );

    return res.json({ message: 'Cartão removido com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao deletar cartão: ' + err.message });
  }
});

app.post('/api/cartoes/:id/quadras', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const cartaoId = Number(req.params.id);
  const { numero, inicio, fim, numeros } = req.body;

  try {
    const { data: cartao } = await supabaseServer!
      .from('cartoes')
      .select('*, cidades(nome), bairros(nome)')
      .eq('id', cartaoId)
      .maybeSingle();

    if (!cartao) {
      return res.status(404).json({ error: 'Cartão não encontrado.' });
    }

    const numsToCreate: string[] = [];

    if (numeros && Array.isArray(numeros)) {
      numeros.forEach((n) => {
        if (n && String(n).trim()) numsToCreate.push(String(n).trim());
      });
    } else if (inicio !== undefined && fim !== undefined) {
      const start = Number(inicio);
      const end = Number(fim);
      for (let i = start; i <= end; i++) {
        numsToCreate.push(i < 10 ? `0${i}` : String(i));
      }
    } else if (numero) {
      numsToCreate.push(String(numero).trim());
    }

    if (numsToCreate.length === 0) {
      return res.status(400).json({ error: 'Forneça ao menos um número de quadra para criar.' });
    }

    const createdQuadraIds: number[] = [];

    for (const numStr of numsToCreate) {
      const { data: newQ } = await supabaseServer!
        .from('quadras')
        .insert({
          cidade_id: cartao.cidade_id,
          bairro_id: cartao.bairro_id,
          numero: numStr,
          status: 'Não feita',
        })
        .select()
        .single();

      if (newQ) {
        createdQuadraIds.push(newQ.id);
        await supabaseServer!.from('cartao_quadras').insert({
          cartao_id: cartaoId,
          quadra_id: newQ.id,
        });
      }
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Quadras Adicionadas ao Cartão',
      `Criou e vinculou ${createdQuadraIds.length} quadra(s) ao cartão "${cartao.titulo}".`
    );

    return res.json({
      message: `${createdQuadraIds.length} quadras vinculadas com sucesso.`,
      countCriadas: createdQuadraIds.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao vincular quadras ao cartão: ' + err.message });
  }
});

app.patch('/api/cartoes/:cartaoId/quadras/:quadraId/toggle', authenticateToken, async (req: AuthRequest, res: Response) => {
  const cartaoId = Number(req.params.cartaoId);
  const quadraId = Number(req.params.quadraId);

  try {
    const { data: quadra } = await supabaseServer!
      .from('quadras')
      .select('*, cidades(nome), bairros(nome)')
      .eq('id', quadraId)
      .maybeSingle();

    if (!quadra) {
      return res.status(404).json({ error: 'Quadra não encontrada.' });
    }

    const newStatus = quadra.status === 'Feita' ? 'Não feita' : 'Feita';
    const now = new Date().toISOString();

    const { data: updated, error } = await supabaseServer!
      .from('quadras')
      .update({
        status: newStatus,
        concluida_em: newStatus === 'Feita' ? now : null,
        usuario_id: newStatus === 'Feita' ? req.user!.id : null,
        usuario_nome: newStatus === 'Feita' ? req.user!.nome : null,
      })
      .eq('id', quadraId)
      .select('*, cidades(nome), bairros(nome)')
      .single();

    if (error) throw error;

    const acao = newStatus === 'Feita' ? ('Concluída' as const) : ('Resetada' as const);
    await supabaseServer!.from('historico').insert({
      quadra_id: quadraId,
      cidade_nome: updated.cidades?.nome || 'Cidade',
      bairro_nome: updated.bairros?.nome || 'Bairro',
      numero: updated.numero,
      acao,
      usuario_nome: req.user!.nome,
      data_hora: now,
    });

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      `Quadra ${acao} no Cartão`,
      `Quadra ${updated.numero} do cartão ID ${cartaoId} alterada para ${newStatus}.`
    );

    return res.json({
      id: updated.id,
      cidadeId: updated.cidade_id,
      cidadeNome: updated.cidades?.nome,
      bairroId: updated.bairro_id,
      bairroNome: updated.bairros?.nome,
      numero: updated.numero,
      status: updated.status,
      concluidaEm: updated.concluida_em,
      usuarioId: updated.usuario_id,
      usuarioNome: updated.usuario_nome,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao alterar quadra do cartão: ' + err.message });
  }
});

app.put('/api/cartoes/:id/designacoes', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const cartaoId = Number(req.params.id);
  const { designacoes, ultimaDataConcluida } = req.body;

  try {
    if (Array.isArray(designacoes)) {
      // Remove designacoes antigas e re-insere
      await supabaseServer!.from('cartao_designacoes').delete().eq('cartao_id', cartaoId);

      if (designacoes.length > 0) {
        const rows = designacoes.map((d: any) => ({
          cartao_id: cartaoId,
          dirigente_nome: d.dirigenteNome || d.dirigente_nome || 'Dirigente',
          data_designacao: d.dataDesignacao || d.data_designacao || new Date().toISOString().split('T')[0],
          data_conclusao: d.dataConclusao || d.data_conclusao || null,
        }));
        await supabaseServer!.from('cartao_designacoes').insert(rows);
      }
    }

    if (ultimaDataConcluida !== undefined) {
      await supabaseServer!
        .from('cartoes')
        .update({ ultima_data_concluida: ultimaDataConcluida })
        .eq('id', cartaoId);
    }

    await addAuditLog(
      req.user!.id,
      req.user!.nome,
      'Atualização de S-13/Designações',
      `Atualizou a lista de designações do cartão ID ${cartaoId}.`
    );

    return res.json({ message: 'Designações atualizadas com sucesso.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao atualizar designações: ' + err.message });
  }
});

// -------------------------------------------------------------
// HISTÓRICO E AUDITORIA
// -------------------------------------------------------------
app.get('/api/historico', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer!
      .from('historico')
      .select('*')
      .order('data_hora', { ascending: false })
      .limit(200);

    if (error) throw error;

    const formatted = (data || []).map((h) => ({
      id: h.id,
      quadraId: h.quadra_id,
      cidadeNome: h.cidade_nome,
      bairroNome: h.bairro_nome,
      numero: h.numero,
      acao: h.acao,
      usuarioNome: h.usuario_nome,
      dataHora: h.data_hora,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao buscar histórico: ' + err.message });
  }
});

app.get('/api/auditoria', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { search } = req.query;

  try {
    let query = supabaseServer!.from('audit_logs').select('*').order('data_hora', { ascending: false }).limit(200);

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      query = query.or(`usuario_nome.ilike.${term},acao.ilike.${term},detalhes.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const formatted = (data || []).map((l) => ({
      id: l.id,
      usuarioId: l.usuario_id,
      usuarioNome: l.usuario_nome,
      acao: l.acao,
      detalhes: l.detalhes,
      ip: l.ip,
      dataHora: l.data_hora,
    }));

    return res.json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao buscar logs de auditoria: ' + err.message });
  }
});

// -------------------------------------------------------------
// DASHBOARD & RELATÓRIOS
// -------------------------------------------------------------
app.get('/api/dashboard/stats', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { count: totalCidades } = await supabaseServer!.from('cidades').select('*', { count: 'exact', head: true });
    const { count: totalBairros } = await supabaseServer!.from('bairros').select('*', { count: 'exact', head: true });
    const { count: totalQuadras } = await supabaseServer!.from('quadras').select('*', { count: 'exact', head: true });
    const { count: quadrasConcluidas } = await supabaseServer!.from('quadras').select('*', { count: 'exact', head: true }).eq('status', 'Feita');
    const { count: totalCartoes } = await supabaseServer!.from('cartoes').select('*', { count: 'exact', head: true });

    const totalQ = totalQuadras || 0;
    const concQ = quadrasConcluidas || 0;
    const pendQ = totalQ - concQ;
    const perc = totalQ > 0 ? Math.round((concQ / totalQ) * 100) : 0;

    // Progresso por cidade
    const { data: cidades } = await supabaseServer!.from('cidades').select('*, quadras(status)');
    const progressoPorCidade = (cidades || []).map((c: any) => {
      const qList = c.quadras || [];
      const total = qList.length;
      const done = qList.filter((q: any) => q.status === 'Feita').length;
      return {
        cidade: c.nome,
        total,
        concluidas: done,
        percentual: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    });

    // Progresso por usuário
    const { data: doneQuadras } = await supabaseServer!.from('quadras').select('usuario_nome').eq('status', 'Feita');
    const userMap: Record<string, number> = {};
    (doneQuadras || []).forEach((q) => {
      if (q.usuario_nome) {
        userMap[q.usuario_nome] = (userMap[q.usuario_nome] || 0) + 1;
      }
    });

    const progressoPorUsuario = Object.entries(userMap).map(([usuario, totalConcluidas]) => ({
      usuario,
      totalConcluidas,
    }));

    // Bairros mais avançados
    const { data: bairros } = await supabaseServer!.from('bairros').select('*, cidades(nome), quadras(status)');
    const bairrosList = (bairros || []).map((b: any) => {
      const qList = b.quadras || [];
      const total = qList.length;
      const done = qList.filter((q: any) => q.status === 'Feita').length;
      return {
        bairro: b.nome,
        cidade: b.cidades?.nome || 'Cidade',
        total,
        concluidas: done,
        percentual: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    });

    bairrosList.sort((a, b) => b.percentual - a.percentual);

    return res.json({
      totalCidades: totalCidades || 0,
      totalBairros: totalBairros || 0,
      totalQuadras: totalQ,
      quadrasConcluidas: concQ,
      quadrasPendentes: pendQ,
      percentualConcluido: perc,
      totalCartoes: totalCartoes || 0,
      progressoPorCidade,
      progressoPorUsuario,
      bairrosMaisAvançados: bairrosList.slice(0, 5),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao gerar estatísticas do dashboard: ' + err.message });
  }
});

app.get('/api/relatorios', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { count: totalQuadras } = await supabaseServer!.from('quadras').select('*', { count: 'exact', head: true });
    const { count: quadrasConcluidas } = await supabaseServer!.from('quadras').select('*', { count: 'exact', head: true }).eq('status', 'Feita');

    const total = totalQuadras || 0;
    const conc = quadrasConcluidas || 0;
    const pend = total - conc;
    const percGeral = total > 0 ? Math.round((conc / total) * 100) : 0;

    const { data: bairros } = await supabaseServer!.from('bairros').select('*, cidades(nome), quadras(status)');

    const relatorioBairros = (bairros || []).map((b: any) => {
      const qList = b.quadras || [];
      const totalB = qList.length;
      const doneB = qList.filter((q: any) => q.status === 'Feita').length;
      const pendB = totalB - doneB;
      const percB = totalB > 0 ? Math.round((doneB / totalB) * 100) : 0;

      return {
        bairroId: b.id,
        bairroNome: b.nome,
        cidadeNome: b.cidades?.nome || 'Cidade',
        total: totalB,
        concluidas: doneB,
        pendentes: pendB,
        percentual: percB,
      };
    });

    return res.json({
      geradoEm: new Date().toISOString(),
      totalQuadras: total,
      quadrasConcluidas: conc,
      quadrasPendentes: pend,
      percentualGeral: percGeral,
      relatorioBairros,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao gerar relatórios: ' + err.message });
  }
});

// Catch-all para rotas de API inexistentes
app.use('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `Rota API não encontrada: ${req.method} ${req.originalUrl}` });
});

// Middleware de Erro Global Express
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Erro na API Express:', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno no servidor.',
  });
});

// Configuração do Vite Middleware em ambiente local
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupViteOrStatic();

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

export default app;
