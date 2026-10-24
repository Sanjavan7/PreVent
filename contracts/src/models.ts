// Verified GA on the Claude API as of 2026-10-24. Pin the DATELESS ids; never
// add a date suffix. Re-verify with GET /v1/models on the demo laptop at H0.
export const CLAUDE_MODELS = {
  reasoning: 'claude-opus-5-5', // scan triage, verify triage (effort default 'medium' - set explicitly)
  mid: 'claude-sonnet-5-5',
  cheap: 'claude-haiku-5-5', // GROUND and cheap narration
  fallback: 'claude-opus-4-8', // legacy but Active
} as const;

export const ANTHROPIC_VERSION = '2026-10-21';
export const CLAUDE_AGENT_SDK = '@anthropic-ai/claude-agent-sdk@0.3.310';

// Bitdeer (OpenAI-compatible). Model id verified 2026-10-24 (DeepSeek-V4-Pro does NOT exist).
export const BITDEER = {
  baseUrl: 'https://api-inference.bitdeer.ai/v1',
  model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  altModel: 'zai-org/GLM-5.3',
} as const;

// NVD CVE API 2.0. Key (optional) goes in the HTTP header "apiKey:", NOT a query param.
export const NVD = {
  cveUrl: (cveId: string) =>
    `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`,
  groundingCve: 'CVE-2019-6538',
} as const;
