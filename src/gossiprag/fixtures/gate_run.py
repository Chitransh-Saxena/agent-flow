"""Mock corpus for every scenario in this repo.

Entirely fictional — the "Apex Gate-Run Invitational" is not a real event
and "Vela"/"Kestrel" are not real people. Picked something small, fun, and
unambiguous on purpose: the point of this repo is the protocol, not the
domain, and a fictional low-stakes claim keeps that obvious.
"""

from __future__ import annotations

from ..models import Claim, Document

CLAIM = Claim(
    id="gate_run_invitational_winner",
    question="Who won the Apex Gate-Run Invitational (fictional FPV drone race, used as a demo claim)?",
    truth_value="Pilot Vela",
    corrupted_value="Pilot Kestrel",
)

DOCUMENTS: dict[str, Document] = {
    "doc_marshal": Document(
        id="doc_marshal",
        title="Race Marshal Bulletin — Final Heat",
        text="Pilot Vela cleared the last gate 0.4s ahead of the field, taking the Apex Gate-Run Invitational title.",
        extracted_value="Pilot Vela",
        extracted_confidence=0.95,
    ),
    "doc_stream": Document(
        id="doc_stream",
        title="Livestream Commentary Transcript",
        text="...and Vela takes the checkered gate! Cleanest line through the chicane all weekend.",
        extracted_value="Pilot Vela",
        extracted_confidence=0.88,
    ),
    "doc_interview": Document(
        id="doc_interview",
        title="Post-Race Pilot Interview",
        text="Vela, on the winning run: 'The pack config finally clicked in finals.'",
        extracted_value="Pilot Vela",
        extracted_confidence=0.80,
    ),
    "doc_sponsor": Document(
        id="doc_sponsor",
        title="Sponsor Recap Newsletter",
        text="Congratulations to Vela and the whole podium for an incredible final heat.",
        extracted_value="Pilot Vela",
        extracted_confidence=0.85,
    ),
    "doc_forum": Document(
        id="doc_forum",
        title="Community Forum Thread",
        text="does anyone have the final standings?? pretty sure it was Vela but wasn't watching closely",
        extracted_value="Pilot Vela",
        extracted_confidence=0.55,
    ),
    "doc_recap": Document(
        id="doc_recap",
        title="Season Recap Article",
        text="Vela's win at Apex closed out a strong finals weekend for the whole team.",
        extracted_value="Pilot Vela",
        extracted_confidence=0.82,
    ),
}
