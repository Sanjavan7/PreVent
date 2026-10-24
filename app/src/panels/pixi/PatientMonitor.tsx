// Bedside patient monitor rendered with PixiJS v8.
// Three stacked waveform lanes (ECG, SpO2 pleth, respiration) scroll right-to-left.
//
// Data wiring:
//   - ECG amplitude & cycle rate driven by `device.reportedHr`
//     (so the device can LIE: ECG keeps beating during the attack while trueHr
//     crashes -- the deception is exposed by the "TRUE" vital tiles below.)
//   - SpO2 pleth amplitude follows `device.reportedSpo2`.
//   - Respiration is synced to `device.fanOn` (TRUE state). When the fan stops
//     (compromised && !fanOn), respiration flatlines -- that's the first
//     physical cue on the monitor that something is wrong, even while the
//     device still reports "normal" above.
//
// We intentionally keep PixiJS state out of React re-renders. The ticker
// reads from a ref so prop changes are picked up without rebuilding the
// Application. The Application is created once per mount and destroyed on
// unmount (StrictMode-safe via a cancelled flag).

import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { DeviceStatus } from '@prevent/contracts';

interface Props {
  device: DeviceStatus;
}

// Theme colors (hex matches app/src/index.css tokens).
const COLORS = {
  bg: 0x0b0f14,
  grid: 0x1f2b38,
  gridMinor: 0x151e28,
  muted: 0x8b9aab,
  ok: 0x47c08a,
  accent: 0x38bdf8,
  warn: 0xffb020,
  danger: 0xff4d4f,
};

// Horizontal scroll speed in CSS pixels per second (medical standard-ish).
const SWEEP_PX_PER_SEC = 90;

// One lane per waveform.
type LaneKey = 'ecg' | 'spo2' | 'resp';
interface Lane {
  key: LaneKey;
  color: number;
  label: string;
  unit: string;
}
const LANES: readonly Lane[] = [
  { key: 'ecg', color: COLORS.ok, label: 'ECG II', unit: 'mV' },
  { key: 'spo2', color: COLORS.accent, label: 'SpO₂', unit: 'pleth' },
  { key: 'resp', color: COLORS.warn, label: 'RESP', unit: 'br/min' },
];

/** Idealized ECG waveform: baseline + P + QRS + T, scaled to [-1, 1]. */
function ecgSample(phase: number): number {
  // phase in [0, 1) within one cardiac cycle
  // P wave: small positive hump around 0.1
  const p = Math.exp(-Math.pow((phase - 0.1) / 0.04, 2)) * 0.15;
  // Q dip just before R
  const q = -Math.exp(-Math.pow((phase - 0.17) / 0.012, 2)) * 0.25;
  // R spike (the big one)
  const r = Math.exp(-Math.pow((phase - 0.2) / 0.012, 2)) * 1.0;
  // S small dip after R
  const s = -Math.exp(-Math.pow((phase - 0.23) / 0.015, 2)) * 0.3;
  // T wave: broad positive hump around 0.45
  const t = Math.exp(-Math.pow((phase - 0.45) / 0.07, 2)) * 0.3;
  return p + q + r + s + t;
}

/** Plethysmograph: smooth dicrotic-looking wave, scaled to [0, 1]. */
function plethSample(phase: number): number {
  // Fast upstroke, slow decay with a small notch (dicrotic)
  const main = Math.exp(-Math.pow((phase - 0.18) / 0.1, 2));
  const dicrotic = 0.3 * Math.exp(-Math.pow((phase - 0.4) / 0.08, 2));
  return Math.max(0, main + dicrotic);
}

