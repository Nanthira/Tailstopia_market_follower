import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3001;

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, '../dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../dist/index.html')));
} else {
  const vite = await createViteServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, () => console.log(`TailsTopia Market running at http://localhost:${port}`));
