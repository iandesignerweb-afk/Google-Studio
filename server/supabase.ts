import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseServerConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabaseServer: SupabaseClient | null = isSupabaseServerConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;
