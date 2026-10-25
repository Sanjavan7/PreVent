// Entry for the Hospital Simulation page (sim.html, "/sim.html").
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AppRoot } from './app-root';
import { HospitalSim } from './pages/HospitalSim';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <AppRoot>
      <HospitalSim />
    </AppRoot>
  </StrictMode>,
);
