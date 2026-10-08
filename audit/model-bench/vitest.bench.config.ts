// Opt-in benchmark: calls real, paid model APIs; excluded from the normal test suite.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root,
  test: {
    environment: 'node', globals: true,
    include: ['audit/model-bench/full.test.ts'], testTimeout: 3_600_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
});
