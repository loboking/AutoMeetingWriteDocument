import { loadEnvFile } from 'node:process';
import path from 'node:path';
loadEnvFile('.env.local');
process.env.LLM_PROVIDER='openai';
process.env.OPENAI_MODEL='gpt-6-luna';
process.env.OPENAI_REASONING_EFFORT='low';
export default {test:{include:['audit/generation-verification/live.test.ts'],environment:'node',testTimeout:600000},resolve:{alias:{'@':path.resolve('src')}}};
