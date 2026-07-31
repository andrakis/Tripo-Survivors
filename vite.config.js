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
  // Dev serves models straight out of public/; a built site serves them out of dist/, where the
  // build has copied them. Same rule, two roots — so the middleware takes the root as an argument
  // rather than the two hooks below drifting apart.
  const guard = (root) => (req, res, next) => {
    const url = req.url || '';
    if (!/^\/models\//.test(url)) return next();
    const filePath = resolve(root, '.' + url.split('?')[0]);
    if (existsSync(filePath)) return next();
    res.statusCode = 404;
    res.end('Not found');
  };

  return {
    name: 'static-asset-404',
    configureServer(server) {
      server.middlewares.use(guard(resolve(__dirname, 'public')));
    },
    // `npm run serve` is the closest thing this project has to production, and it is where a viewer
    // will check that their model actually shipped. Without this hook the SPA fallback returns
    // index.html for a misplaced GLB there too — the one failure mode the plugin exists to kill,
    // surviving in exactly the mode where it matters most.
    configurePreviewServer(server) {
      server.middlewares.use(guard(resolve(__dirname, 'dist')));
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
