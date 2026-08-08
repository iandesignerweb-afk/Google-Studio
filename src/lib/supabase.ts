import { createClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as any).env || {};
const procEnv = typeof process !== 'undefined' && process.env ? process.env : {};

const supabaseUrl =
  metaEnv.VITE_SUPABASE_URL ||
  metaEnv.NEXT_PUBLIC_SUPABASE_URL ||
  procEnv.VITE_SUPABASE_URL ||
  procEnv.NEXT_PUBLIC_SUPABASE_URL ||
  procEnv.SUPABASE_URL ||
  '';

const supabaseAnonKey =
  metaEnv.VITE_SUPABASE_ANON_KEY ||
  metaEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_ANON_KEY ||
  procEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  procEnv.SUPABASE_ANON_KEY ||
  procEnv.SUPABASE_PUBLISHABLE_KEY ||
  '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
