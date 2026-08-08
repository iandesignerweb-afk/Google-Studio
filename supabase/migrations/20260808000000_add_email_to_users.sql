-- Migration to add email column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
