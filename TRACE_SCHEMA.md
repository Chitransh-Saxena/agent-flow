# Trace schema — the contract between the simulation engine and the UI

The Python engine (`src/gossiprag`) runs a scenario and writes one JSON file per
scenario to `traces/<scenario-id>.trace.json`. The web UI (`ui/`) only ever
reads these files — it has zero knowledge of the simulation internals.

`traces/manifest.json` lists the available traces for the UI's scenario picker:

```json
[
  { "id": "byzantine-minority", "title": "Byzantine minority (3/15 corrupted)", "file": "byzantine-minority.trace.json" },
  { "id": "partition-heal", "title": "Network partition & heal", "file": "partition-heal.trace.json" }
]
```

## `<scenario>.trace.json`

```jsonc
{
  "meta": {
    "scenario": "byzantine-minority",
    "title": "Byzantine minority — 20% corrupted, network still converges",
    "description": "3 of 15 nodes are seeded with a false fact. Anti-entropy gossip plus trust-weighted reconciliation heals the network to the true fact within ~12 rounds.",
    "seed": 42,
    "node_count": 15,
    "round_count": 20,
    "claim_id": "worldcup_2026_winner"
  },

  "claim": {
    "id": "worldcup_2026_winner",
    "question": "Who won the 2026 FIFA World Cup?",
    "truth_value": "Argentina",
    "corrupted_value": "Brazil"
  },

  // every node that exists in the simulation, static for the whole trace
  "nodes": [
    { "id": "N0", "label": "Node 0", "role": "honest", "shard_doc_ids": ["doc_03", "doc_11"] },
    { "id": "N7", "label": "Node 7", "role": "byzantine", "shard_doc_ids": ["doc_09"] },
    { "id": "N12", "label": "Node 12", "role": "stale", "shard_doc_ids": [] }
    // role is one of: "honest" | "byzantine" | "stale"
  ],

  // the local document shards nodes retrieved from — this is the mocked
  // "RAG" layer: mock_extracted_claim is what a real LLM extraction call
  // would have produced, pre-baked instead of called live
  "documents": {
    "doc_03": {
      "title": "Match Report: Final",
      "text": "...",
      "mock_extracted_claim": { "value": "Argentina", "confidence": 0.93 }
    }
  },

  // the fixed peer graph gossip exchanges happen over — does not change
  // across rounds. UI computes its own force-directed layout from this.
  "topology": {
    "type": "small-world",
    "edges": [["N0", "N1"], ["N0", "N4"], ["N1", "N2"]]
  },

  // one entry per round, INCLUDING round 0 (the initial state before any
  // gossip exchange has happened). node_states is a FULL snapshot every
  // round (not a diff) so the UI can jump to any round directly.
  "rounds": [
    {
      "round": 0,
      "events": [],
      "node_states": {
        "N0": { "value": "Argentina", "confidence": 0.93, "trust": 1.0, "provenance": ["doc_03"] },
        "N7": { "value": "Brazil", "confidence": 0.9, "trust": 1.0, "provenance": ["seed:byzantine"] },
        "N12": { "value": null, "confidence": 0.0, "trust": 1.0, "provenance": [] }
      },
      "convergence_pct": 46.7
    },
    {
      "round": 1,
      "events": [
        { "from": "N0", "to": "N2", "claim_value_sent": "Argentina", "outcome": "N2 adopted (had no belief)" },
        { "from": "N7", "to": "N9", "claim_value_sent": "Brazil", "outcome": "N9 rejected (lower trust than existing belief)" }
      ],
      "node_states": { "...": "full snapshot of every node again" },
      "convergence_pct": 53.3
    }
  ]
}
```

### Field notes for the UI

- `value: null` = node has no belief yet (uninformed / gray in the UI).
- `role` drives default coloring intent, but the UI should primarily color by
  **current belief correctness** (does `value` match `claim.truth_value`?),
  not by `role` — the whole point is that byzantine/stale nodes are only
  discoverable *through the simulation*, not labeled up front. `role` is
  still in the data for the detail panel / "reveal" toggle.
- `provenance` is an ordered, human-readable list of strings — a document id,
  a `seed:byzantine` / `seed:stale` marker, or `"via N4 (round 2)"` for a
  gossip hop. Render as a simple ordered list in the node detail panel.
- `events` in round 0 is always empty (nothing has happened yet); it's the
  initial snapshot.
- `topology.edges` is the *complete* set of eligible gossip pairs for the
  whole run — a node only ever gossips with a graph neighbor, never a
  random stranger. This is what the UI lays out as the graph.
- Every `traces/*.trace.json` file is fully self-contained and static —
  the UI never talks to Python at runtime, it only `fetch()`s these files.
