import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <main className="shell">
      <h1>World Wide War</h1>
    </main>
  </StrictMode>,
);
