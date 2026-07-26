// workflows.js
//
// The example agentic workflows the player runs. Everything here is mocked —
// no real model or tool is ever called — but it is written to teach the *real*
// mechanics, not just play a slideshow.
//
// A workflow is a list of `columns`, left to right. A column with ONE stage
// runs on its own; a column with SEVERAL stages runs them **in parallel** (the
// rail fans out into it and merges out of it, and its wall-clock cost is the
// slowest branch, not the sum). Each stage carries:
//   - log/tokens/ms/stream : the mocked run trace shown in the console
//   - detail {algo, libs}  : the real algorithm/protocol + the libraries that
//                            actually implement it, shown in the "under the
//                            hood" panel so you learn what's really happening.
//
// Adding a workflow is purely declarative: one more object in WORKFLOWS.

window.GRW = window.GRW || {};

// ---- icon set (24x24, stroke = currentColor) --------------------------------
window.GRW.ICONS = {
  chat: '<path d="M4 5h16v11H9l-4 4v-4H4z"/>',
  brain: '<circle cx="6.5" cy="12" r="2.3"/><circle cx="16" cy="6.7" r="2.3"/><circle cx="16" cy="17.3" r="2.3"/><path d="M8.7 11l5-3M8.7 13l5 3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  docs: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  vector: '<circle cx="6" cy="6" r="1.3"/><circle cx="12" cy="6" r="1.3"/><circle cx="18" cy="6" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/><circle cx="6" cy="18" r="1.3"/><circle cx="12" cy="18" r="1.3"/><circle cx="18" cy="18" r="1.3"/>',
  rank: '<path d="M5 20V10M12 20V4M19 20v-6"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  shield: '<path d="M12 3l7 3v5c0 4.8-3.4 7.9-7 9-3.6-1.1-7-4.2-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.8 2.8L16 9"/>',
  robot: '<rect x="5" y="8" width="14" height="10" rx="2.2"/><path d="M12 8V4.5M2.5 12.5h2.5M19 12.5h2.5"/><circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6h3a5 5 0 0 1 5 5M8 18h3a5 5 0 0 0 5-5"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  gauge: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4.5-3.5"/><circle cx="12" cy="16" r="1"/>',
  sparkle: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/>',
  send: '<path d="M4 12l16-8-5.5 8L20 20z"/><path d="M14.5 12H4"/>',
  code: '<path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/>',
  scale: '<path d="M12 4v16M7 20h10M6 8h12M6 8l-2.5 6h5zM18 8l-2.5 6h5z"/>',
  ticket: '<path d="M4 7h16v3.2a1.8 1.8 0 0 0 0 3.6V17H4v-3.2a1.8 1.8 0 0 0 0-3.6z"/><path d="M14 7v10"/>',
};

