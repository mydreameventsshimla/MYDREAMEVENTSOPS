import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Point .env.local at the ' +
      'SAME Supabase project the client-facing app uses.'
  );
}

// Same project as the client app, separate client instance — this app
// never imports anything from the client app's bundle, so a deploy of one
// can never break the other.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
