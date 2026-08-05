"""Value types for the retrieval layer.

`Chunk` carries `page` and `char_span` from ingest onward. That is the whole
reason P1 can cite a page number: the anchor has to survive chunking, because
recovering it afterwards means guessing which page a piece of text came from,
and the guess is wrong exactly at page boundaries — which is where a claim
spanning two pages lands.

`SearchHit` keeps the component scores alongside the fused one. Debugging a bad
retrieval means knowing whether the lexical or the dense side put a document
there; a single fused number cannot answer that, and "why did this rank first"
is the most common question asked of a retrieval system.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

__all__ = ["Chunk", "Filter", "SearchHit", "matches_filter"]


@dataclass(frozen=True)
class Chunk:
    """A retrievable unit of text, with its position in the source preserved."""

    id: str
    text: str
    doc_id: str = ""
    #: 1-based page number in the source document, 0 when there are no pages.
    page: int = 0
    #: Character offsets within the source, for exact highlight and audit.
    char_span: tuple[int, int] = (0, 0)
    #: Arbitrary metadata used for filtering — tenant, source, date, section.
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def cite(self) -> str:
        return f"[p. {self.page}]" if self.page else f"[{self.doc_id or self.id}]"


@dataclass(frozen=True)
class SearchHit:
    chunk: Chunk
    score: float
    #: Per-retriever contributions, kept so a ranking can be explained.
    components: dict[str, float] = field(default_factory=dict)
    #: 1-based rank from each retriever that returned it.
    ranks: dict[str, int] = field(default_factory=dict)

    def explain(self) -> str:
        parts = [f"{name}#{rank}" for name, rank in sorted(self.ranks.items())]
        return f"{self.score:.4f} via {', '.join(parts) or 'unranked'}"


#: A metadata filter. Values may be a scalar (equality), a list (membership), or
#: a `{"gte": x}` / `{"lte": x}` range. Deliberately small: a filter language
#: that grows expressive enough to need a parser is one that cannot be pushed
#: down into a real vector database.
Filter = dict[str, Any]


def matches_filter(metadata: dict[str, Any], where: Filter | None) -> bool:
    """Evaluate a filter against one chunk's metadata."""
    if not where:
        return True
    for key, expected in where.items():
        actual = metadata.get(key)
        if isinstance(expected, dict):
            if "gte" in expected and (actual is None or actual < expected["gte"]):
                return False
            if "lte" in expected and (actual is None or actual > expected["lte"]):
                return False
            if "ne" in expected and actual == expected["ne"]:
                return False
        elif isinstance(expected, (list, tuple, set)):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True
