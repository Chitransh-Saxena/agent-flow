// workflows.js
//
// The example agentic workflows the player runs. Everything here is mocked —
// no real model or tool is ever called (see the project's mock_llm seam) — but
// each timeline is written to read like a real execution trace: a sequence of
// steps, each belonging to a stage, carrying a console line and mock
// token/latency numbers. The player just walks the `steps` array.
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
  tool: '<path d="M14.5 6.5a3.8 3.8 0 0 1-5 5L5 16l3 3 4.5-4.5a3.8 3.8 0 0 0 5-5l-2.2 2.2-2.6-.7-.7-2.6z"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6h3a5 5 0 0 1 5 5M8 18h3a5 5 0 0 0 5-5"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  gauge: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4.5-3.5"/><circle cx="12" cy="16" r="1"/>',
  sparkle: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/>',
  send: '<path d="M4 12l16-8-5.5 8L20 20z"/><path d="M14.5 12H4"/>',
  code: '<path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4"/>',
  bug: '<rect x="8" y="9" width="8" height="9" rx="4"/><path d="M8 12H4M20 12h-4M8 16H4M20 16h-4M9.5 9L7.5 6M14.5 9l2-3M12 9V6"/>',
  scale: '<path d="M12 4v16M7 20h10M6 8h12M6 8l-2.5 6h5zM18 8l-2.5 6h5z"/>',
  ticket: '<path d="M4 7h16v3.2a1.8 1.8 0 0 0 0 3.6V17H4v-3.2a1.8 1.8 0 0 0 0-3.6z"/><path d="M14 7v10"/>',
};

