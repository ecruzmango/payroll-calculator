import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The react plugin enables Fast Refresh. Without it Vite still compiles JSX via
// esbuild, but every edit forces a full page reload — which would wipe in-progress
// table state during development.
export default defineConfig({
  plugins: [react()]
});
