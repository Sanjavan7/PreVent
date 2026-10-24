1
Spacetime
CAL HACKS 13.0 · PRE-EVENT WORKSHOP
Move fast and don’t break things.
Build a reactive web app with Spacetime
Tyler Cloutier · CEO, Clockwork Labs
UC BERKELEY · OCT 20, 2026

2
TODAY · 50 MINUTES
The agenda

01 What is Spacetime? (10 MIN)
02 Scrabblebot: an example (10 MIN)
03 How it works (20 MIN)
04 Pro tips (5 MIN)
05 Prizes (5 MIN)
SPACETIME · CAL HACKS 13.0 · 02

3
01 · WHAT IS SPACETIME
A reactive backend.
Like React state, all the way through to the backend.

Call a function. Like setState(), but it runs on the server.
It updates tables. Tables are your state. Each call is one transaction: all of it commits, or none of it.
Every client re-renders. useTable(myTable) gets the change the moment it commits and re-renders.
Diagram: Client (your app frontend) → myFunction() → Spacetime \[Functions (your logic) → Tables (your state) → Subscriptions (live queries)\] → useTable(myTable) → Client

4
01 · WHAT IS SPACETIME
The Zen of Spacetime

01 Everything is a table. All your state, in one place. No cache, no Redis.
02 Everything is persistent. Every change is saved, with the full history.
03 Everything is reactive. Like React state, all the way to the database.
04 Everything is transactional. Every reducer completes fully, or not at all.
05 Everything is programmable. Your functions are regular server endpoints.
5
01 · WHAT IS SPACETIME
Only three features

01 Tables: All of your state. Users, teams, matches, bids.
02 Functions: The only way to change state. Each one is a transaction.
03 Subscriptions: Clients keep a live copy. No fetching, no polling.
Plus procedures to call other APIs, and schedules for background jobs.

6
01 · WHAT IS SPACETIME
Basic example

BACKEND spacetimedb/src/index.ts

ts
import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  person: table({ public: true }, { name: t.string() }),
});
export default spacetimedb;

export const add = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) =&gt; {
    ctx.db.person.insert({ name });
  }
);
FRONTEND src/App.tsx

tsx
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module\_bindings';

export default function App() {
  const \[people\] = useTable(tables.person);
  const add = useReducer(reducers.add);
  return (
    &lt;div&gt;
      &lt;button onClick={() =&gt; add({ name: 'Ada' })}&gt;
        Add Ada
      &lt;/button&gt;
      {people.map((p, i) =&gt; &lt;p key={i}&gt;{p.name}&lt;/p&gt;)}
    &lt;/div&gt;
  );
}
DEVELOP · republishes on every save: $ spacetime dev --template react-ts
PUBLISH · ship it: $ spacetime publish my-app --server maincloud

7
(GIF only, no text)

8
01 · WHAT IS SPACETIME
Sky’s the limit.
Even if you’re building a really big app.

BITCRAFT ONLINE: We built an MMO on Spacetime. 01 Movement, 02 NPCs, 03 Terrain, 04 Inventory, 05 Chat. Every one of them is tables, functions and subscriptions. The same model as the app you just saw.
EVEN VIDEO CHAT: It’s fast enough for video calls. \[QR code\] Watch the demo: youtu.be/zwIc9fFcYVw · youtube.com/@SpacetimeDB
9
01 · WHAT IS SPACETIME
300,000 transactions per second.
The speed comes from tightly integrating your server and database into one system.

System	TPS
Spacetime (TypeScript)	303,920
Spacetime (Rust)	265,541
Node.js + SQLite	3,188
Bun + Postgres	2,773
Node.js + Supabase	2,534
Node.js + Postgres	961
Node.js + PlanetScale (HA)	248
Node.js + PlanetScale (SN)	235
Convex	127
Node.js + CockroachDB	51
Transfer transactions per second, α=1.5, from spacetimedb.com. Single-node Spacetime Standalone. Benchmark code: templates/keynote-2 in the SpacetimeDB repo.

