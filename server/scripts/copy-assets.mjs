// Copia las migraciones SQL a dist, porque tsc solo copia archivos .ts.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/migrations'), { recursive: true });
cpSync(join(root, 'src/migrations'), join(root, 'dist/migrations'), { recursive: true });
