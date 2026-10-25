// Maps a node's live state to its clinical-security colorway. idle recedes;
// active/waiting/alert draw focus via a raised surface; done is quietly green.

import type { NodeState } from '../types';

export interface NodeStyle {
  text: string; // label/accent text color
  gem: string; // text color that fills the gem (currentColor)
  surface: string; // '' = sits flat on canvas; else a raised surface draws focus
  live: boolean; // gem pulses
}

const STYLES: Record<NodeState, NodeStyle> = {
  idle: { text: 'text-text-muted', gem: 'text-border-strong', surface: '', live: false },
  active: { text: 'text-accent-fg', gem: 'text-accent', surface: 'panel panel--raised', live: true },
  waiting: { text: 'text-accent-fg', gem: 'text-accent', surface: 'panel panel--raised', live: true },
  done: { text: 'text-success-fg', gem: 'text-success', surface: '', live: false },
  alert: { text: 'text-danger-fg', gem: 'text-danger', surface: 'panel panel--raised', live: true },
};

export function nodeStyle(state: NodeState): NodeStyle {
  return STYLES[state];
}

export const STATE_WORD: Record<NodeState, string> = {
  idle: 'idle',
  active: 'running',
  waiting: 'awaiting approval',
  done: 'done',
  alert: 'compromised',
};
