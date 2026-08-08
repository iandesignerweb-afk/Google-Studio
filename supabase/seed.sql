-- ====================================================================
-- SUPABASE SEED DATA
-- Default seed data for Quadras & Cartões Application
-- ====================================================================

-- Default Users (Pass: admin123 and user123 hashed with bcrypt)
INSERT INTO public.users (id, nome, usuario, email, senha_hash, permissao)
VALUES
  (1, 'Administrador do Sistema', 'admin', 'admin@quadras.com', '$2a$10$wTIn6eNq3cO3uS1pLhI2eeE8bN.O0I.C8L/E8mZqQ2V1Y4L5K6J7i', 'Administrador'),
  (2, 'Carlos Silva', 'carlos', 'carlos@quadras.com', '$2a$10$wTIn6eNq3cO3uS1pLhI2eeE8bN.O0I.C8L/E8mZqQ2V1Y4L5K6J7i', 'Usuário comum')
ON CONFLICT (usuario) DO NOTHING;

-- Default Cidades
INSERT INTO public.cidades (id, nome)
VALUES
  (1, 'São Paulo'),
  (2, 'Campinas')
ON CONFLICT (nome) DO NOTHING;

-- Default Bairros
INSERT INTO public.bairros (id, cidade_id, nome)
VALUES
  (1, 1, 'Centro'),
  (2, 1, 'Jardins'),
  (3, 2, 'Cambuí')
ON CONFLICT DO NOTHING;

-- Default Quadras
INSERT INTO public.quadras (id, cidade_id, bairro_id, numero, status)
VALUES
  (1, 1, 1, '01', 'Não feita'),
  (2, 1, 1, '02', 'Não feita'),
  (3, 1, 2, '01', 'Não feita'),
  (4, 2, 3, '10', 'Não feita')
ON CONFLICT DO NOTHING;

-- Reset identity sequence offsets so new inserts get IDs starting after seed data
SELECT setval(pg_get_serial_sequence('public.users', 'id'), COALESCE(MAX(id), 1)) FROM public.users;
SELECT setval(pg_get_serial_sequence('public.cidades', 'id'), COALESCE(MAX(id), 1)) FROM public.cidades;
SELECT setval(pg_get_serial_sequence('public.bairros', 'id'), COALESCE(MAX(id), 1)) FROM public.bairros;
SELECT setval(pg_get_serial_sequence('public.quadras', 'id'), COALESCE(MAX(id), 1)) FROM public.quadras;
SELECT setval(pg_get_serial_sequence('public.cartoes', 'id'), COALESCE(MAX(id), 1)) FROM public.cartoes;
SELECT setval(pg_get_serial_sequence('public.historico', 'id'), COALESCE(MAX(id), 1)) FROM public.historico;
SELECT setval(pg_get_serial_sequence('public.audit_logs', 'id'), COALESCE(MAX(id), 1)) FROM public.audit_logs;