10
02 · SCRABBLEBOT
Scrabblebot
Let’s look at how we built the Scrabblebot app in Spacetime.

WHAT IT IS: A tournament for your bots. Every team builds one bot. All weekend, bots play live matches against each other and climb a rated leaderboard. The tournament is Swiss rounds, then a cut to the top bots, then elimination matches down to a three-game final. SOURCE: github.com/clockworklabs/scrabblebot (branch tyler/typescript-module)
PRIZES: 1st $1024, 2nd $512, 3rd $256. Prizes are awarded based on how you place in the tournament.
HOW TO ENTER:
Make a team at scrabblebot.staging.spacetimedb.com and generate a token.
Run the starter bot. It joins matches on its own and climbs the leaderboard.
Register it for the tournament with the command on the site’s Tournament page.
Keep improving it. You enter the bot, not the code, so restart it with new strategy any time.
12
02 · SCRABBLEBOT
Demo.
scrabblebot.staging.spacetimedb.com

13
03 · HOW IT WORKS
Tables

ts
export const team = table({ public: true }, {
  id: t.u64().primaryKey().autoInc(),
  name: t.string().unique(),
  owner: t.identity(),
  createdAt: t.timestamp(),
});

export const bot = table({ public: true }, {
  id: t.u64().primaryKey().autoInc(),
  teamId: t.u64().index("btree"),
  name: t.string().unique(),
  isSimulated: t.bool(),
});
public: true: Clients can subscribe to it. Without it, the table is private.
unique(): An index and a constraint. Finding a team by name is one call.
index("btree"): Find a team’s bots without a scan: ctx.db.bot.teamId.filter(id).
DON’T BREAK THINGS: Types flow from your tables into your client. Renaming a column propagates that everywhere.

14
03 · HOW IT WORKS
Your tables, in the dashboard
(Screenshot of the Spacetime dashboard showing the bot table)

Tables: Browse and edit tables in your database.
QUERY: Run SQL against it: SELECT \* FROM bot WHERE team\_id = 1.
15
03 · HOW IT WORKS
Your tables, on the command line

# Read your data
$ spacetime sql scrabblebot-staging \\
    "SELECT name, team\_id FROM bot WHERE team\_id &gt; 0"
 name     | team\_id
----------+---------
 "Ada"    | 1
 "Grace"  | 2
 ...
# Change it: SQL writes, or a reducer with its usual checks
$ spacetime sql scrabblebot-staging \\
    "UPDATE bot SET name = 'Grace Hopper' WHERE id = 8"
$ spacetime call scrabblebot-staging create\_team "Golden Bears" oski
# Watch it change
$ spacetime subscribe scrabblebot-staging "SELECT \* FROM bot\_stats"
spacetime sql: Query or edit your data from the terminal. SQL writes need you to own the database.
spacetime call: Call any reducer. It runs the same permission checks as from your app.
agents: Your coding agent can use these, or spacetime mcp, to inspect and fix your app’s data.
16
03 · HOW IT WORKS
Reducers

ts
export const createTeam = spacetimedb.reducer(
  { teamName: t.string(), botName: t.string() },
  (ctx, { teamName, botName }) =&gt; {
    if (ctx.db.team.name.find(teamName)) {
      throw new SenderError("Team name already taken");
    }
    const team = ctx.db.team.insert({
      id: 0n, name: teamName, owner: ctx.sender, createdAt: ctx.timestamp,
    });
    ctx.db.bot.insert({
      id: 0n, teamId: team.id, name: botName, isSimulated: false,
    });
  },
);
// From the client:
conn.reducers.createTeam({ teamName: "Golden Bears", botName: "oski" });
spacetimedb.reducer: A function that clients call, like an endpoint. It runs on the server, next to the data.
ctx.sender: Spacetime automatically provides the identity of the client that sent the message.
conn.reducers: The client calls it with types generated from your module.
DON’T BREAK THINGS: Every reducer is a transaction. If it throws, nothing it wrote ever happened. Every txn is durable also.

