  
![Factory](https://factory-davidgu.github.io/calhacks13/assets/factory-lockup-white.svg)

Start here

# [factory.com](http://factory.com)[↗](https://factory.com/)

Try Droid, then put it in your hack.

Start here←02 / 13→

Slide 2. [factory.com](http://factory.com)

  
Try it now

## Type this prompt in your desktop app

Use the typescript Factory Droid SDK  
to build me:

No desktop app yet?[macOS (Apple Silicon) ↓](https://api.factory.ai/api/desktop?platform=darwin&architecture=arm64)[macOS (Intel) ↓](https://api.factory.ai/api/desktop?platform=darwin&architecture=x64)[Windows ↓](https://api.factory.ai/api/desktop?platform=win32)

Try it now←03 / 13→

Slide 3. Type this prompt in your desktop app

  
01 / Setup

## Set up in one minute

Node 20+ · the droid CLI · an API key

•••[get-started.sh](http://get-started.sh)

```
# 1. Install the Droid CLIcurl -fsSL https://app.factory.ai/cli | sh# 2. Add the SDK to your projectnpm install @factory/droid-sdk# 3. Create a key at app.factory.ai/settings/api-keysexport FACTORY_API_KEY=your-key-here
```

Also get Factory Desktop[macOS (Apple Silicon) ↓](https://api.factory.ai/api/desktop?platform=darwin&architecture=arm64)[macOS (Intel) ↓](https://api.factory.ai/api/desktop?platform=darwin&architecture=x64)[Windows ↓](https://api.factory.ai/api/desktop?platform=win32)

01Install the CLI

The SDK starts droid for you, so it must be on PATH.

02Add the SDK

One package. Node APIs come from @factory/droid-sdk/node.

03Set your key

Create a key at [app.factory.ai/settings/api-keys](http://app.factory.ai/settings/api-keys). The SDK reads it from the environment.

01 / Setup←04 / 13→

Slide 4. Set up in one minute

  
02 / run()

## One prompt, one answer

run(prompt, options?) → Promise&lt;DroidResult&gt;

•••run.ts

```
import { run } from "@factory/droid-sdk/node";const prompt = "Explain what this repository does in one sentence.";const result = await run(prompt);console.log(result.text);
```

01Send a prompt

Droid works in the current directory: it reads files, uses its tools and finishes the task.

02Read the answer

The final text of the agent. run() closes its session for you.

  
03 / Structured output

## Get JSON your code can use

run(prompt, { outputFormat: { type, schema } })

•••structured-output.ts

```
import { OutputFormatType, run } from "@factory/droid-sdk/node";import { z } from "zod/v4";const Triage = z.strictObject({  category: z.enum(["bug", "feature", "question"]),  severity: z.enum(["low", "medium", "high"]),  area: z.string(),});const issue = "The app crashes when I upload a PNG larger than 10 MB.";const prompt = `Classify this issue for triage: ${issue}`;const result = await run(prompt, {  outputFormat: {    type: OutputFormatType.JsonSchema,    schema: z.toJSONSchema(Triage, { target: "draft-7" }),  },});const ticket = Triage.parse(result.structuredOutput);if (ticket.severity === "high") console.log("Page on-call for", ticket.area);
```

01Describe the shape

A Zod schema with fixed labels: the agent must pick from these lists.

02Pass it to run()

Send the schema as JSON Schema with the prompt.

03Branch on typed data

Parse structuredOutput and use it like any other object.

03 / Structured output←06 / 13→

Slide 6. Get JSON your code can use

02 / run()←05 / 13→

Slide 5. One prompt, one answer

  
04 / Sessions

## Keep a conversation going

createSession() → [session.stream](http://session.stream)(prompt)

•••chat.ts

```
import { createSession, DroidMessageType } from "@factory/droid-sdk/node";const session = await createSession();const prompts = ["Find the bug in src/app.ts.", "Fix it and run the tests."];for (const prompt of prompts) {  for await (const message of session.stream(prompt)) {    if (message.type === DroidMessageType.Assistant) console.log(message.text);  }}await session.close();
```

01Open a session

A session keeps context across prompts. Close it when you finish.

02Send follow-ups

The second prompt says “it”. Droid knows it means the bug from the first turn.

03Stream the work

Events arrive as the agent works. Show them live in your UI.

04 / Sessions←07 / 13→

Slide 7. Keep a conversation going



  
05 / Daemon

## Drive it from a web page

Start a Droid daemon on any machine. Your web app connects over a WebSocket and runs sessions there.

droid daemon --port 37643 · connectToDaemon({ url, auth })

01

### Your web app

Import connectToDaemon() from @factory/droid-sdk. It has no Node built-ins, so any bundler can ship it.

→

02

### WebSocket

ws:// to localhost while you build, wss:// to a remote host for the demo.

→

03

### Daemon

Runs the sessions on its host and streams messages back to the page.

Do not put a real API key in a public web page.

05 / Daemon←08 / 13→

Slide 8. Drive it from a web page

  
06 / Use cases

## What you can build this weekend

### An agent in your app

A “fix it” button in a dashboard, an internal tool or a support flow.

### Chat bots

Start work from Discord, Slack or Telegram. Post the result back to the thread.

### Repo tools

Explain a codebase, write onboarding docs or turn an issue into a pull request.

### CI bots

Review pull requests, triage issues with structured output, fix a failing test.

### Multi-agent apps

Run several sessions at once and let one agent hand work to the others.

### Tutors

Read a student’s code, explain each error and suggest the next step.

06 / Use cases←09 / 13→

Slide 9. What you can build this weekend



  
07 / Built on the SDK

## Factory runs on it too

![Factory Desktop with a session list, a Droid session and a code preview](https://factory-davidgu.github.io/calhacks13/assets/built/desktop.jpg)

@factory/daemon-sdk · droid exec

### Desktop and web

Both connect to a Droid daemon with the same client that connectToDaemon() uses.

### The Droid CLI

The droid TUI runs its sessions through the daemon too.

### Slack and Linear

Mention @Factory and the backend starts a session on a Droid computer.

Image: [factory.ai/news/factory-desktop](http://factory.ai/news/factory-desktop)

07 / Built on the SDK←10 / 13→

Slide 10. Factory runs on it too

  
07 / Built on the SDK

## Built by the community

![DROIDEX: a lead agent hands threads to Droid, Claude Code and Codex](https://factory-davidgu.github.io/calhacks13/assets/built/droidex.jpg)

DROIDEXOne desktop app for Droid, Claude Code and Codex. Its sidecar uses ProcessTransport from @factory/droid-sdk.

**DDroid**bot

Why does the login test fail?

Working... (continuing)  
  
→ Grep: 'expiresAt'  
→ Read: src/auth/session.ts  
→ Execute: npm test -- login

The token check compares seconds with milliseconds. I changed `isExpired()` to use seconds, and the login test passes.

droid-telegram-botChat with Droid from Telegram. Each message runs droid exec in stream-json mode. Illustration.

### Meta-harness tools

One app that runs and coordinates many agents.

### Droid in a product

An agent inside a tool your users already open.

### Chat and ops bots

Start work from a chat or a schedule, then report back.

07 / Built on the SDK←11 / 13→

Slide 11. Built by the community

  
Get started

## Go build something

Install

The SDK

npm install @factory/droid-sdk

Examples

Runnable examples

[github.com/Factory-AI/droid-sdk-typescript](http://github.com/Factory-AI/droid-sdk-typescript)

Reference

SDK docs

[docs.factory.ai/sdk/typescript](http://docs.factory.ai/sdk/typescript)

𝕏 @agent\_wrap

Get started←12 / 13→

Slide 12. Go build something  
Get started

## Scan for the SDK

Runnable examples, guides and the API reference for the Droid TypeScript SDK.

[github.com/Factory-AI/droid-sdk-typescript](http://github.com/Factory-AI/droid-sdk-typescript)

![QR code for https://github.com/Factory-AI/droid-sdk-typescript](https://factory-davidgu.github.io/calhacks13/assets/qr-sdk.svg)

Get started←13 / 13→

Slide 13. Scan for the SDK