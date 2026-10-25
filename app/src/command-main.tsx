// Entry for the Command Center page (index.html, "/").
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AppRoot } from './app-root';
import { CommandCenter } from './pages/CommandCenter';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <AppRoot>
      <CommandCenter />
    </AppRoot>
  </StrictMode>,
);