17
03 · HOW IT WORKS
Procedures

ts
export const defineWord = spacetimedb.procedure(
  { word: t.string() },
  t.string(),
  (ctx, { word }) =&gt; {
    const url = \`https://api.dictionaryapi.dev/api/v2/entries/en/${word}\`;
    const \[entry\] = JSON.parse(ctx.http.fetch(url).text());
    const text = entry.meanings\[0\].definitions\[0\].definition;
    ctx.withTx((tx) =&gt; {
      tx.db.definition.insert({ word, text });
    });
    return text;
  },
);
// From the client:
const text = await conn.procedures.defineWord({ word: "oxen" });
spacetimedb.procedure: Like a reducer, but it can call other APIs and return a value to the caller.
ctx.http.fetch: Call any HTTP API: an LLM, a payment provider, a dictionary.
ctx.withTx: Write to your tables in a transaction once the request is back.
DON’T BREAK THINGS: Procedures give you an escape hatch to the outside world, while keeping your core logic transactional.

18
03 · HOW IT WORKS
Views &amp; Permissions

ts
// No "public: true", so no client can subscribe to it.
export const holding = table({}, {
  id: t.u64().primaryKey().autoInc(),
  botId: t.u64().index("btree"),
  letter: t.string(),
});
// A view decides what each caller can see.
export const myRack = spacetimedb.view(
  { public: true },
  t.array(holding.rowType),
  (ctx) =&gt; {
    const cred = ctx.db.botCredential.identity.find(ctx.sender);
    return cred ? \[...ctx.db.holding.botId.filter(cred.botId)\] : \[\];
  },
);
public: true: Leave it off and the table is private. No client can subscribe to it.
spacetimedb.view: Rows computed for each caller. Clients subscribe to it like a table.
ctx.sender: Who’s asking, from their signed token. Each bot sees only its own letters.
DON’T BREAK THINGS: Your permissions logic is just a regular function, but views also update transactionally and you can subscribe to them just like tables.

19
03 · HOW IT WORKS
Schedule tables

ts
export const auctionSchedule = table({}, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  matchId: t.u64(),
});

export const auctionTick = spacetimedb.reducer(
  { onSchedule: auctionSchedule },
  { job: auctionSchedule.rowType },
  (ctx, { job }) =&gt; closeAuction(ctx, job.matchId),
);

ctx.db.auctionSchedule.insert({
  scheduledId: 0n, matchId,
  scheduledAt: ScheduleAt.time(closesAt.microsSinceUnixEpoch),
});
t.scheduleAt(): A row with a time is a job. Insert one and it’s queued.
onSchedule: This reducer runs when a row comes due. No jobs, no workers, no queue service.
ScheduleAt: Run once at a time, or on an interval. Delete the row to cancel it.
DON’T BREAK THINGS: Jobs are rows in tables, so they’re persistent. Each runs as a transaction.

20
03 · HOW IT WORKS
Publishing

# While you build: rebuild and republish on every save
$ spacetime dev

# Ship it
$ spacetime login
$ spacetime publish my-app --server maincloud
Checking for breaking changes...
Publishing module...
Created new database with name: my-app

# Change your schema and publish again
$ spacetime publish my-app --server maincloud
Checking for breaking changes...
Updated database with name: my-app
spacetime dev: Watches your code, republishes on every save, and runs your frontend dev server.
spacetime publish: Uploads your module. The same command does the first deploy and every update.
--server maincloud: Hosted, with a free tier, and scales to zero. Or publish to a server you run.
DON’T BREAK THINGS: You can publish your server backend code without disconnecting any clients. We call this server hotswapping.

21
03 · HOW IT WORKS
Subscribing the client

tsx
import { useTable } from "spacetimedb/react";
import { tables } from "./module\_bindings";

function Leaderboard() {
  const \[stats\] = useTable(tables.botStats.where(r =&gt; r.matchesPlayed.gt(0)));
  const ranked = \[...stats\].sort((a, b) =&gt; b.rating - a.rating);
  return &lt;Standings rows={ranked} /&gt;;
}

// Without React:
conn.subscriptionBuilder()
  .onApplied(() =&gt; console.log("Live"))
  .subscribe(tables.botStats);
conn.db.botStats.onUpdate((ctx, oldRow, newRow) =&gt; redraw(newRow));
No fetch. No cache invalidation. No loading spinners. No refresh button.
When a reducer commits, every subscribed client updates.

DON’T BREAK THINGS: Clients receive each transaction in real-time as the data changes.

22
03 · HOW IT WORKS
Templates

$ spacetime dev --template react-ts

my-app/
├── spacetimedb/src/index.ts    # your module
├── src/App.tsx                 # your React app
├── src/module\_bindings/        # generated from your module
├── spacetime.json
└── package.json
Logos: React, Next.js, Vue, Svelte, Angular, Remix, Solid, Nuxt

--template react-ts: A working app in one command: module, React client and bindings, wired up.
nextjs-ts, vue-ts, …: Next.js, Vue, Svelte, Angular, Remix, Solid, Nuxt and more.
llm-chat-ts: Or start from a whole app: chat, LLM chat, hangman, a money exchange.
DON’T BREAK THINGS: The bindings are generated from your module, so the client’s types always match the server’s.

23
03 · HOW IT WORKS
Submodules

ts
import { schema } from "spacetimedb/server";
import \* as auth from "auth-lib";
import { player } from "./tables";

export default schema({
  player,
  auth, // auth-lib's tables, reducers and views
});
// In your reducers:
const user = ctx.db.auth.user.identity.find(ctx.sender);
IDEAS: WRAP ANY SERVICE AS A SUBMODULE: Stripe (payments), Claude (LLMs), Resend (email), Twilio (SMS), Slack (chat), GitHub (webhooks)

import \* as auth: A submodule is just another module, used as a library.
schema({ auth }): Its tables, reducers and views mount under a namespace you pick.
ctx.db.auth.user: Use its tables from your own code, with full types.
DON’T BREAK THINGS: A submodule’s tables live in its own namespace, so a library can’t collide with yours.

25
04
Pro tips.
Convex · Coding agents · Claude · Maincloud

26
04 · PRO TIPS
Coming from Convex?

Convex	Spacetime
Query	View + subscription
Mutation	Reducer
Action	Procedure
Scheduler and crons	Scheduled tables and crons
WHAT YOU ALSO GET:

1000x faster code and 10x cheaper apps
Relational tables with indexes and joins
Modules in TypeScript, Rust, C# or C++
27
04 · PRO TIPS
Your coding agent already knows Spacetime

# New project: agent rules come in the box
$ spacetime init --template react-ts my-app
#   CLAUDE.md  AGENTS.md  .cursor/rules/  .windsurfrules
#   .github/copilot-instructions.md

# Claude Code: Spacetime skills + an MCP server
$ claude plugin marketplace add clockworklabs/SpacetimeDB
$ claude plugin install spacetimedb@spacetimedb-plugins

# Cursor, Codex and other agents: the same skills
$ npx -y skills add \\
    https://github.com/clockworklabs/SpacetimeDB/tree/master/skills \\
    --skill '\*' --yes --global
spacetime init: New projects ship rules for Claude Code, Cursor, Windsurf, Copilot and Codex.
skills: The plugin loads the server and client guides only when the agent needs them.
spacetime mcp: Your agent can read the schema, run SQL and call reducers on your database.
DON’T BREAK THINGS: If the agent writes a breaking schema change, publish stops before it touches your data.

28
04 · PRO TIPS
Call Claude from your backend

ts
export const ask = spacetimedb.procedure({ prompt: t.string() }, t.string(),
  (ctx, { prompt }) =&gt; {
    const reply = askClaude(ctx, ctx.env.ANTHROPIC\_API\_KEY, prompt);
    ctx.withTx((tx) =&gt; tx.db.message.insert({ id: 0n, prompt, reply }));
    return reply;
  });

function askClaude(ctx: ProcedureCtx&lt;any&gt;, key: string, prompt: string) {
  const res = ctx.http.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    timeout: TimeDuration.fromMillis(120\_000),
    headers: { "x-api-key": key,
               "anthropic-version": "2023-06-01",
               "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-5-5",
                           max\_tokens: 4096,
                           messages: \[{ role: "user", content: prompt }\] })
  });
  return res.json().content.find((b: any) =&gt; b.type === "text").text;
}
ctx.http.fetch: Plain HTTP from a procedure. It times out at 30 s unless you raise it, up to 180 s.
ctx.env: Set it when you publish: ANTHROPIC\_API\_KEY=... spacetime publish.
message: A public table, so every subscribed client sees each answer as soon as it’s saved.
29
04 · PRO TIPS
Agents as clients

ts
import Anthropic from "@anthropic-ai/sdk";
import { DbConnection, tables } from "./module\_bindings";

const claude = new Anthropic(); // reads ANTHROPIC\_API\_KEY
DbConnection.builder()
  .withUri("https://maincloud.spacetimedb.com").withDatabaseName("my-app")
  .onConnect((conn) =&gt; {
    conn.subscriptionBuilder().subscribe(tables.question);
    conn.db.question.onInsert(async (\_ctx, q) =&gt; {
      const msg = await claude.messages.create({
        model: "claude-opus-5-5",
        max\_tokens: 16000,
        messages: \[{ role: "user", content: q.text }\]
      });
      const text = msg.content.find((b) =&gt; b.type === "text")?.text ?? "";
      conn.reducers.saveAnswer({ questionId: q.id, text });
    });
  })
  .build();
subscribe: The agent is just another client. It sees each new question the moment it’s inserted.
@anthropic-ai/sdk: Use the official SDK, with streaming, local models and no 180-second limit.
saveAnswer: It writes back through a reducer, so your module still decides what it may change.
30
04 · PRO TIPS
Host it on Maincloud

MAINCLOUD FREE: $0 a month. 2,500 TeV a month. About 3M function calls. Pauses after a week idle.
MAINCLOUD PRO: $25 a month. 100,000 TeV a month. About 120M function calls. Replication and backups.
EVERY CAL HACKS HACKER GETS: 100,000 TeV free, a month of Pro’s energy. Code: CALHACKS13 · spacetimedb.com/redeem
TeV is Maincloud’s energy: it pays for function calls, egress and storage. Deploy with: spacetime publish my-app --server maincloud

31
05 · PRIZES
Two ways to win.

Best use of Spacetime (1ST $2048 · 2ND $1024 · 3RD $512): Build anything: a web app, a game, an agent. We’re judging what Spacetime made possible.
Scrabblebot tournament (1ST $1024 · 2ND $512 · 3RD $256): Will you hoist the crown?
32 (closing)
Spacetime
Move fast and don’t break things.

DOCS: spacetimedb.com/docs
SCRABBLEBOT: github.com/clockworklabs/scrabblebot
FIND US: Our booth at the Palace of Fine Arts, Oct 23–25
QUESTIONS?

A few notes:

Page numbers 11 and 24 never appeared while paging through the presentation, so those slides are probably hidden from presenting. Figma kept stalling when I tried to open them in the editor.
The tiniest text (the YouTube link on slide 8, the branch name on slide 10, the benchmark footnote on slide 9) came from a small render, so double-check those before relying on them.
While I was clicking through, the Figma page wrote something to your clipboard on its own, so check it before you paste anything.
