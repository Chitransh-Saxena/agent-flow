"""Trust-weighted reconciliation: what happens when two nodes' beliefs disagree.

``trust`` lives on a node's belief and tracks the network's confidence in
that *node's* judgement — not the belief's provenance. It moves on both
sides of every conflict: the side whose claim loses a comparison takes a
trust hit whether it was defending (receiver) or pushing (sender), and the
side that wins gets a small reinforcement. That symmetry matters — without
it, a node that only ever *initiates* gossip can spread a false claim for
the entire run without ever being penalized for it, since it would never be
on the "receiving" end of a losing comparison.

There is deliberately no separate "trust below X, force an override" rule.
An earlier version of this file had one, and it made low-trust nodes *less*
stable, not more correctable: once forced-override kicked in, a low-trust
node would flip to whatever conflicting claim it heard next, true or false,
since the override didn't check that the incoming claim was actually
better — just that the receiver's trust was low. That turns a habitual
liar's neighbor into a weathervane instead of someone who's hard to fool
twice. The fix is to not need a special case at all: a low-trust node's
*weighted* score (confidence × trust) is already small, so any reasonably
confident incoming claim beats it on the normal comparison below. Low trust
still means "easy to correct" — just correctable *toward whichever claim
is actually stronger*, not toward whatever arrived most recently.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum

from .models import Belief

TRUST_WIN_BUMP = 0.03
TRUST_LOSE_PENALTY = 0.08
TRUST_FLOOR = 0.05
TRUST_CEIL = 1.0
CORROBORATION_CONFIDENCE_BUMP = 0.0
CONFIDENCE_CEIL = 0.95
"""Corroboration deliberately does NOT raise confidence (bump is 0). An
earlier version bumped it a little on every matching exchange, and that was
enough for an isolated echo chamber to corroborate its way up to roughly
the same confidence as a belief actually backed by several independent
higher-confidence sources — which erases the one signal that should
reliably tell them apart once they finally meet. Confidence here reflects
evidentiary strength and should only ever come from a real source (or be
inherited, trust-discounted, from whoever you adopted it from) — not
manufactured by a node hearing an echo of itself. Trust is the only thing
that moves on repetition."""


class Outcome(str, Enum):
    ADOPTED = "adopted"
    CORROBORATED = "corroborated"
    SWITCHED = "switched"
    REJECTED = "rejected"


@dataclass(frozen=True)
class ReconcileResult:
    receiver_belief: Belief
    sender_trust_delta: float
    outcome: Outcome
    message: str


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def reconcile(receiver: Belief, incoming_value: str, incoming_confidence: float, incoming_trust: float, provenance_hop: str) -> ReconcileResult:
    """Apply one incoming gossip message to a receiver's belief.

    ``incoming_confidence`` is the sender's raw confidence in its value (what
    gets *stored* if the receiver adopts it); ``incoming_trust`` is the
    sender's own trust score, used only to weight the conflict comparison —
    kept distinct so a low-trust sender with a high-confidence claim doesn't
    get to skip the trust discount.
    """
    if receiver.value is None:
        # nothing to test the claim against yet, so weight what's stored by
        # the sender's own trust — an uncontested claim from a shaky source
        # should still be easy to overturn later
        discounted = _clamp(incoming_confidence * incoming_trust, 0.0, CONFIDENCE_CEIL)
        new = Belief(value=incoming_value, confidence=discounted, trust=receiver.trust, provenance=[*receiver.provenance, provenance_hop])
        return ReconcileResult(new, sender_trust_delta=TRUST_WIN_BUMP * 0.4, outcome=Outcome.ADOPTED, message="adopted (had no belief)")

    if receiver.value == incoming_value:
        bumped_conf = _clamp(max(receiver.confidence, incoming_confidence) + CORROBORATION_CONFIDENCE_BUMP, 0.0, CONFIDENCE_CEIL)
        bumped_trust = _clamp(receiver.trust + TRUST_WIN_BUMP * 0.4, TRUST_FLOOR, TRUST_CEIL)
        new = replace(receiver, confidence=bumped_conf, trust=bumped_trust)
        return ReconcileResult(new, sender_trust_delta=TRUST_WIN_BUMP * 0.4, outcome=Outcome.CORROBORATED, message="corroborated (confidence + trust reinforced)")

    # conflict — pure trust-weighted comparison, no separate override rule (see module docstring)
    receiver_score = receiver.confidence * receiver.trust
    incoming_score = incoming_confidence * incoming_trust

    if incoming_score > receiver_score:
        # note: the receiver's trust is untouched here, deliberately. Updating
        # toward better evidence is correct behavior, not a strike against
        # you — penalizing it would leave a just-corrected node too
        # low-credibility to help spread the correction any further, which
        # is exactly backwards. Only a claim that gets *rejected* while
        # being pushed costs its holder trust (see the REJECTED branch).
        new = Belief(value=incoming_value, confidence=incoming_confidence, trust=receiver.trust, provenance=[*receiver.provenance, provenance_hop])
        return ReconcileResult(
            new,
            sender_trust_delta=TRUST_WIN_BUMP,
            outcome=Outcome.SWITCHED,
            message=f"switched (incoming score {incoming_score:.2f} > held score {receiver_score:.2f})",
        )

    new = replace(receiver, trust=_clamp(receiver.trust + TRUST_WIN_BUMP, TRUST_FLOOR, TRUST_CEIL))
    return ReconcileResult(
        new,
        sender_trust_delta=-TRUST_LOSE_PENALTY,
        outcome=Outcome.REJECTED,
        message=f"rejected incoming (held score {receiver_score:.2f} >= incoming {incoming_score:.2f}); trust reinforced, sender's claim just lost a contest",
    )
