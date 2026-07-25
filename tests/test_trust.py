import pytest

from gossiprag.models import Belief
from gossiprag.trust import TRUST_CEIL, TRUST_FLOOR, Outcome, reconcile


def test_uninformed_node_adopts_outright():
    receiver = Belief()  # value=None
    result = reconcile(receiver, "Truth", incoming_confidence=0.9, incoming_trust=1.0, provenance_hop="doc_1")
    assert result.outcome == Outcome.ADOPTED
    assert result.receiver_belief.value == "Truth"
    assert result.receiver_belief.provenance == ["doc_1"]


def test_adoption_discounts_confidence_by_sender_trust():
    receiver = Belief()
    result = reconcile(receiver, "Truth", incoming_confidence=0.9, incoming_trust=0.5, provenance_hop="x")
    assert result.receiver_belief.confidence == pytest.approx(0.45)


def test_matching_value_corroborates_without_inflating_confidence():
    receiver = Belief(value="Truth", confidence=0.8, trust=1.0, provenance=["doc_1"])
    result = reconcile(receiver, "Truth", incoming_confidence=0.95, incoming_trust=1.0, provenance_hop="doc_2")
    assert result.outcome == Outcome.CORROBORATED
    # takes the higher of the two REAL confidences — corroboration bump is 0,
    # so it must never exceed that (see trust.py's CORROBORATION_CONFIDENCE_BUMP docstring)
    assert result.receiver_belief.confidence == pytest.approx(0.95)


def test_higher_weighted_score_wins_conflict_without_penalizing_the_convert():
    receiver = Belief(value="Lie", confidence=0.6, trust=0.3, provenance=["seed:byzantine"])  # score 0.18
    result = reconcile(receiver, "Truth", incoming_confidence=0.9, incoming_trust=1.0, provenance_hop="doc_1")  # score 0.9
    assert result.outcome == Outcome.SWITCHED
    assert result.receiver_belief.value == "Truth"
    assert result.receiver_belief.trust == receiver.trust, "switching toward better evidence must not cost the convert trust"
    assert result.sender_trust_delta > 0


def test_lower_weighted_score_is_rejected_and_penalizes_the_sender():
    receiver = Belief(value="Truth", confidence=0.9, trust=1.0, provenance=["doc_1"])  # score 0.9
    result = reconcile(receiver, "Lie", incoming_confidence=0.6, incoming_trust=0.3, provenance_hop="x")  # score 0.18
    assert result.outcome == Outcome.REJECTED
    assert result.receiver_belief.value == "Truth"
    assert result.sender_trust_delta < 0


def test_trust_never_leaves_floor_ceil_bounds_over_many_conflicting_updates():
    trust = 1.0
    for _ in range(50):
        receiver = Belief(value="A", confidence=0.9, trust=trust)
        result = reconcile(receiver, "B", incoming_confidence=0.95, incoming_trust=1.0, provenance_hop="x")
        trust = result.receiver_belief.trust
        assert TRUST_FLOOR <= trust <= TRUST_CEIL
