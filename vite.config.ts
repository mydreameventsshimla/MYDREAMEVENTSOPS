import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Ops portal runs as its own deployable (its own dev server / hosting
// target) so a bug or deploy in the staff app can never take down the
// client-facing site, and vice versa. It talks to the SAME Supabase
// project via the same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pair —
// just point this app's .env.local at the same project as the client app.
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3001,
  },
}));
