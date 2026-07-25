"""Core data model for a gossip-rag simulation run.

These types are the in-memory representation the protocol engine mutates
round by round; ``Trace.to_json()`` is the only place that knows about the
on-disk schema documented in TRACE_SCHEMA.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Role(str, Enum):
    HONEST = "honest"
    BYZANTINE = "byzantine"
    STALE = "stale"


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    text: str
    extracted_value: str
    extracted_confidence: float

    def to_json(self) -> dict:
        return {
            "title": self.title,
            "text": self.text,
            "mock_extracted_claim": {
                "value": self.extracted_value,
                "confidence": self.extracted_confidence,
            },
        }


@dataclass(frozen=True)
class Claim:
    id: str
    question: str
    truth_value: str
    corrupted_value: str


@dataclass
class Belief:
    """What one node currently believes about the tracked claim."""

    value: str | None = None
    confidence: float = 0.0
    trust: float = 1.0
    provenance: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "value": self.value,
            "confidence": round(self.confidence, 3),
            "trust": round(self.trust, 3),
            "provenance": list(self.provenance),
        }

    def snapshot(self) -> "Belief":
        return Belief(self.value, self.confidence, self.trust, list(self.provenance))


@dataclass
class Node:
    id: str
    label: str
    role: Role
    shard_doc_ids: list[str]
    belief: Belief = field(default_factory=Belief)
    active: bool = True
    """Inactive nodes ("stale"/offline) don't participate in gossip until reactivated."""

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "role": self.role.value,
            "shard_doc_ids": list(self.shard_doc_ids),
        }


@dataclass
class GossipEvent:
    frm: str
    to: str
    claim_value_sent: str | None
    outcome: str

    def to_json(self) -> dict:
        return {"from": self.frm, "to": self.to, "claim_value_sent": self.claim_value_sent, "outcome": self.outcome}


@dataclass
class RoundSnapshot:
    round: int
    events: list[GossipEvent]
    node_states: dict[str, Belief]
    convergence_pct: float

    def to_json(self) -> dict:
        return {
            "round": self.round,
            "events": [e.to_json() for e in self.events],
            "node_states": {nid: b.to_json() for nid, b in self.node_states.items()},
            "convergence_pct": round(self.convergence_pct, 1),
        }


@dataclass
class Trace:
    scenario: str
    title: str
    description: str
    seed: int
    claim: Claim
    nodes: list[Node]
    documents: dict[str, Document]
    topology_type: str
    edges: list[tuple[str, str]]
    rounds: list[RoundSnapshot]

    def to_json(self) -> dict:
        return {
            "meta": {
                "scenario": self.scenario,
                "title": self.title,
                "description": self.description,
                "seed": self.seed,
                "node_count": len(self.nodes),
                "round_count": len(self.rounds) - 1 if self.rounds else 0,
                "claim_id": self.claim.id,
            },
            "claim": {
                "id": self.claim.id,
                "question": self.claim.question,
                "truth_value": self.claim.truth_value,
                "corrupted_value": self.claim.corrupted_value,
            },
            "nodes": [n.to_json() for n in self.nodes],
            "documents": {did: d.to_json() for did, d in self.documents.items()},
            "topology": {
                "type": self.topology_type,
                "edges": [list(e) for e in self.edges],
            },
            "rounds": [r.to_json() for r in self.rounds],
        }
