// One place that maps a node's live state to its clinical-security colorway.
// idle = quiet neutral; active = telemetry teal (+glow); waiting = amber gate;
// done = vital green; alert = critical red (the compromise beat).

import type { NodeState } from '../types';

export interface NodeStyle {
  ring: string; // border color class
  text: string; // label/text color class
  dot: string; // status dot fill class
  glow: string; // box-shadow glow class ('' when quiet)
  chip: string; // small status chip bg+text
}

const STYLES: Record<NodeState, NodeStyle> = {
  idle: {
    ring: 'border-border',
    text: 'text-text-muted',
    dot: 'bg-border-strong',
    glow: '',
    chip: 'bg-surface-2 text-text-muted',
  },
  active: {
    ring: 'border-accent-border',
    text: 'text-accent-fg',
    dot: 'bg-accent',
    glow: 'glow-teal',
    chip: 'bg-accent-bg text-accent-fg',
  },
  waiting: {
    ring: 'border-warn',
    text: 'text-warn-fg',
    dot: 'bg-warn',
    glow: 'glow-amber',
    chip: 'bg-warn-bg text-warn-fg',
  },
  done: {
    ring: 'border-success',
    text: 'text-success-fg',
    dot: 'bg-success',
    glow: '',
    chip: 'bg-success-bg text-success-fg',
  },
  alert: {
    ring: 'border-danger',
    text: 'text-danger-fg',
    dot: 'bg-danger',
    glow: 'glow-red',
    chip: 'bg-danger-bg text-danger-fg',
  },
};

export function nodeStyle(state: NodeState): NodeStyle {
  return STYLES[state];
}

export const STATE_LABEL: Record<NodeState, string> = {
  idle: 'idle',
  active: 'running',
  waiting: 'awaiting approval',
  done: 'done',
  alert: 'compromised',
};