window.GRW.WORKFLOWS = [
  {
    id: "deep-research",
    title: "Deep Research Agent",
    subtitle: "a planner fans out parallel sub-searches, then merges, writes & fact-checks",
    columns: [
      [{ id: "query", icon: "chat", label: "Query", log: 'user → "what drove the 2026 coffee price spike?"', tokens: 19, ms: 120,
        detail: { algo: "Entry to the agent loop — the raw request, before any decomposition or retrieval.", libs: "orchestration: LangGraph · LlamaIndex · DSPy" } }],
      [{ id: "plan", icon: "brain", label: "Planner", log: "planner split the task into 3 parallel sub-questions", tokens: 142, ms: 640,
        detail: { algo: "Query decomposition (plan-and-execute / ReAct). The planner LLM emits a structured plan that breaks the question into independent sub-questions, so they can be researched concurrently.", libs: "function-calling / structured output · LangGraph · DSPy" } }],
      [
        { id: "supply", icon: "search", label: "Supply", log: 'search "arabica supply · Brazil frost 2026" → 6 sources', tokens: 210, ms: 900,
          detail: { algo: "MAP step of map-reduce. An independent sub-agent runs a web/BM25 search and reads the pages. It runs concurrently with its siblings — so the column's latency is the SLOWEST branch (~900ms), not the sum of all three.", libs: "asyncio.gather · Tavily / SerpAPI · trafilatura (HTML→text)" } },
        { id: "demand", icon: "globe", label: "Demand", log: 'search "global coffee demand shift 2026" → 5 sources', tokens: 190, ms: 820,
          detail: { algo: "Parallel branch — same map pattern, a different sub-question. Independent context, no shared state until the reduce. This is why fan-out beats a sequential for-loop here.", libs: "asyncio.gather · Bing / Tavily search API · httpx" } },
        { id: "logistics", icon: "database", label: "Logistics", log: 'search "coffee freight / shipping costs 2026" → 4 sources', tokens: 170, ms: 760,
          detail: { algo: "Parallel branch. Concurrency is bounded by a semaphore / rate limit in practice; results stream back out of order and are gathered at the join.", libs: "asyncio · aiohttp · rate-limiting" } },
      ],
      [{ id: "merge", icon: "filter", label: "Merge + Rerank", log: "merged 15 sources → deduped → reranked → kept top 4", tokens: 120, ms: 520,
        detail: { algo: "REDUCE step. Dedup near-duplicates (URL match, or MinHash / embedding cosine), then cross-encoder rerank: a model scores each (query, passage) pair jointly — far more precise than the retrieval score, but O(n) per candidate, so it runs only on the shortlist.", libs: "sentence-transformers CrossEncoder (bge-reranker) · Cohere Rerank · datasketch (MinHash)" } }],
      [{ id: "synth", icon: "pen", label: "Synthesize", log: "synthesizing a grounded answer from 4 passages…", tokens: 610, ms: 1600, stream: "A Brazilian frost cut arabica yield ~18% and futures rose 38% on the shortfall — compounded by higher freight and a weak Vietnam harvest.",
        detail: { algo: "RAG generation. The LLM writes the answer conditioned ONLY on the top passages, with citation-grounding prompts so every claim traces to a source. Streamed token-by-token.", libs: "the generator LLM · prompt templates · citation formatting" } }],
      [{ id: "verify", icon: "shield", label: "Fact-check", log: "fact-check sub-agent verified 4 / 4 claims ✓", tokens: 233, ms: 1100,
        detail: { algo: "Self-verification. A separate agent extracts each atomic claim and checks it against its cited source via NLI (entailment) or LLM-as-judge, flagging unsupported claims. Measurably cuts hallucination.", libs: "NLI models (DeBERTa-MNLI) · LLM-as-judge · RAGAS (faithfulness)" } }],
      [{ id: "answer", icon: "check", label: "Answer", log: "answer delivered · 4 citations · 3.1s wall-clock", tokens: 0, ms: 90, done: true,
        detail: { algo: "Final assembly — stitch the verified answer together with inline citations and return. Wall-clock is short because the search fan-out ran in parallel.", libs: "—" } }],
    ],
  },
  {
    id: "code-review",
    title: "Multi-Agent Code Review",
    subtitle: "an orchestrator fans a PR diff out to specialist agents running in parallel",
    columns: [
      [{ id: "diff", icon: "code", label: "PR Diff", log: "PR #482 · 7 files · +214 / −38 lines", tokens: 640, ms: 200,
        detail: { algo: "Parse the unified git diff into files + hunks. For deeper checks, build an AST per file so agents reason over structure, not raw text lines.", libs: "git · unidiff · tree-sitter (AST)" } }],
      [{ id: "orch", icon: "branch", label: "Orchestrator", log: "orchestrator fanned the diff out to 3 specialist agents", tokens: 96, ms: 420,
        detail: { algo: "Orchestrator–worker (supervisor) pattern — the heart of agent-to-agent orchestration. One agent dispatches the diff to specialist agents and awaits their results concurrently (a scatter), then gathers them (a gather).", libs: "LangGraph (supervisor) · CrewAI · AutoGen · OpenAI Swarm" } }],
      [
        { id: "security", icon: "shield", label: "Security", log: "security: unparameterized SQL in query()  ⚠", tokens: 320, ms: 1200,
          detail: { algo: "Static analysis + LLM. Scans for injection (SQLi), hardcoded secrets, unsafe deserialization. Rule-based tools catch the known patterns; the LLM adds context the rules miss. Runs in parallel with the other reviewers.", libs: "semgrep · CodeQL · bandit / gosec · gitleaks" } },
        { id: "perf", icon: "gauge", label: "Performance", log: "performance: N+1 query in loadOrders()  ⚠", tokens: 280, ms: 1100,
          detail: { algo: "Detects N+1 queries, hot loops and needless allocations by reasoning over the diff and the call graph. Parallel branch — independent of the security and style agents.", libs: "query analyzers · profilers · LLM reasoning over the AST" } },
        { id: "style", icon: "pen", label: "Style", log: "style: 4 nits · nothing blocking", tokens: 210, ms: 700,
          detail: { algo: "Deterministic linters/formatters plus an LLM for judgment-call nits. The fastest branch (~700ms) — but the column still waits for the slowest (security, ~1200ms) before merging.", libs: "eslint · ruff · prettier · gofmt · golangci-lint" } },
      ],
      [{ id: "agg", icon: "robot", label: "Aggregate", log: "aggregator merged + deduped → 2 blocking, 4 minor", tokens: 180, ms: 620,
        detail: { algo: "REDUCE. Merge the three agents' findings, dedup overlaps (two agents flagging the same line), rank by severity, and resolve conflicting recommendations.", libs: "custom aggregation · LLM for conflict resolution" } }],
      [{ id: "verdict", icon: "check", label: "Verdict", log: "verdict: CHANGES REQUESTED · 2 must-fix before merge", tokens: 0, ms: 90, done: true,
        detail: { algo: "Policy gate — block the merge if any finding is must-fix, else approve. This is where the multi-agent output becomes a single CI decision.", libs: "rule engine · CI status check / branch protection" } }],
    ],
  },
  {
    id: "rag-qa",
    title: "RAG Q&A Pipeline",
    subtitle: "embed → vector search → rerank → grounded generation (a linear pipeline)",
    columns: [
      [{ id: "query", icon: "chat", label: "Question", log: 'user → "how do I rotate an API key without downtime?"', tokens: 21, ms: 110,
        detail: { algo: "The natural-language question, before retrieval. In a chat setting it's first condensed with history into a standalone query.", libs: "query rewriting / condensing prompt" } }],
      [{ id: "embed", icon: "vector", label: "Embed", log: "embedded query → 1024-d vector (bge-large)", tokens: 8, ms: 240,
        detail: { algo: "Bi-encoder embedding. A model maps the query to a dense vector (here 1024-d). The SAME model embedded the corpus offline, so query and documents live in one space where cosine distance ≈ semantic similarity.", libs: "sentence-transformers (bge-large, e5) · OpenAI text-embedding-3" } }],
      [{ id: "vsearch", icon: "database", label: "Vector Search", log: "ANN search over 84k chunks (HNSW) → 20 candidates", tokens: 0, ms: 310,
        detail: { algo: "Approximate nearest-neighbour via HNSW — a layered 'navigable small-world' proximity graph traversed greedily, ~O(log n) per query. Trades a little recall for a huge speed-up over exact search. Alternative: IVF-PQ.", libs: "FAISS · hnswlib · Qdrant · Milvus · pgvector" } }],
      [{ id: "rerank", icon: "filter", label: "Rerank", log: "reranked 20 → 5; dropped 15 below 0.62 threshold", tokens: 44, ms: 420,
        detail: { algo: "Cross-encoder rerank. Re-scores the top-k (query, passage) pairs jointly in one model pass — much more precise than the bi-encoder retrieval score, and affordable because it only runs on the shortlist, not the whole corpus.", libs: "sentence-transformers CrossEncoder · Cohere Rerank · bge-reranker" } }],
      [{ id: "context", icon: "docs", label: "Context", log: "assembled 5 passages · 2.8k tokens · deduped", tokens: 190, ms: 260,
        detail: { algo: "Context assembly — pack the surviving passages into the prompt window, dedup, and order them to mitigate the 'lost in the middle' effect (models attend best to the start and end).", libs: "prompt packing utilities · tokenizer (tiktoken)" } }],
      [{ id: "generate", icon: "sparkle", label: "Generate", log: "generating grounded answer with inline citations…", tokens: 430, ms: 1500, stream: "Create the new key first, deploy it alongside the old one, cut traffic over, then revoke the old key after a grace window. [1][3]",
        detail: { algo: "RAG generation — the LLM answers grounded ONLY in the packed context and emits inline citation markers so the answer is auditable.", libs: "the LLM · citation prompting" } }],
      [{ id: "answer", icon: "check", label: "Answer", log: "answer delivered · grounded in 5 sources · 1.4s", tokens: 0, ms: 80, done: true,
        detail: { algo: "Return the grounded, cited answer to the user.", libs: "—" } }],
    ],
  },
  {
    id: "support-triage",
    title: "Support Ticket Triage",
    subtitle: "classify + retrieve run in parallel, then draft → guardrail → route",
    columns: [
      [{ id: "ticket", icon: "ticket", label: "Ticket", log: 'ticket #9021 → "charged twice for my annual plan"', tokens: 34, ms: 120,
        detail: { algo: "Ticket intake — the raw customer message plus metadata (account, plan, history).", libs: "—" } }],
      [
        { id: "classify", icon: "tag", label: "Classify", log: "classified → Billing · Duplicate charge · P2", tokens: 60, ms: 300,
          detail: { algo: "Text classification — a zero-shot LLM or a small fine-tuned classifier predicts intent + priority. Runs in PARALLEL with KB retrieval, since neither depends on the other's output.", libs: "SetFit · fine-tuned transformer · LLM zero-shot" } },
        { id: "kb", icon: "database", label: "Retrieve KB", log: "retrieved refund policy + 2 similar resolved tickets", tokens: 240, ms: 520,
          detail: { algo: "Retrieval — embedding search over the knowledge base and similar past tickets. Independent of classification, so the two run concurrently and join before drafting.", libs: "FAISS / pgvector · sentence-transformers" } },
      ],
      [{ id: "draft", icon: "pen", label: "Draft Reply", log: "drafting an empathetic, policy-compliant reply…", tokens: 380, ms: 1300, stream: "Thanks for flagging this — I can see the duplicate charge on Jul 3 and I've issued a full refund of $180; it'll land in 5–7 days.",
        detail: { algo: "RAG generation — drafts a reply grounded in the retrieved policy and conditioned on the predicted class, so tone and content match the ticket type.", libs: "the LLM · prompt templates" } }],
      [{ id: "policy", icon: "scale", label: "Policy Check", log: "guardrail: refund ≤ auto-approve limit ✓ · tone ✓", tokens: 120, ms: 480,
        detail: { algo: "Guardrail — a constraint layer checks the drafted action against rules (refund ≤ auto-approve limit) plus a tone/safety classifier, BEFORE anything is sent. This is what makes autonomous action safe.", libs: "Guardrails-AI · NeMo Guardrails · policy rules" } }],
      [{ id: "route", icon: "send", label: "Route", log: "auto-approved · reply sent · ticket resolved", tokens: 0, ms: 90, done: true,
        detail: { algo: "Action — within limits, auto-approve and send the reply; otherwise escalate to a human agent with the draft attached.", libs: "ticketing API (Zendesk / Intercom)" } }],
    ],
  },
];
