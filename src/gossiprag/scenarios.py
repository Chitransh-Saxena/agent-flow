"""The two scenarios shipped with this repo. Each is a pure function
building a ScenarioConfig — no I/O, so they're easy to unit test and easy
to add to (a third scenario is just a third function here plus a manifest
entry once you've generated its trace)."""

from __future__ import annotations

import random

from .fixtures import CLAIM, DOCUMENTS
from .models import Belief, Node, Role
from .protocol import ScenarioConfig
from .topology import bridge, small_world


def byzantine_minority() -> ScenarioConfig:
    """15 nodes, 3 seeded with a false claim, 2 offline until round 8.

    Demonstrates the core convergence property: an honest majority, gossiping
    with trust-weighted reconciliation, heals the network even though some
    nodes actively (and repeatedly) push a false claim — no single message
    is individually flagged as a lie, the byzantine nodes just keep losing
    conflicts until the network stops listening to them.
    """
    rng = random.Random(7)
    nodes: list[Node] = []

    doc_holders = ["doc_marshal", "doc_stream", "doc_interview", "doc_sponsor", "doc_forum", "doc_recap"]
    for i, doc_id in enumerate(doc_holders):
        doc = DOCUMENTS[doc_id]
        nodes.append(
            Node(
                id=f"N{i}",
                label=f"Node {i}",
                role=Role.HONEST,
                shard_doc_ids=[doc_id],
                belief=Belief(value=doc.extracted_value, confidence=doc.extracted_confidence, trust=1.0, provenance=[doc_id]),
            )
        )

    for i in range(len(doc_holders), len(doc_holders) + 4):  # N6..N9 — honest, uninformed, learn purely by gossip
        nodes.append(Node(id=f"N{i}", label=f"Node {i}", role=Role.HONEST, shard_doc_ids=[]))

    byz_start = len(doc_holders) + 4  # N10..N12
    for i in range(byz_start, byz_start + 3):
        nodes.append(
            Node(
                id=f"N{i}",
                label=f"Node {i}",
                role=Role.BYZANTINE,
                shard_doc_ids=[],
                belief=Belief(value=CLAIM.corrupted_value, confidence=0.72, trust=1.0, provenance=["seed:byzantine"]),
            )
        )

    stale_start = byz_start + 3  # N13..N14
    reactivate_round = {}
    for i in range(stale_start, stale_start + 2):
        nodes.append(Node(id=f"N{i}", label=f"Node {i}", role=Role.STALE, shard_doc_ids=[]))
        reactivate_round[f"N{i}"] = 8

    node_ids = [n.id for n in nodes]
    edges = small_world(node_ids, k=4, rewire_p=0.15, rng=rng)
    num_rounds = 24

    return ScenarioConfig(
        scenario_id="byzantine-minority",
        title="Byzantine minority — 3/15 nodes corrupted, network still converges",
        description=(
            "3 of 15 nodes are seeded with a false claim from round 0. 2 more nodes are offline "
            "until round 8. Anti-entropy gossip plus trust-weighted reconciliation should heal "
            "the whole network onto the true claim well before round 24 — watch the byzantine "
            "nodes' trust erode round over round until they get forced back onto consensus."
        ),
        seed=7,
        claim=CLAIM,
        nodes=nodes,
        documents=DOCUMENTS,
        topology_type="small-world",
        num_rounds=num_rounds,
        edges_by_round=[edges] * (num_rounds + 1),
        reactivate_round=reactivate_round,
    )


def partition_heal() -> ScenarioConfig:
    """10 nodes split into two islands with no path between them.

    Group A has real sources and converges to the truth internally. Group B
    has *no* real sources at all — its only informed member is a single
    byzantine node — so it echo-chambers onto the false claim; with no honest
    signal reachable inside its own island, trust-weighting alone can't save
    it. At round 10 two bridge edges reconnect the islands, and Group A's
    better-corroborated, higher-trust belief propagates in and corrects
    Group B. The point: gossip protocols can't out-vote a lie the network
    topology never gives them a chance to hear a rebuttal to.
    """
    rng = random.Random(11)

    group_a: list[Node] = []
    doc_holders = ["doc_marshal", "doc_stream", "doc_sponsor"]
    for i, doc_id in enumerate(doc_holders):
        doc = DOCUMENTS[doc_id]
        group_a.append(
            Node(
                id=f"A{i}",
                label=f"A{i}",
                role=Role.HONEST,
                shard_doc_ids=[doc_id],
                belief=Belief(value=doc.extracted_value, confidence=doc.extracted_confidence, trust=1.0, provenance=[doc_id]),
            )
        )
    for i in range(len(doc_holders), 5):
        group_a.append(Node(id=f"A{i}", label=f"A{i}", role=Role.HONEST, shard_doc_ids=[]))

    group_b: list[Node] = [
        Node(
            id="B0",
            label="B0",
            role=Role.BYZANTINE,
            shard_doc_ids=[],
            belief=Belief(value=CLAIM.corrupted_value, confidence=0.72, trust=1.0, provenance=["seed:byzantine"]),
        )
    ]
    for i in range(1, 5):
        group_b.append(Node(id=f"B{i}", label=f"B{i}", role=Role.HONEST, shard_doc_ids=[]))

    nodes = group_a + group_b
    a_ids, b_ids = [n.id for n in group_a], [n.id for n in group_b]

    a_edges = small_world(a_ids, k=2, rewire_p=0.2, rng=rng)
    b_edges = small_world(b_ids, k=2, rewire_p=0.2, rng=rng)
    # every Group B node gets its own direct bridge to Group A — a real
    # partition heal reconnects the network, it doesn't hand the whole
    # island a single relay to fight through. (An earlier version of this
    # scenario bridged only 2-3 nodes; watching that trace is what surfaced
    # a genuinely interesting failure mode worth keeping in mind even though
    # it's not what this scenario demonstrates: a lone reconnected node gets
    # torn between its high-trust echo-chamber neighbors and the honest
    # signal, and can oscillate indefinitely rather than winning outright —
    # a single bridge does not reliably heal a partition once trust has
    # entrenched on one side.)
    bridge_edges = bridge(a_ids, b_ids, count=5, rng=rng)

    num_rounds = 34
    heal_round = 12
    edges_by_round = [a_edges + b_edges] * heal_round + [a_edges + b_edges + bridge_edges] * (num_rounds + 1 - heal_round)

    return ScenarioConfig(
        scenario_id="partition-heal",
        title="Network partition & heal — an echo chamber forms, then gets corrected",
        description=(
            "10 nodes split into two islands with no path between them. Island A has real sources "
            "and converges to the truth on its own. Island B has no real sources at all — only a "
            "single byzantine seed — so with no honest signal reachable inside its own island, it "
            f"echo-chambers onto the false claim. At round {heal_round} a few bridge edges reconnect "
            "the islands and Island A's belief propagates in and corrects Island B."
        ),
        seed=11,
        claim=CLAIM,
        nodes=nodes,
        documents=DOCUMENTS,
        topology_type="two-islands-then-bridged",
        num_rounds=num_rounds,
        edges_by_round=edges_by_round,
    )


SCENARIOS = {
    "byzantine-minority": byzantine_minority,
    "partition-heal": partition_heal,
}
