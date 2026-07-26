# agent-flow

**Watch agentic-AI workflows execute — the shape of a real agent-to-agent run, fully mocked.**

Pick a pipeline (deep research, RAG Q&A, multi-agent code review, support triage)
and press play. Sequential steps light up one at a time; independent steps **fan
out and run in parallel**; an agent console streams the trace; and an **"under
the hood"** panel explains the *real* algorithm and libraries behind each step —
so a completely mocked run reads like watching a real, sophisticated agent work.

![agent-flow — a deep-research agent pipeline executing: a planner fans out three parallel sub-searches, the rail merges them into a reranker, then a grounded synthesis streams out, with a live "under the hood" panel naming the real algorithm and libraries for each step and a streaming agent console](docs/workflow.gif)

> **New here?** The **[intro page](https://agent-flow.pulsar-projects.org/about)**
> is a ~60-second briefing: a few core ideas, then the anatomy of a real
> agent-to-agent system and where each piece shows up in the simulator.

## It's all mocked — that's the point

There are **no live model or tool calls anywhere** — no API keys, no network, no
tokens spent, nothing leaves your browser. Every workflow is a deterministic,
hand-authored timeline (`ui/workflows.js`) written to read like a genuine
execution trace: realistic tool results, streamed generations, token counts and
latencies. The value is the *simulation* — a clean, legible way to see how an
agentic pipeline actually unfolds, that runs instantly, for free, offline, and
identically every time.

What's **mocked** is the run; what's **real** is the shape — the stages and their
order, the parallel fan-out / fan-in, and the algorithms and libraries named in
"under the hood." Think of it as a wiring diagram you can press play on.

## What you're looking at

**The board — sequential vs parallel.** Columns run left → right. A single-stage
column runs on its own; a multi-stage column (inside a dashed **∥ parallel** lane)
runs its agents **concurrently** — the rail fans out into it and merges back out.

```
   Query ─▶ Planner ─┬─▶ Supply     ─┐
                     ├─▶ Demand      ─┼─▶ Merge+Rerank ─▶ Synthesize ─▶ Fact-check ─▶ Answer
                     └─▶ Logistics   ─┘
                     └──── ∥ parallel ×3 ────┘
     sequential          run concurrently                    sequential

   ELAPSED = the slowest branch (max), not the sum   ·   TOKENS = every stage, summed
```

That timing math is the whole reason to orchestrate agents concurrently instead
of chaining them: three searches that would cost `900 + 820 + 760 ms` in a loop
cost `max = 900 ms` in parallel — and the meters show exactly that.

**"Under the hood."** As each step runs, this panel names the *real* algorithm /
protocol behind it — map-reduce fan-out, HNSW approximate-nearest-neighbour,
cross-encoder reranking, the orchestrator-worker pattern, NLI fact-checking,
guardrails — and the libraries that implement it (FAISS, sentence-transformers,
semgrep, LangGraph, …). It's there to *teach*, so the simulator isn't just a
slideshow.

**Agent console.** A streaming, structured trace of the run: each stage logs its
step, generations type out token-by-token, and parallel columns are marked with a
fan-out header.

**Transport & layout.** Play / pause (with a real icon toggle), step forward /
back, and a scrubber; keyboard `space` / `←` / `→` / `t`. On a wide screen the
whole player locks into a one-frame **cockpit** — diagram, panels and slider all
visible with no page scroll — and falls back to a normal vertical scroll on
short / mobile screens.

## The workflows

| Workflow | What runs | Parallelism |
|---|---|---|
| **Deep Research Agent** | query → plan → 3 web searches → merge + rerank → synthesize → fact-check → answer | a planner fans out **3 concurrent sub-searches**, then merges |
| **Multi-Agent Code Review** | PR diff → orchestrator → security / performance / style → aggregate → verdict | an orchestrator fans a diff out to **3 specialist agents** in parallel |
| **RAG Q&A Pipeline** | embed → vector search (HNSW) → rerank → context → grounded generation → answer | fully **sequential** — the contrast case |
| **Support Ticket Triage** | ticket → classify + retrieve → draft → policy guardrail → route | **classify & KB-retrieval run concurrently**, then join |

## How it's built

- **Pure front-end, zero dependencies, zero build step.** Vanilla HTML / CSS / JS
  — no framework, no bundler. The board is DOM for the stage cards plus a single
  **SVG overlay** for the fan-out / fan-in connectors (and the packets that fly
  along them), so the icons stay crisp and the motion stays smooth. The stage
  glow, streaming typewriter, and count-up meters are all hand-rolled.
- **Declarative workflows.** Each pipeline is data in `ui/workflows.js`; the
  player (`ui/app.js`) renders the columns, wires the connectors, and drives
  playback column by column.
- **Light + dark themes**, following `prefers-color-scheme` with a manual toggle,
  persisted in `localStorage` and shared across the player and intro pages.
- Design language shared with the companion portfolio site: a calm,
  instrument-panel aesthetic — mono chrome, one blue accent, thin hairlines, and
  corner-bracket "scan target" framing.

## Run it

**Live:** https://agent-flow.pulsar-projects.org  ·  **Intro:** https://agent-flow.pulsar-projects.org/about

Locally it's just static files — no build required to preview:

```bash
git clone https://github.com/Chitransh-Saxena/agent-flow
cd agent-flow
python3 -m http.server 8000   # then open http://localhost:8000/ui/
```

To assemble the exact bundle that gets deployed (into `deploy/`):

```bash
bash scripts/build-site.sh    # copies ui/ → deploy/ ; deploy with `wrangler deploy`
```

## Project layout

```
ui/index.html      the player
ui/about.html      the intro / concepts page
ui/workflows.js    the workflows (declarative data — no logic)
ui/app.js          the player: columns, SVG connectors, column-by-column playback
ui/style.css       the shared "Calm Console" styles
scripts/build-site.sh   assembles deploy/
```

## Add a workflow

Adding one is purely declarative — append an object to `WORKFLOWS` in
`ui/workflows.js`:

```js
{
  id: "my-workflow",
  title: "My Workflow",
  subtitle: "one line describing the run",
  columns: [
    // a single-stage column runs on its own …
    [{ id: "in", icon: "chat", label: "Input", log: "…", tokens: 20, ms: 120,
       detail: { algo: "what really happens here", libs: "the libraries that do it" } }],

    // … a multi-stage column runs its stages IN PARALLEL (fan-out / fan-in)
    [
      { id: "a", icon: "search", label: "Branch A", log: "…", tokens: 200, ms: 900, detail: { algo: "…", libs: "…" } },
      { id: "b", icon: "globe",  label: "Branch B", log: "…", tokens: 180, ms: 820, detail: { algo: "…", libs: "…" } },
    ],

    [{ id: "out", icon: "check", label: "Answer", log: "done", tokens: 0, ms: 80, done: true,
       detail: { algo: "…", libs: "—" } }],
  ],
}
```

Each stage carries its console `log`, mock `tokens` / `ms`, an optional `stream`
for a typed-out generation, an optional `done` flag, and a `detail` object
(`algo` + `libs`) for the "under the hood" panel. Parallel columns cost `max(ms)`
in elapsed time and `sum(tokens)` in tokens, automatically. The player picks the
workflow up on reload — pick your `icon` names from the `ICONS` map at the top of
the file.

## License

MIT — see [LICENSE](LICENSE).
