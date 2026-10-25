import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Load .env from the monorepo root so the whole team shares one env file.
  envDir: '..',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // Two standalone full-screen pages, one codebase, shared live state:
      //   main -> index.html  (Command Center, "/")
      //   sim  -> sim.html    (Patient Ward,   "/sim.html")
      input: {
        main: resolve(__dirname, 'index.html'),
        sim: resolve(__dirname, 'sim.html'),
      },
    },
  },
});