// ---- the workflows ----------------------------------------------------------
window.GRW.WORKFLOWS = [
  {
    id: "deep-research",
    title: "Deep Research Agent",
    subtitle: "plans, searches, ranks, writes, and fact-checks a cited answer",
    stages: [
      { id: "query", icon: "chat", label: "Query" },
      { id: "plan", icon: "brain", label: "Planner" },
      { id: "search", icon: "search", label: "Web Search" },
      { id: "retrieve", icon: "docs", label: "Retrieve" },
      { id: "rank", icon: "rank", label: "Rerank" },
      { id: "write", icon: "pen", label: "Synthesize" },
      { id: "verify", icon: "shield", label: "Fact-check" },
      { id: "answer", icon: "check", label: "Answer" },
    ],
    steps: [
      { stage: "query", log: 'user → "what drove the 2026 coffee price spike?"', tokens: 19, ms: 120 },
      { stage: "plan", log: "planner decomposed the task into 3 sub-questions", tokens: 142, ms: 640 },
      { stage: "search", log: 'web_search("coffee price 2026 drivers") → 14 results', tokens: 74, ms: 900 },
      { stage: "retrieve", log: "fetched + parsed 9 pages · 6.2k tokens of context", tokens: 812, ms: 1400 },
      { stage: "rank", log: "cross-encoder reranked 9 sources → kept top 4", tokens: 55, ms: 380 },
      { stage: "write", log: "synthesizing a grounded answer from 4 passages…", tokens: 610, ms: 1600, stream: "A Brazilian frost in July cut arabica yield ~18%, and futures rose 38% on the shortfall — compounded by higher freight and a weak harvest in Vietnam." },
      { stage: "verify", log: "fact-check sub-agent verified 4 / 4 claims ✓", tokens: 233, ms: 1100 },
      { stage: "answer", log: "answer delivered · 4 citations · 2.1s wall-clock", tokens: 0, ms: 90, done: true },
    ],
  },
  {
    id: "rag-qa",
    title: "RAG Q&A Pipeline",
    subtitle: "embed → vector search → rerank → grounded generation",
    stages: [
      { id: "query", icon: "chat", label: "Question" },
      { id: "embed", icon: "vector", label: "Embed" },
      { id: "vsearch", icon: "database", label: "Vector Search" },
      { id: "rerank", icon: "filter", label: "Rerank" },
      { id: "context", icon: "docs", label: "Context" },
      { id: "generate", icon: "sparkle", label: "Generate" },
      { id: "answer", icon: "check", label: "Answer" },
    ],
    steps: [
      { stage: "query", log: 'user → "how do I rotate an API key without downtime?"', tokens: 21, ms: 110 },
      { stage: "embed", log: "embedded query → 1024-d vector (bge-large)", tokens: 8, ms: 240 },
      { stage: "vsearch", log: "ANN search over 84k chunks (HNSW) → 20 candidates", tokens: 0, ms: 310 },
      { stage: "rerank", log: "reranked 20 → 5; dropped 15 below 0.62 threshold", tokens: 44, ms: 420 },
      { stage: "context", log: "assembled 5 passages · 2.8k tokens · deduped", tokens: 190, ms: 260 },
      { stage: "generate", log: "generating grounded answer with inline citations…", tokens: 430, ms: 1500, stream: "Create the new key first, deploy it alongside the old one, cut traffic over, then revoke the old key after a grace window. [1][3]" },
      { stage: "answer", log: "answer delivered · grounded in 5 sources · 1.4s", tokens: 0, ms: 80, done: true },
    ],
  },
  {
    id: "code-review",
    title: "Multi-Agent Code Review",
    subtitle: "an orchestrator fans a diff out to specialist review agents",
    stages: [
      { id: "diff", icon: "code", label: "PR Diff" },
      { id: "orchestrate", icon: "branch", label: "Orchestrator" },
      { id: "security", icon: "shield", label: "Security" },
      { id: "perf", icon: "gauge", label: "Performance" },
      { id: "style", icon: "pen", label: "Style" },
      { id: "aggregate", icon: "robot", label: "Aggregate" },
      { id: "verdict", icon: "check", label: "Verdict" },
    ],
    steps: [
      { stage: "diff", log: "PR #482 · 7 files · +214 / −38 lines", tokens: 640, ms: 200 },
      { stage: "orchestrate", log: "orchestrator fanned out to 3 specialist agents", tokens: 96, ms: 420 },
      { stage: "security", log: "security agent: found 1 issue — unparameterized SQL ⚠", tokens: 320, ms: 1200 },
      { stage: "perf", log: "performance agent: N+1 query in loadOrders() ⚠", tokens: 280, ms: 1100 },
      { stage: "style", log: "style agent: 4 nits · no blocking issues", tokens: 210, ms: 700 },
      { stage: "aggregate", log: "aggregator merged + deduped → 2 blocking, 4 minor", tokens: 180, ms: 620 },
      { stage: "verdict", log: "verdict: CHANGES REQUESTED · 2 must-fix before merge", tokens: 0, ms: 90, done: true },
    ],
  },
  {
    id: "support-triage",
    title: "Support Ticket Triage",
    subtitle: "classify → retrieve policy → draft → guardrail → route",
    stages: [
      { id: "ticket", icon: "ticket", label: "Ticket" },
      { id: "classify", icon: "tag", label: "Classify" },
      { id: "kb", icon: "database", label: "Knowledge Base" },
      { id: "draft", icon: "pen", label: "Draft Reply" },
      { id: "policy", icon: "scale", label: "Policy Check" },
      { id: "route", icon: "send", label: "Route" },
    ],
    steps: [
      { stage: "ticket", log: 'ticket #9021 → "charged twice for my annual plan"', tokens: 34, ms: 120 },
      { stage: "classify", log: "classified → Billing · Duplicate charge · P2", tokens: 60, ms: 300 },
      { stage: "kb", log: "retrieved refund policy + 2 similar resolved tickets", tokens: 240, ms: 520 },
      { stage: "draft", log: "drafting an empathetic, policy-compliant reply…", tokens: 380, ms: 1300, stream: "Thanks for flagging this — I can see the duplicate charge on Jul 3 and I've issued a full refund of $180; it'll land in 5–7 days." },
      { stage: "policy", log: "guardrail: refund ≤ auto-approve limit ✓ · tone ✓", tokens: 120, ms: 480 },
      { stage: "route", log: "auto-approved · reply sent · ticket resolved", tokens: 0, ms: 90, done: true },
    ],
  },
];
