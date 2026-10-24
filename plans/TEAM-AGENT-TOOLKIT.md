# TEAM AGENT TOOLKIT — MCPs, plugins, skills & CLIs per person

> So every teammate's **coding agent** (Claude Code / Codex) has exactly what it needs for the PreVent stack.
> **How to use:** each person installs the items in **Everyone** + **their own dev section** on *their* machine. Installs change your machine, so review before running (especially the ⚠️ unverified/community ones). **Secrets never go in the repo** — keys live in your local `.env` / env vars, referenced as `${VAR}`.
> **House rules that shape these picks:** prefer a **CLI over an MCP** when both exist (fewer context tokens); model IDs only from `contracts/src/models.ts`; no AI/attribution lines in commits.

---

## ✅ Everyone (all 4)

- **ctx7 (current library docs)** — `npx ctx7@latest setup --cli --claude` (writes the `find-docs` skill; OAuth login, or `export CONTEXT7_API_KEY=...`). Then use `npx ctx7@latest library "<name>" "<topic>"` → `npx ctx7@latest docs </org/project> "<topic>"`. *Use before writing against any library — training data is stale.*
- **`claude-api` skill** — bundled in Claude Code (`/claude-api`). Invoke before writing any Claude/Anthropic call; never answer model IDs/pricing from memory.
- **`gh` CLI** — each teammate runs `gh auth login` (the repo's existing auth is only on Chris's machine). Prefer `gh` over the GitHub MCP (4–32× fewer tokens).
- **LSP plugin for your language** (cuts hallucinated APIs — big win): `claude plugin install typescript-lsp@claude-plugins-official` (DEV1/DEV3 + bridge/emulator), `pyright-lsp` (DEV2), `clangd-lsp` (HARDWARE firmware). Prereq e.g. `npm i -g typescript-language-server typescript` / `pip install pyright`.
- **One-time repo tailoring:** `claude plugin install claude-code-setup@claude-plugins-official` → it inspects the repo and recommends hooks/skills/MCP/subagents. Also run `/skills` and `claude mcp list` to see what you already have.
- **Plugin basics:** `claude plugin marketplace add anthropics/claude-plugins-official` → `claude plugin install <name>@claude-plugins-official` → `/reload-plugins`. Check cost with `claude plugin details <name>`; install sparingly.
- ⚠️ **Avoid** the `commit-commands` plugin's default attribution lines (our commits must not mention AI).

---

## 🧠 DEV 1 — Pipeline & Agents

**Keys:** `ANTHROPIC_API_KEY`, `FACTORY_API_KEY` (funded). **ctx7 queries:** "Claude Agent SDK", "@factory/droid-sdk".

