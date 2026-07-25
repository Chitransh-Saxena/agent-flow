from gossiprag.protocol import run_simulation
from gossiprag.scenarios import byzantine_minority, partition_heal


def test_byzantine_minority_converges_to_truth():
    trace = run_simulation(byzantine_minority())
    final = trace.rounds[-1]
    assert final.convergence_pct == 100.0
    for belief in final.node_states.values():
        assert belief.value == trace.claim.truth_value


def test_byzantine_minority_starts_below_full_convergence():
    trace = run_simulation(byzantine_minority())
    assert trace.rounds[0].convergence_pct < 100.0, "the scenario should open with visible disagreement, not already solved"


def test_partition_heal_forms_an_echo_chamber_before_the_bridge_opens():
    trace = run_simulation(partition_heal())
    heal_round = 12  # matches scenarios.partition_heal()'s heal_round; the round the bridge edges activate
    pre_heal = trace.rounds[heal_round - 1]
    group_b_ids = [n.id for n in trace.nodes if n.id.startswith("B")]
    # every Group B node should be locked onto the corrupted value while isolated
    assert all(pre_heal.node_states[nid].value == trace.claim.corrupted_value for nid in group_b_ids)


def test_partition_heal_fully_converges_after_reconnection():
    trace = run_simulation(partition_heal())
    final = trace.rounds[-1]
    assert final.convergence_pct == 100.0
    for belief in final.node_states.values():
        assert belief.value == trace.claim.truth_value


def test_convergence_is_monotonic_non_decreasing_after_full_convergence():
    """Once every node agrees, corroboration-only rounds should never un-converge it."""
    trace = run_simulation(byzantine_minority())
    hit_100 = False
    for r in trace.rounds:
        if r.convergence_pct == 100.0:
            hit_100 = True
        if hit_100:
            assert r.convergence_pct == 100.0
