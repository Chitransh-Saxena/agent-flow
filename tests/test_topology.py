import random

from gossiprag.topology import bridge, small_world


def test_small_world_edges_reference_only_given_nodes():
    ids = [f"N{i}" for i in range(10)]
    edges = small_world(ids, k=4, rewire_p=0.15, rng=random.Random(0))
    referenced = {n for e in edges for n in e}
    assert referenced <= set(ids)


def test_small_world_no_self_loops_no_duplicate_edges():
    ids = [f"N{i}" for i in range(12)]
    edges = small_world(ids, k=4, rewire_p=0.3, rng=random.Random(1))
    assert all(a != b for a, b in edges)
    assert len(edges) == len(set(frozenset(e) for e in edges))


def test_small_world_every_node_has_at_least_one_edge():
    ids = [f"N{i}" for i in range(8)]
    edges = small_world(ids, k=4, rewire_p=0.15, rng=random.Random(2))
    touched = {n for e in edges for n in e}
    assert touched == set(ids)


def test_bridge_connects_across_groups_only():
    a = [f"A{i}" for i in range(5)]
    b = [f"B{i}" for i in range(5)]
    edges = bridge(a, b, count=3, rng=random.Random(3))
    assert len(edges) == 3
    for x, y in edges:
        assert x in a and y in b
