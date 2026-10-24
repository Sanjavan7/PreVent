// Loads the repo-root .env so `pnpm dev` picks up ANTHROPIC_API_KEY / FACTORY_API_KEY.
// The Claude Agent SDK does NOT auto-load .env, so import this module FIRST
// (before @anthropic-ai/claude-agent-sdk) in any entrypoint.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
