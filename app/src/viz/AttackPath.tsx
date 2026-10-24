// The attack visualization: [Attacker] -> [POST /device/command] -> [Ventilator].
// It makes the unauthenticated-command exploit (CWE-306 / CVE-2019-6538) legible
// as a packet traveling an SVG path -- and then pays it off with the verification
// beat: replay the SAME request after the patch and watch it bounce as 401.
//
// Driven ENTIRELY by `device` state transitions, never a new collection:
//   - device.compromised true            -> "attack"  (red exploit packet loops in)
//   - compromised true -> false (recover) -> "verify"  (green replay -> 401 -> shield)
//   - healthy and never attacked          -> renders nothing
//
// Everything lives in ONE <svg> coordinate space (viewBox) so the packet, the
// connectors, and the nodes can never drift apart; the 401 odometer rides in a
// <foreignObject> so it can reuse the shared <AnimatedNumber>. Only the active
// phase animates (frame-budget doctrine), and the TravelingComet / halo loops
// self-disable under Reduce Motion.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DeviceStatus } from '@prevent/contracts';
import { AnimatedNumber } from '../lib/AnimatedNumber';
import { TravelingComet } from '../lib/TravelingComet';
import { DUR, EASE_SETTLE, SPRING } from '../lib/motion';

type Phase = 'idle' | 'attack' | 'verify';

// --- Geometry (one viewBox everyone shares) ------------------------------
const VW = 600;
const VH = 118;
const CY = 70; // connector baseline
// node boxes share one width/height; x positions space them across the viewBox.
const ATTACKER_X = 46;
const COMMAND_X = 235;
const DEVICE_X = 424;
const NODE_W = 130;
const NODE_H = 46;
const nodeTop = CY - NODE_H / 2;

const cx = (x: number) => x + NODE_W / 2;
// packet travels from the attacker's right edge, through the command endpoint,
// to the ventilator's left edge -- the real request path.
const ATTACK_PATH = `M ${ATTACKER_X + NODE_W},${CY} L ${DEVICE_X},${CY}`;

interface AttackPathProps {
  device: DeviceStatus;
}

