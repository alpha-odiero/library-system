import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment loading.
 *
 * A single `.env` lives at the repository root (one file for the whole
 * workspace, so the frontend never has to be told secrets it must not see).
 * A workspace-local `.env` may override it, which is what CI and per-developer
 * overrides use.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// src/config (and dist/config) are four levels below the repository root.
const repoRoot = path.resolve(here, '../../../..');

loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });
loadDotenv({ path: path.join(repoRoot, 'apps/backend/.env'), override: true, quiet: true });

export const REPO_ROOT = repoRoot;
export const BACKEND_ROOT = path.resolve(here, '../..');
