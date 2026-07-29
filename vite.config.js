import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Vite's SPA fallback serves index.html for any unmatched GET — including a typo'd or missing
// model file. A viewer who drops their GLB in the wrong place would get a 200 that isn't a GLB,
// and the loader's error would surface as a parse failure a hundred lines from the real mistake.
//
// For a project whose whole purpose is "put your file here", that is the single most expensive
// failure mode we can eliminate. Real-404 anything under /models/; everything else keeps the
// SPA fallback. See docs/ARCHITECTURE.md §1.1. Ported from Breach.
function staticAsset404() {
  const publicDir = resolve(__dirname, 'public');
  return {
    name: 'static-asset-404',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!/^\/models\//.test(url)) return next();
        const filePath = resolve(publicDir, '.' + url.split('?')[0]);
        if (existsSync(filePath)) return next();
        res.statusCode = 404;
        res.end('Not found');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), staticAsset404()],
  server: {
    port: 5182,
    host: true,
    allowedHosts: ['localhost', '.code.stargazer.onl', '.code.home.stargazer.onl'],
  },
  preview: {
    port: 4182,
    allowedHosts: ['localhost', '.code.stargazer.onl', '.code.home.stargazer.onl'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
