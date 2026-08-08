# Supabase Integration & Migrations

Este repositório possui suporte e integrações preparadas para o **Supabase** (PostgreSQL).

## Arquivos de Integração e Migrações

- `supabase/migrations/20260807000000_initial_schema.sql`: Script SQL completo com tabelas, chaves estrangeiras, índices e políticas RLS (Row Level Security).
- `supabase/seed.sql`: Dados iniciais padrão (usuários admin, cidades, bairros e quadras).
- `src/lib/supabase.ts`: Cliente frontend `@supabase/supabase-js`.
- `server/supabase.ts`: Cliente backend com chave de serviço.

## Como Aplicar as Migrações no Supabase

### Opção 1: Via Dashboard do Supabase (Mais Rápido)

1. Acesse o [Supabase Dashboard](https://app.supabase.com/) e escolha seu projeto.
2. Vá na seção **SQL Editor** no menu lateral esquerdo.
3. Clique em **New query**.
4. Copie o conteúdo de `supabase/migrations/20260807000000_initial_schema.sql` e cole no editor.
5. Clique em **Run** para executar e criar as tabelas.
6. Em seguida, crie outra query e copie o conteúdo do `supabase/seed.sql` e clique em **Run** para alimentar com os dados iniciais.

### Opção 2: Via Supabase CLI

Se você utiliza a CLI do Supabase localmente ou em CI/CD:

```bash
# Linkar com seu projeto remoto
supabase link --project-ref <seu-project-id>

# Aplicar migrações pendentes
supabase db push
```

## Variáveis de Ambiente Necessárias

Configure no seu arquivo `.env` ou nas configurações do ambiente:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
```
