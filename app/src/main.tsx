import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { createSpacetimeBuilder } from '@prevent/realtime/spacetime';
import './index.css';
import { App } from './App';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// Build-time envs. The branch is constant across renders -> safe for hook rules
// in useRealtime.ts. Flipping backend is a one-line .env change + reload.
const BACKEND = import.meta.env.VITE_REALTIME_BACKEND ?? 'mock';
const STDB_URI = import.meta.env.VITE_SPACETIMEDB_URI ?? 'ws://localhost:3000';
const STDB_MODULE = import.meta.env.VITE_SPACETIMEDB_MODULE ?? 'prevent';

function Root() {
  if (BACKEND === 'spacetimedb') {
    // DO NOT call .build() -- the provider owns the connection lifecycle.
    const builder = createSpacetimeBuilder({
      uri: STDB_URI,
      moduleName: STDB_MODULE,
    });
    return (
      <SpacetimeDBProvider connectionBuilder={builder}>
        <App />
      </SpacetimeDBProvider>
    );
  }
  return <App />;
}

createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
