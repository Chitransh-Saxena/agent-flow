"""Peer-graph generators. A node only ever gossips with a graph neighbor."""

from __future__ import annotations

import random


def small_world(node_ids: list[str], k: int = 4, rewire_p: float = 0.15, rng: random.Random | None = None) -> list[tuple[str, str]]:
    """A simplified Watts-Strogatz small-world graph.

    Start from a ring where each node connects to its ``k`` nearest
    neighbors, then rewire each edge to a random node with probability
    ``rewire_p``. Produces the "mostly local, a few long-range shortcuts"
    structure real gossip protocols are usually analyzed over.
    """
    rng = rng or random.Random()
    n = len(node_ids)
    if n < 2:
        return []
    k = max(2, min(k, n - 1))
    if k % 2 == 1:
        k -= 1

    edges: set[frozenset[str]] = set()
    for i in range(n):
        for step in range(1, k // 2 + 1):
            j = (i + step) % n
            edges.add(frozenset((node_ids[i], node_ids[j])))

    rewired: set[frozenset[str]] = set()
    for edge in edges:
        a, b = tuple(edge)
        if rng.random() < rewire_p:
            candidates = [nid for nid in node_ids if nid != a and frozenset((a, nid)) not in rewired]
            if candidates:
                b = rng.choice(candidates)
        rewired.add(frozenset((a, b)))

    return [tuple(sorted(e)) for e in rewired]  # type: ignore[misc]


def bridge(group_a: list[str], group_b: list[str], count: int = 1, rng: random.Random | None = None) -> list[tuple[str, str]]:
    """A handful of edges connecting two otherwise-separate node groups."""
    rng = rng or random.Random()
    count = min(count, len(group_a), len(group_b))
    a_sample = rng.sample(group_a, count)
    b_sample = rng.sample(group_b, count)
    return list(zip(a_sample, b_sample))
