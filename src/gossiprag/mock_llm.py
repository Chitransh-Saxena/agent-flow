"""The one seam in this codebase where a real LLM call would go.

gossip-rag never calls a real model — every "extraction" is a pre-baked
value sitting on the Document itself (see fixtures/). That's a deliberate
choice, not a limitation of the design: the protocol/trust logic downstream
doesn't know or care whether ``FactExtractor.extract`` was answered by a
lookup table or a real completion call. Swap ``MockExtractor`` for an
implementation that calls out to an LLM and everything else in this
repo keeps working unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import Document


@dataclass(frozen=True)
class ExtractedClaim:
    value: str
    confidence: float


class FactExtractor(Protocol):
    """The interface a real extraction backend would implement.

    A production implementation would prompt an LLM with the document text
    and the tracked question, parse a structured (value, confidence) out of
    the response, and return it here — same shape, same caller.
    """

    def extract(self, document: Document, question: str) -> ExtractedClaim: ...


class MockExtractor:
    """Reads the pre-baked answer straight off the fixture document.

    This is what every scenario in this repo actually uses. It exists as a
    real class (not just a dict lookup inline) so the swap point above is
    concrete and testable.
    """

    def extract(self, document: Document, question: str) -> ExtractedClaim:  # noqa: ARG002 - question unused by design
        return ExtractedClaim(document.extracted_value, document.extracted_confidence)