- **Claude Agent SDK** — `@anthropic-ai/claude-agent-sdk@0.3.310` (already pinned). Do **not** skip optional deps (it bundles a Claude Code binary). It does **not** auto-load `.env` → use `dotenv` yourself. `ANTHROPIC_API_KEY` from env.
- **`agent-sdk-dev` plugin** — `claude plugin install agent-sdk-dev@claude-plugins-official`. Gives `/new-sdk-app` + **SDK-correctness verifier agents** (run them on `agents/`).
- **Agent SDK docs to WebFetch** (append `.md`): `.../agent-sdk/hooks` (PreToolUse deny = the sandbox-refusal beat), `/user-input` (`canUseTool` = human gate), `/streaming-output` (`includePartialMessages` → `text_delta`), `/custom-tools` (`tool()`+`createSdkMcpServer` = `report_decision`), `/mcp`, `/structured-outputs`. Full index: `code.claude.com/docs/llms.txt`.
- **Reference repos to clone:** `Factory-AI/droid-sdk-typescript` (read `docs/typescript-sdk-reference.md` + `examples/node/*`), `anthropics/claude-agent-sdk-demos` (`research-agent`, `ask-user-question-previews`).
- **Factory `@factory/droid-sdk@0.10.0`** — `createSession({cwd}).stream(prompt)`; branch on `result.subtype` (`success|interrupted|error_*`). **Give the patch agent extra tools per session:** `createSession({ cwd, mcpServers:[...], permissionHandler })` (external MCP) or `createSdkMcpServer`+`tool` (in-process — e.g. expose **Dev 2's verifier / NVD lookup** to Droid). Without a `permissionHandler`, MCP tool calls silently cancel.
- **Factory plugins for the patch agent** — `droid plugin marketplace add https://github.com/Factory-AI/factory-plugins` → `droid plugin install security-engineer@factory-plugins --scope project` (skills: **vulnerability-validation**, security-review). Author your own `device-service/.factory/skills/patch-missing-auth/SKILL.md`.
- **`mcp-server-dev` plugin** (optional) — if you wrap the device-service/verifier as an MCP server for the SDK agent.
- **Add MCP to Claude Code:** `claude mcp add --transport stdio --env K=v <name> -- <cmd>` / `--transport http <name> <url> -H "Authorization: Bearer ${TOKEN}"`; `-s project` writes a shareable `.mcp.json`.

---

## 🛡️ DEV 2 — Security & Verification

**Keys:** `BITDEER_API_KEY`, `NVD_API_KEY` (optional). **ctx7 queries:** "Semgrep", "Bandit", "NVD API 2.0". **LSP:** `pyright-lsp`.

- **Semgrep + Bandit (CLI, local — no account, no egress — preferred):** `uv tool install --python 3.13 semgrep==1.182.1` and `bandit==1.9.4` (Python **3.11–3.13**, not the 3.15 default). Call via Bash → JSON for the pipeline: `semgrep scan --config device-service/rules --json ...`; `bandit -r device-service -f json -o bandit.json --exit-zero`.
- **Trail of Bits `static-analysis` plugin + rule skills** — `/plugin marketplace add trailofbits/skills` → `/plugin install static-analysis@trailofbits`. Best-fit skills: **`semgrep-rule-creator`** (author the CWE-306 ground-truth rule), `variant-analysis` (find sibling vulns for the verify loop), `insecure-defaults`, **`differential-review`** (review the Factory Droid patch diff), `sharp-edges`.
- **`claude-security` plugin** (optional second detector) — `/plugin install claude-security@claude-plugins-official` → `/claude-security scan` (LLM threat-model + verified findings + patch suggestions; costs tokens). A nice pitch cross-check against your Semgrep/Bandit pipeline.
- ⚠️ **Semgrep Guardian plugin** exists but its remote mode **uploads your files to scanner.semgrep.ai** — for a security project, prefer the local CLI above.
- **Bitdeer (exploit-gen)** — OpenAI-compatible: Python `openai` client, `base_url=https://api-inference.bitdeer.ai/v1`, `Authorization: Bearer`, model `deepseek-ai/DeepSeek-V4.1-Flash`. See Bitdeer's **Integrations guide** (Cursor/Claude/Codex) + the workshop demo code. Get the key via the **credit-request form** at bitdeer.ai.
- **NVD/CVE** — just `curl "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2019-6538"` (keyless works; `apiKey:` header raises limits) and **cache the JSON**. `OSV.dev` (`curl https://api.osv.dev/v1/vulns/<id>`) for dependency CVEs. Skip the NVD MCP (thin/stale).
- **Python Claude** (if a Python stage calls Claude directly) — `pip install claude-agent-sdk`, or headless `claude -p "<prompt>" --output-format json`.

---

## 📊 DEV 3 — Realtime, Dashboard & Sim

**Keys:** none for SpacetimeDB (local); `npx convex login` only if using the fallback. **ctx7 queries:** "SpacetimeDB 2.13 TS", "React 19", "PixiJS 8", "Tailwind 4", "Vite 8". **LSP:** `typescript-lsp`.

- **SpacetimeDB one-shot agent setup** — paste into Claude Code: *"Follow https://spacetimedb.com/agent-setup.md to set yourself up to work with SpacetimeDB."* It installs the **plugin** (`claude plugin marketplace add clockworklabs/SpacetimeDB` → `claude plugin install spacetimedb@spacetimedb-plugins --scope user`) which bundles **11 skills** (notably `typescript-server`, `typescript-client`, `concepts`, `cli`, `mcp`) **+ the `spacetime mcp` server** (get_schema / sql / call / list_databases — mark UNSTABLE, fall back to `spacetime sql`/`spacetime call`).
- **spacetime CLI** — Windows `irm https://windows.spacetimedb.com -useb | iex` → new terminal → `spacetime install 2.13.0`. `spacetime init --template react-ts` ships CLAUDE.md/AGENTS.md/.cursor rules. **Redeem `CALHACKS13`** at spacetimedb.com/redeem (free Maincloud).
- **Convex (fallback)** — `/plugin install convex@claude-plugins-official` (bundles MCP + hooks + skills + AI rules), or `npx convex ai-files install` (writes Convex rules into CLAUDE.md/AGENTS.md) + `claude mcp add convex -- npx -y convex@latest mcp start`. (ESP32 client `convex/convex-esp32` is **not** for the UNO — host-side TS client only.)
- **PixiJS v8 skills** — `/plugin marketplace add pixijs/pixijs-skills` (stops the agent writing v7 APIs: `Application.init()`, scene graph, ticker, filters).
- **React/UI skills** — `npx skills add vercel-labs/agent-skills` (`vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`); the built-in **`dataviz`** skill (invoke before any chart/KPI/sparkline); `frontend-design` plugin. Tailwind v4 via ctx7 (`library "Tailwind CSS" "v4 @theme vite plugin"`).
- **Demo capture** — `playwright-cli` (`npm i -g @playwright/cli` → `playwright-cli install --skills`): drive/test the app, `video-start demo.webm --cursor --fps=60` with `video-chapter`. **OBS** for the final board+dashboard video (`ffmpeg` is installed for compressing).

---

## 🔌 HARDWARE — Actuation, bridge & emulator

**ctx7 queries:** "serialport 13", "arduino-cli". **LSP:** `clangd-lsp` (for the `.ino`).

- **arduino-cli** — `scoop install arduino-cli` (or the Windows MSI). Setup: `arduino-cli config init; arduino-cli core install arduino:avr; arduino-cli board list`. Build/flash: `arduino-cli compile --fqbn arduino:avr:uno firmware/uno_actuator` → `arduino-cli upload -p COM3 --fqbn arduino:avr:uno firmware/uno_actuator`. ⚠️ arduino-cli needs the sketch in a folder whose **name matches the .ino** → put it at `firmware/uno_actuator/uno_actuator.ino`. Baud 115200.
- **Add a hardware rule** to the repo CLAUDE.md so the agent always uses the right FQBN/port/baud: `arduino:avr:uno`, `COM3`, `115200`.
- **serialport testing (no board)** — use `SerialPortMock` / `@serialport/binding-mock` (already in `serial-bridge` via `serialport@13.0.0`) to drive the **emulator** and test the bridge hardware-free.
- **SpacetimeDB client in the bridge** — the `typescript-client` skill from the SpacetimeDB plugin covers `DbConnection.builder()` + subscriptions.
- ⚠️ **Arduino/serial MCPs** (niradler/arduino-mcp, Volt23/mcp-arduino-server) are all low-adoption and unverified — **prefer arduino-cli + the repo's `serial-bridge`**. `bmdragos/serial-mcp` is **Mac-only**.

---

## Notes & cautions
- **`security-guidance` / `claude-security`** will flag the **intentionally vulnerable** `device-service/` — scope or disable them there so they don't fight the demo.
- A shared **project-scope `.mcp.json`** (committed, `${ENV}` placeholders, **no secrets**) can give everyone the same sponsor MCP baseline — but since we prefer CLIs, keep it minimal (e.g. only `spacetimedb`/`convex` if wanted).
- ⚠️ Items marked unverified above were found but not install-tested — confirm with `--help` / the plugin's `details` pane before relying on them.