/** Respiration: smooth sine, 15 breaths/min cycle. */
function respSample(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

export function PatientMonitor({ device }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the latest device state in a ref so the ticker always reads fresh
  // values without us rebuilding the Pixi app on every prop change.
  const deviceRef = useRef<DeviceStatus>(device);
  deviceRef.current = device;

  // --- Alarm audio ----------------------------------------------------
  // Lazy AudioContext (browsers block audio until a user gesture; we unlock
  // it on the first pointer/key event). We fire a hospital-style triple beep
  // on the RISING edge of alarmActive and nothing else -- so the demo moment
  // lands exactly once per crash.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevAlarmRef = useRef<boolean>(device.alarmActive);

  useEffect(() => {
    const unlock = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === 'suspended') void ctx.resume();
      } catch {
        /* audio unsupported; silent is fine */
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const wasAlarming = prevAlarmRef.current;
    prevAlarmRef.current = device.alarmActive;
    if (!device.alarmActive || wasAlarming) return;
    // Rising edge: three short 880 Hz sine beeps, 260 ms apart.
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = now + i * 0.26;
      const dur = 0.17;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.28, start + 0.008);
      gain.gain.setValueAtTime(0.28, start + dur - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  }, [device.alarmActive]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let cancelled = false;

    void (async () => {
      await app.init({
        background: COLORS.bg,
        antialias: true,
        resizeTo: host,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }
      host.appendChild(app.canvas);

      // Root containers: grid stays behind, waveforms on top.
      const gridLayer = new Container();
      const laneLayer = new Container();
      const overlay = new Container(); // for the red-vignette crash tint
      app.stage.addChild(gridLayer, laneLayer, overlay);

      // Per-lane state: a Graphics for the waveform, a label, and a sample
      // buffer sized to the current canvas width (one sample per pixel).
      interface LaneState {
        g: Graphics;
        labelTop: Text;
        labelBot: Text;
        buf: Float32Array;
      }
      const lanes: Record<LaneKey, LaneState> = {} as Record<LaneKey, LaneState>;
      for (const lane of LANES) {
        const g = new Graphics();
        const labelTop = new Text({
          text: lane.label,
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            fontSize: 11,
            fill: COLORS.muted,
            letterSpacing: 1,
          },
        });
        const labelBot = new Text({
          text: lane.unit,
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
            fontSize: 10,
            fill: COLORS.muted,
          },
        });
        laneLayer.addChild(g, labelTop, labelBot);
        lanes[lane.key] = { g, labelTop, labelBot, buf: new Float32Array(0) };
      }

      // Grid: thin horizontal lines at lane boundaries + mid-rules.
      const grid = new Graphics();
      gridLayer.addChild(grid);

      // Red vignette overlay for crash states (alpha 0 unless alarmActive).
      const vignette = new Graphics();
      overlay.addChild(vignette);

      // Phases accumulate independently so each waveform cycle restarts
      // cleanly when HR changes.
      const phase = { ecg: 0, spo2: 0, resp: 0 };
      let vignetteAlpha = 0;
      // Per-lane amplitude envelope (0 = flat, 1 = normal). Driven in the
      // ticker so the crash and the restore ("exhale") feel organic rather
      // than snap-cut.
      const env = { ecg: 1, spo2: 1 };

      // Big "CODE" overlay fades in on alarmActive.
      const codeText = new Text({
        text: '⚠ CODE',
        style: {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          fontSize: 44,
          fontWeight: '700',
          fill: COLORS.danger,
          letterSpacing: 6,
        },
      });
      codeText.alpha = 0;
      codeText.anchor.set(0.5);
      overlay.addChild(codeText);
      const positionCodeText = () => {
        codeText.x = app.renderer.width / 2;
        codeText.y = app.renderer.height / 2;
      };
      positionCodeText();

      const resizeBuffers = (width: number) => {
        const n = Math.max(2, Math.floor(width));
        for (const key of ['ecg', 'spo2', 'resp'] as const) {
          const old = lanes[key].buf;
          if (old.length !== n) {
            const next = new Float32Array(n);
            // Preserve the right edge of the prior buffer so a resize does
            // not blank the trace.
            const keep = Math.min(old.length, n);
            next.set(old.subarray(old.length - keep), n - keep);
            lanes[key].buf = next;
          }
        }
      };

      const drawGrid = () => {
        const w = app.renderer.width;
        const h = app.renderer.height;
        const laneH = h / LANES.length;
        grid.clear();
        // Lane dividers (brighter)
        for (let i = 0; i <= LANES.length; i++) {
          grid
            .moveTo(0, i * laneH)
            .lineTo(w, i * laneH)
            .stroke({ color: COLORS.grid, width: 1 });
        }
        // Mid-line in each lane (dimmer)
        for (let i = 0; i < LANES.length; i++) {
          grid
            .moveTo(0, i * laneH + laneH / 2)
            .lineTo(w, i * laneH + laneH / 2)
            .stroke({ color: COLORS.gridMinor, width: 1 });
        }
      };

      const positionLabels = () => {
        const w = app.renderer.width;
        const h = app.renderer.height;
        const laneH = h / LANES.length;
        LANES.forEach((lane, i) => {
          const s = lanes[lane.key];
          s.labelTop.x = 10;
          s.labelTop.y = i * laneH + 6;
          s.labelBot.x = w - 10 - s.labelBot.width;
          s.labelBot.y = i * laneH + 6;
        });
      };

      // Rebuild size-dependent things when the stage resizes.
      app.renderer.on('resize', () => {
        resizeBuffers(app.renderer.width);
        drawGrid();
        positionLabels();
        positionCodeText();
      });
      resizeBuffers(app.renderer.width);
      drawGrid();
      positionLabels();
      positionCodeText();

      // --- Simulation + draw tick --------------------------------------
      app.ticker.add(() => {
        const d = deviceRef.current;
        const w = app.renderer.width;
        const h = app.renderer.height;
        const laneH = h / LANES.length;
        const dtSec = app.ticker.deltaMS / 1000;

        // How many pixels of new data this frame.
        const dx = Math.max(1, Math.round(dtSec * SWEEP_PX_PER_SEC));

        // Rates: driven by REPORTED values (device may be lying).
        // Clamp to sane ranges so the sim does not divide by zero.
        const hr = Math.max(20, Math.min(220, d.reportedHr || 72));
        const spo2Amp = Math.max(0, Math.min(100, d.reportedSpo2 || 98)) / 100;
        const ecgPeriod = 60 / hr; // seconds per beat
        const respPeriod = 4; // 4s cycle ~ 15 br/min
        const spo2Period = ecgPeriod;

        // Respiration is tied to the TRUE fan state so the monitor flatlines
        // the moment the ventilator physically stops, regardless of what the
        // device reports elsewhere.
        const respAlive = d.fanOn;

        // Advance per-sample so phase steps smoothly across the dx new pixels.
        const perPixel = 1 / SWEEP_PX_PER_SEC;

        // Shift each lane's buffer left by dx and fill the new tail samples.
        for (const key of ['ecg', 'spo2', 'resp'] as const) {
          const buf = lanes[key].buf;
          const n = buf.length;
          // Shift
          if (dx < n) buf.copyWithin(0, dx, n);
          // Fill tail
          const start = Math.max(0, n - dx);
          for (let i = start; i < n; i++) {
            // t = seconds since start for this sample position
            if (key === 'ecg') {
              phase.ecg = (phase.ecg + perPixel / ecgPeriod) % 1;
              buf[i] = ecgSample(phase.ecg);
            } else if (key === 'spo2') {
              phase.spo2 = (phase.spo2 + perPixel / spo2Period) % 1;
              buf[i] = plethSample(phase.spo2) * spo2Amp;
            } else {
              if (respAlive) {
                phase.resp = (phase.resp + perPixel / respPeriod) % 1;
                buf[i] = respSample(phase.resp);
              } else {
                // Flatline with tiny mains hum so it does not look dead-pixel.
                buf[i] = Math.sin((start + i) * 0.4) * 0.02;
              }
            }
          }
        }

        // Envelope: ECG and SpO2 collapse to a flat line when the device
        // admits the alarm, and swell back ("exhale") when it clears.
        // Respiration is driven by its own fanOn logic above, so no envelope
        // here -- we want the tiny mains hum visible when the fan stops.
        const kEnv = Math.min(1, dtSec * (d.alarmActive ? 4 : 2));
        const envTarget = d.alarmActive ? 0 : 1;
        env.ecg += (envTarget - env.ecg) * kEnv;
        env.spo2 += (envTarget - env.spo2) * kEnv;

        // Draw each lane. Y is centered in the lane; amplitude uses most of
        // the lane height with a margin so the line never clips.
        LANES.forEach((lane, laneIdx) => {
          const s = lanes[lane.key];
          const yCenter = laneIdx * laneH + laneH / 2;
          const envMul = lane.key === 'resp' ? 1 : env[lane.key];
          const yAmp = laneH * 0.38 * envMul;
          const g = s.g;
          g.clear();
          const n = s.buf.length;
          if (n < 2) return;
          g.moveTo(0, yCenter - s.buf[0] * yAmp);
          for (let i = 1; i < n; i++) {
            g.lineTo(i, yCenter - s.buf[i] * yAmp);
          }
          // Danger tint if the device admits the alarm, or if respiration
          // has flatlined (an obvious tell even during a lie).
          const danger =
            d.alarmActive || (lane.key === 'resp' && !respAlive);
          g.stroke({
            color: danger ? COLORS.danger : lane.color,
            width: 1.6,
            cap: 'round',
            join: 'round',
          });
        });

        // Vignette: fade in when the alarm is actually firing, fade out when
        // it clears. Pulses slowly for dramatic effect.
        const vignetteBase = d.alarmActive
          ? 0.18 + 0.1 * Math.abs(Math.sin(performance.now() / 350))
          : 0;
        vignetteAlpha += (vignetteBase - vignetteAlpha) * Math.min(1, dtSec * 4);
        vignette.clear();
        vignette.rect(0, 0, w, h).fill({ color: COLORS.danger, alpha: vignetteAlpha });

        // CODE overlay fades in with the alarm.
        const codeTarget = d.alarmActive ? 0.9 : 0;
        codeText.alpha += (codeTarget - codeText.alpha) * Math.min(1, dtSec * 3);
      });
    })();

    return () => {
      cancelled = true;
      // The async init may still be running; the cancelled flag handles that
      // case. If init already finished, this destroys the canvas and ticker.
      try {
        app.destroy(true, { children: true, texture: true });
      } catch {
        // ignore -- can happen if init hasn't completed yet
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-label="Patient monitor waveforms"
      className="min-h-56 flex-1 overflow-hidden rounded-lg border border-border"
      style={{ touchAction: 'none' }}
    />
  );
}
