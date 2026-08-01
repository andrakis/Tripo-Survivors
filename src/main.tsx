import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadActors } from './models/loader';

// Models are resolved BEFORE the first render, not swapped in afterwards.
//
// The alternative — render primitives immediately and hot-swap each geometry as its GLB arrives — is
// less code and worse: the first second of every run would be cubes turning into monsters, which is
// exactly the transformation this project exists to sell and precisely the wrong moment to spend it.
// Resolving first also means no renderer has to be reactive about geometry, so everything under
// `scene/` stays imperative (ARCHITECTURE §3).
//
// `loadActors` never rejects (src/models/loader.ts): every failure ends as a primitive plus a
// console warning. The catch below is belt-and-braces for the one outcome MODEL-PIPELINE §1 rules
// out — a blank page because somebody's asset was wrong.
loadActors()
  .catch((err) => console.warn('[models] resolve failed entirely — running on primitives.', err))
  .finally(() => {
    document.getElementById('boot')?.remove();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
