import { motion } from 'motion/react';
import { SimPanel } from './panels/SimPanel';
import { DashboardPanel } from './panels/DashboardPanel';
import { useRealtime } from './realtime/useRealtime';
import { AnimatedNumber } from './lib/AnimatedNumber';
import { DUR, EASE_FRAMER, EASE_SETTLE, SPRING } from './lib/motion';

// Header items rise + fade (+ a touch of blur) in sequence on load.
const headerParent = {
  hidden: {},
  show: { transition: { delayChildren: 0.05, staggerChildren: 0.08 } },
};
const headerItem = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: DUR.reveal, ease: EASE_SETTLE },
  },
};

export function App() {
  // One subscription source feeds both panels -> no desync.
  const rt = useRealtime();
  const compromised = rt.device.compromised;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <motion.div
          className="flex items-center gap-3"
          variants={headerParent}
          initial="hidden"
          animate="show"
        >
          <motion.span variants={headerItem} className="font-display text-h3">
            Pre<span className="text-blue">Vent</span>
          </motion.span>
          <motion.span
            variants={headerItem}
            className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-0.5 font-mono text-caption text-text-secondary"
          >
            <span className="status-dot live" aria-hidden />
            <span>
              1 of <AnimatedNumber value={3412} /> devices
            </span>
          </motion.span>
          <motion.span
            variants={headerItem}
            animate={{
              backgroundColor: compromised ? 'rgba(255,77,79,0.15)' : 'rgba(0,222,104,0.15)',
              color: compromised ? 'var(--color-danger)' : 'var(--color-ok)',
            }}
            transition={{ duration: DUR.micro }}
            className="rounded-pill px-3 py-0.5 font-mono text-caption uppercase tracking-wider"
          >
            {compromised ? 'Threat active' : 'No threats'}
          </motion.span>
        </motion.div>

        <div className="flex items-center gap-3 font-mono text-caption text-text-secondary">
          <span>source: {rt.mode}</span>
          {rt.mode === 'mock' && (
            <motion.button
              type="button"
              onClick={() => rt.setMockExploited(!rt.mockExploited)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={SPRING.snappy}
              className="rounded-pill border border-border-accent px-3 py-1 text-blue hover:bg-blue-10"
            >
              {rt.mockExploited ? 'Reset to healthy' : 'Simulate exploit'}
            </motion.button>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* Left column: a one-cell grid so SimPanel still stretches to fill the
            cell, with an ambient glow painted BEHIND it (z -1). The glow is a
            calm blue halo under the monitor at rest and snaps to danger-red when
            the device is compromised -- two crossfading layers, since a radial
            gradient string can't be tweened. We never touch SimPanel itself. */}
        <div className="relative grid min-h-0">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-3/5 overflow-hidden" style={{ zIndex: -1 }}>
            <motion.div
              className="absolute inset-0"
              style={{ background: 'var(--glow-blue-spot)' }}
              animate={{ opacity: compromised ? 0 : 1 }}
              transition={{ duration: DUR.enter, ease: EASE_FRAMER }}
            />
            <motion.div
              className="absolute inset-0"
              style={{ background: 'var(--glow-danger-spot)' }}
              animate={{ opacity: compromised ? 1 : 0 }}
              transition={{ duration: DUR.enter, ease: EASE_FRAMER }}
            />
          </div>
          <SimPanel device={rt.device} />
        </div>

        {/* Right dashboard reads as its own raised surface. */}
        <div className="solid-card min-h-0 overflow-hidden">
          <DashboardPanel
            agents={rt.agents}
            findings={rt.findings}
            eventLog={rt.eventLog}
            device={rt.device}
          />
        </div>
      </main>
    </div>
  );
}
