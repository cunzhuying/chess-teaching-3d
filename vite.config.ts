import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      usePolling: true,
      interval: 300,
      ignored: [
        '**/.pnpm-store/**',
        '**/dist/**',
        '**/.edge-profile/**',
        '**/.tmp/**',
        '**/*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
  },
});