export function AttackPath({ device }: AttackPathProps) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(device.compromised ? 'attack' : 'idle');
  const prevCompromised = useRef(device.compromised);

  useEffect(() => {
    const was = prevCompromised.current;
    prevCompromised.current = device.compromised;
    if (device.compromised) {
      setPhase('attack');
      return;
    }
    if (was) {
      // Recovered: run the verification beat, then settle back to idle.
      setPhase('verify');
      const t = window.setTimeout(() => setPhase('idle'), 4600);
      return () => window.clearTimeout(t);
    }
  }, [device.compromised]);

  const attacking = phase === 'attack';
  const verifying = phase === 'verify';

  // Connectors + nodes cross red -> amber -> green as the system restores.
  const wireColor = verifying
    ? ['var(--color-danger)', 'var(--color-warn)', 'var(--color-ok)']
    : 'var(--color-danger)';
  const wireTransition = verifying
    ? { duration: 1.1, ease: EASE_SETTLE, times: [0, 0.4, 1] }
    : { duration: DUR.micro };

  return (
    <AnimatePresence>
      {phase !== 'idle' ? (
        <motion.section
          key="attack-path"
          layout
          initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
          transition={{ duration: DUR.enter, ease: EASE_SETTLE }}
          className="glass-card xl:col-span-2 p-4"
          aria-label="Attack path visualization"
          role="group"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-title">
              {verifying ? 'Replay after patch' : 'Live exploit path'}
            </h3>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={phase}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={SPRING.snappy}
                className={`rounded-pill border px-2.5 py-0.5 font-mono text-overline uppercase tracking-wider ${
                  verifying
                    ? 'border-ok/40 bg-ok/15 text-ok'
                    : 'border-danger/40 bg-danger/15 text-danger'
                }`}
              >
                {verifying ? 'exploit blocked' : 'unauthenticated command'}
              </motion.span>
            </AnimatePresence>
          </div>

          <svg
            width="100%"
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={
              verifying
                ? 'Replayed exploit request is rejected with 401 after the patch'
                : 'Attacker sends an unauthenticated command that stops the ventilator'
            }
          >
            <defs>
              <linearGradient id="attack-node" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
              </linearGradient>
            </defs>

            {/* Connectors */}
            <motion.line
              x1={ATTACKER_X + NODE_W}
              y1={CY}
              x2={COMMAND_X}
              y2={CY}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="4 5"
              initial={false}
              animate={{ stroke: wireColor }}
              transition={wireTransition}
            />
            <motion.line
              x1={COMMAND_X + NODE_W}
              y1={CY}
              x2={DEVICE_X}
              y2={CY}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="4 5"
              initial={false}
              animate={{ stroke: wireColor }}
              transition={wireTransition}
            />

            {/* Ventilator threat/restore halo */}
            <motion.rect
              x={DEVICE_X - 4}
              y={nodeTop - 4}
              width={NODE_W + 8}
              height={NODE_H + 8}
              rx={14}
              fill="none"
              strokeWidth={2}
              initial={false}
              animate={
                verifying
                  ? { stroke: 'var(--color-ok)', opacity: 0.6 }
                  : reduce
                    ? { stroke: 'var(--color-danger)', opacity: 0.5 }
                    : { stroke: 'var(--color-danger)', opacity: [0.2, 0.65, 0.2] }
              }
              transition={
                verifying
                  ? { duration: 0.8, ease: EASE_SETTLE }
                  : { duration: 1.4, repeat: reduce ? 0 : Infinity, ease: 'easeInOut' }
              }
            />

            {/* Nodes */}
            <AttackNode x={ATTACKER_X} label="Attacker" sub="crafts request" tone="danger" />
            <AttackNode
              x={COMMAND_X}
              label="POST /device/command"
              sub="no auth · CWE-306"
              tone="neutral"
              mono
            />
            <AttackNode
              x={DEVICE_X}
              label="Ventilator"
              sub={verifying ? 'request rejected' : 'fan stopped'}
              tone={verifying ? 'ok' : 'danger'}
            />

            {/* Exploit packet (attack) / replay packet (verify) */}
            {attacking ? (
              <TravelingComet
                path={ATTACK_PATH}
                dur={0.9}
                color="var(--color-danger)"
                r={5}
                repeat
              />
            ) : null}
            {verifying ? (
              <TravelingComet
                path={ATTACK_PATH}
                dur={0.9}
                color="var(--color-ok)"
                r={5}
                repeat={false}
              />
            ) : null}

            {/* Verification payoff: green shield + the 401 odometer popping in. */}
            {verifying ? (
              <foreignObject x={DEVICE_X - 6} y={2} width={NODE_W + 12} height={34}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: [0.6, 1.15, 1] }}
                  transition={{ ...SPRING.snappy, delay: 0.55 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    color: 'var(--color-ok)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: 20,
                    textShadow: '0 0 16px rgba(0,222,104,0.4)',
                  }}
                >
                  <span aria-hidden>{'\u{1F6E1}'}</span>
                  <AnimatedNumber value={401} className="tabular-nums" />
                </motion.div>
              </foreignObject>
            ) : null}
          </svg>

          <p className="mt-2 text-center font-mono text-caption text-text-secondary">
            {verifying
              ? 'Same exploit, replayed → 401 Unauthorized. The fix holds.'
              : 'Unauthenticated POST stops the fan and silences the alarm. (staging rig)'}
          </p>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

// A single node drawn in SVG so it shares the packet's coordinate space.
function AttackNode({
  x,
  label,
  sub,
  tone,
  mono = false,
}: {
  x: number;
  label: string;
  sub: string;
  tone: 'danger' | 'ok' | 'neutral';
  mono?: boolean;
}) {
  const stroke =
    tone === 'danger'
      ? 'rgba(255,77,79,0.45)'
      : tone === 'ok'
        ? 'rgba(0,222,104,0.45)'
        : 'rgba(255,255,255,0.12)';
  return (
    <g>
      <rect
        x={x}
        y={nodeTop}
        width={NODE_W}
        height={NODE_H}
        rx={12}
        fill="url(#attack-node)"
        stroke={stroke}
        strokeWidth={1}
      />
      <text
        x={cx(x)}
        y={CY - 3}
        textAnchor="middle"
        fill="var(--color-text-strong)"
        fontFamily={mono ? 'var(--font-mono)' : 'var(--font-sans)'}
        fontSize={mono ? 11 : 13}
        fontWeight={600}
      >
        {label}
      </text>
      <text
        x={cx(x)}
        y={CY + 13}
        textAnchor="middle"
        fill="var(--color-text-secondary)"
        fontFamily="var(--font-mono)"
        fontSize={9.5}
      >
        {sub}
      </text>
    </g>
  );
}
