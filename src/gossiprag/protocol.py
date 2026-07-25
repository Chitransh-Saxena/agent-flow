"""The gossip round loop: push-pull anti-entropy over a fixed peer graph.

Each round, every *active* node initiates exactly one exchange with a
random active neighbor; both sides reconcile against the other's
pre-exchange belief. What happens to a belief on arrival is entirely
trust.reconcile's call — this module is just the scheduler: who talks to
whom, in what order, this round.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .models import Belief, Claim, Document, GossipEvent, Node, RoundSnapshot, Trace
from .trust import TRUST_CEIL, TRUST_FLOOR, reconcile


@dataclass
class ScenarioConfig:
    scenario_id: str
    title: str
    description: str
    seed: int
    claim: Claim
    nodes: list[Node]
    documents: dict[str, Document]
    topology_type: str
    num_rounds: int
    edges_by_round: list[list[tuple[str, str]]]
    """One entry per round (length == num_rounds + 1, round 0 included but
    unused for gossip since round 0 is the initial snapshot). Pass the same
    edge list repeated for every round for a static topology."""
    reactivate_round: dict[str, int] = field(default_factory=dict)
    """node_id -> round index at which a stale/offline node starts gossiping.
    Nodes not listed are active from round 0."""


def _neighbors(node_id: str, edges: list[tuple[str, str]], active: set[str]) -> list[str]:
    out = []
    for a, b in edges:
        if a == node_id and b in active:
            out.append(b)
        elif b == node_id and a in active:
            out.append(a)
    return out


def _convergence_pct(nodes: list[Node], truth_value: str) -> float:
    if not nodes:
        return 0.0
    correct = sum(1 for n in nodes if n.belief.value == truth_value)
    return 100.0 * correct / len(nodes)


def run_simulation(config: ScenarioConfig) -> Trace:
    rng = random.Random(config.seed)
    nodes_by_id = {n.id: n for n in config.nodes}
    rounds: list[RoundSnapshot] = []

    active: set[str] = {n.id for n in config.nodes if config.reactivate_round.get(n.id, 0) == 0}

    # round 0 — initial snapshot, no exchanges yet
    rounds.append(
        RoundSnapshot(
            round=0,
            events=[],
            node_states={nid: n.belief.snapshot() for nid, n in nodes_by_id.items()},
            convergence_pct=_convergence_pct(config.nodes, config.claim.truth_value),
        )
    )

    for r in range(1, config.num_rounds + 1):
        for nid, reactivate_at in config.reactivate_round.items():
            if reactivate_at == r:
                active.add(nid)

        edges = config.edges_by_round[r] if r < len(config.edges_by_round) else config.edges_by_round[-1]
        events: list[GossipEvent] = []

        initiators = list(active)
        rng.shuffle(initiators)

        for nid in initiators:
            peers = _neighbors(nid, edges, active)
            if not peers:
                continue
            peer_id = rng.choice(peers)
            node_a = nodes_by_id[nid]
            node_b = nodes_by_id[peer_id]

            # push-PULL: snapshot both sides before either mutates, so a->b and
            # b->a reconcile independently against the same pre-exchange state.
            # (push-only would mean a node's *value* can only ever change when
            # it happens to be on the receiving end of an exchange — with
            # random peer selection that's not guaranteed for any given node,
            # so a corrupted node could lose all its trust yet never actually
            # get corrected simply because it kept initiating rather than
            # receiving. Real anti-entropy protocols are push-pull for this
            # exact reason.)
            a0, b0 = node_a.belief.snapshot(), node_b.belief.snapshot()

            b_result = None
            if a0.value is not None:
                b_result = reconcile(b0, a0.value, a0.confidence, a0.trust, provenance_hop=f"via {nid} (round {r})")
                events.append(GossipEvent(frm=nid, to=peer_id, claim_value_sent=a0.value, outcome=b_result.message))

            a_result = None
            if b0.value is not None:
                a_result = reconcile(a0, b0.value, b0.confidence, b0.trust, provenance_hop=f"via {peer_id} (round {r})")
                events.append(GossipEvent(frm=peer_id, to=nid, claim_value_sent=b0.value, outcome=a_result.message))

            if b_result is not None:
                node_b.belief = b_result.receiver_belief
            if a_result is not None and a_result.sender_trust_delta:
                node_b.belief.trust = max(TRUST_FLOOR, min(TRUST_CEIL, node_b.belief.trust + a_result.sender_trust_delta))

            if a_result is not None:
                node_a.belief = a_result.receiver_belief
            if b_result is not None and b_result.sender_trust_delta:
                node_a.belief.trust = max(TRUST_FLOOR, min(TRUST_CEIL, node_a.belief.trust + b_result.sender_trust_delta))

        rounds.append(
            RoundSnapshot(
                round=r,
                events=events,
                node_states={nid: n.belief.snapshot() for nid, n in nodes_by_id.items()},
                convergence_pct=_convergence_pct(config.nodes, config.claim.truth_value),
            )
        )

    all_edges = sorted({e for round_edges in config.edges_by_round for e in round_edges})

    return Trace(
        scenario=config.scenario_id,
        title=config.title,
        description=config.description,
        seed=config.seed,
        claim=config.claim,
        nodes=config.nodes,
        documents=config.documents,
        topology_type=config.topology_type,
        edges=all_edges,
        rounds=rounds,
    )
