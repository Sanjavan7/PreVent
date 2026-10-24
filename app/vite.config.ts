import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Load .env from the monorepo root so the whole team shares one env file.
  envDir: '..',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
