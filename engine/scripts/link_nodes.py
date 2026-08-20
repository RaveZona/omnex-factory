"""Link the 509 figures to the 507 nodes, at the resolution the export lacks.

    python scripts/link_nodes.py

The export maps every figure to BRANCHES and stops there. That is 28 buckets for
509 figures, and it is why "the protocol fabric carries 184 figures" is true and
useless for building anything: the branch has seventeen nodes, and nobody knows
which figure belongs to MCP rather than to OAuth. This closes that gap and, more
importantly, measures how much of the tree the corpus actually reaches.

## The matching is lexical, and that is stated rather than hidden

A node name is matched against a figure's title, caption and OCR text by token
overlap. That catches the distinctive names — HNSW, ReAct, MCP, LoRA — and misses
every case where the book says "the retrieval step" and the node is called
"Hybrid Search". So recall is bounded by vocabulary, not by the corpus.

Two structural rules keep the result honest rather than merely large:

**A figure may only match nodes on branches it already touches.** The export's
own branch mapping is the fence. Without it, "Router" in a figure caption matches
a node called "Router" in a branch the figure has nothing to do with, and the
graph fills with edges that render convincingly and mean nothing.

**A single shared common word is not a match.** Node names like "Agent Memory"
and "Tool Calling" share tokens with almost everything, so a match needs either a
rare token or more than one token in common. The stop list is in the code and can
be argued with.

## What the number is for

`nodes_reached` is the honest headline: how many of 507 nodes any figure lands
on at all. A low number is not a failure of this script — it is the measurement
that says how much of the ontology this one book can evidence, and therefore how
much of it is still assumption. That is the question the whole ontology v2 change
was about, asked one level finer.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass

from ingest_atlas import CORPUS, EXPORT, Branch, Figure, parse

from omnex.rag.figures import Band

LINKS = CORPUS / "node_links.json"
COVERAGE = CORPUS / "NODE_COVERAGE.md"

#: Tokens too common in this domain to carry a match on their own. A node named
#: "Agent Memory" must not match every figure that says "agent".
STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "as",
        "at",
        "by",
        "for",
        "from",
        "in",
        "into",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
        "agent",
        "agents",
        "ai",
        "api",
        "based",
        "data",
        "design",
        "engine",
        "flow",
        "layer",
        "llm",
        "llms",
        "model",
        "models",
        "node",
        "pattern",
        "patterns",
        "process",
        "system",
        "systems",
        "tool",
        "tools",
        "type",
        "types",
        "use",
        "used",
        "using",
        "via",
        "work",
    ]
)

#: Below this, a match is noise. Bands come from `Band.of`, so this is the floor
#: under the review queue rather than a second, competing threshold.
FLOOR = 0.5

#: A token this rare carries a match on its own. log(509/(1+c)) crosses 2.5
#: at roughly forty figures, so "MCP" qualifies and "memory" does not.
RARE = 2.5

#: Weight for a node token that appears in no figure at all — treated as
#: maximally rare, so its ABSENCE from a match counts heavily against it.
MAX_IDF = math.log(509.0)


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1}


@dataclass(frozen=True)
class Link:
    """One figure attached to one node, with the score that put it there."""

    figure_id: str
    branch_id: str
    node: str
    score: float

    @property
    def band(self) -> str:
        return str(Band.of(self.score))


def inverse_frequency(figures: list[Figure]) -> dict[str, float]:
    """How rare each token is across the corpus, for weighting a match.

    The first version of this file scored a match as the share of the node's
    tokens that appeared, which put 452 of 453 edges in the top band — a
    confidence score with no dynamic range, and therefore a review queue that
    was empty by construction rather than by quality. Matching "MCP" and
    matching "memory" are not the same evidence, and a score that cannot tell
    them apart is decoration.
    """
    counts: dict[str, int] = {}
    for figure in figures:
        for token in tokens(f"{figure.title} {figure.caption} {figure.ocr}"):
            counts[token] = counts.get(token, 0) + 1
    total = max(len(figures), 1)
    return {token: math.log(total / (1 + count)) for token, count in counts.items()}


def score_match(node_tokens: set[str], figure_tokens: set[str], weight: dict[str, float]) -> float:
    """How strongly a node name is present in a figure's text, weighted by rarity.

    Scored on the NODE's tokens rather than on the union: a two-word node fully
    present in a long OCR block is a strong match, and Jaccard would punish it
    for the length of text it was found in. Each token then counts for how rare
    it is, so a node reached through its distinctive word outranks one reached
    through a word half the corpus uses.
    """
    meaningful = node_tokens - STOPWORDS
    if not meaningful:
        return 0.0
    hits = meaningful & figure_tokens
    if not hits:
        return 0.0
    # One common token alone is not evidence; a rare one, or two of them, is.
    if len(hits) == 1 and len(meaningful) > 1 and weight.get(next(iter(hits)), 0.0) < RARE:
        return 0.0
    have = sum(weight.get(t, MAX_IDF) for t in hits)
    want = sum(weight.get(t, MAX_IDF) for t in meaningful)
    return min(have / want, 1.0) if want else 0.0


def link(branches: list[Branch], figures: list[Figure]) -> list[Link]:
    """Attach figures to nodes, fenced by the branches each figure already touches."""
    by_figure: dict[str, list[str]] = {}
    for branch in branches:
        for fid in branch.touched:
            by_figure.setdefault(fid, []).append(branch.id)

    nodes_of = {b.id: [(n, tokens(n)) for n in b.node_names] for b in branches}
    weight = inverse_frequency(figures)
    links: list[Link] = []

    for figure in figures:
        text = tokens(f"{figure.title} {figure.caption} {figure.ocr}")
        if not text:
            continue
        for branch_id in by_figure.get(figure.id, []):
            for node, node_tokens in nodes_of.get(branch_id, []):
                score = score_match(node_tokens, text, weight)
                if score >= FLOOR:
                    links.append(Link(figure.id, branch_id, node, score))

    links.sort(key=lambda edge: (-edge.score, edge.figure_id))
    return links


def render(branches: list[Branch], figures: list[Figure], links: list[Link]) -> str:
    total_nodes = sum(b.nodes for b in branches)
    reached = {(edge.branch_id, edge.node) for edge in links}
    figures_linked = {edge.figure_id for edge in links}
    auto = [edge for edge in links if edge.band == "auto"]

    lines = [
        "# Figure-to-node coverage",
        "",
        "Generated by `engine/scripts/link_nodes.py`. Do not edit.",
        "",
        f"**{len(reached)} of {total_nodes} nodes are reached by at least one figure.** "
        f"{len(links)} edges from {len(figures_linked)} of {len(figures)} figures; "
        f"{len(auto)} of those edges are auto-accept, the rest need review.",
        "",
        "Matching is lexical — node name tokens against a figure's title, caption "
        'and OCR — so recall is bounded by vocabulary. A figure captioned "the '
        'retrieval step" never reaches a node named "Hybrid Search", and no '
        "threshold fixes that. **The uncovered count is therefore an upper bound on "
        "what this corpus evidences, not a claim that those nodes are unimportant.**",
        "",
        "A figure may only match nodes on branches the export already mapped it to. "
        "Without that fence the graph fills with edges that render convincingly and "
        "mean nothing.",
        "",
        "| # | Branch | Nodes | Reached | Edges |",
        "|---|---|--:|--:|--:|",
    ]

    for branch in sorted(branches, key=lambda b: -b.nodes):
        hit = {edge.node for edge in links if edge.branch_id == branch.id}
        edges = sum(1 for edge in links if edge.branch_id == branch.id)
        lines.append(f"| {branch.id} | {branch.name} | {branch.nodes} | {len(hit)} | {edges} |")

    lines += [
        "",
        "## The number this was built to produce",
        "",
        f"{total_nodes - len(reached)} of {total_nodes} nodes have no figure at all. "
        "Every one of them is a claim standing on somebody writing it down, with "
        "nothing from this corpus behind it. That is the same finding ontology v2 "
        "made at branch level, one level finer and considerably less comfortable.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    branches, figures = parse(EXPORT.read_text(encoding="utf-8"))
    links = link(branches, figures)

    LINKS.write_text(
        json.dumps(
            {
                "floor": FLOOR,
                "edges": [
                    {
                        "figure_id": edge.figure_id,
                        "branch_id": edge.branch_id,
                        "node": edge.node,
                        "score": round(edge.score, 4),
                        "band": edge.band,
                    }
                    for edge in links
                ],
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    COVERAGE.write_text(render(branches, figures, links), encoding="utf-8")

    reached = {(edge.branch_id, edge.node) for edge in links}
    total_nodes = sum(b.nodes for b in branches)
    print(f"{len(links)} edges · {len(reached)}/{total_nodes} nodes reached")
    print(f"  figures with at least one node: {len({e.figure_id for e in links})}/{len(figures)}")
    print(f"  auto-accept edges: {sum(1 for e in links if e.band == 'auto')}")
    print(f"\nwrote {LINKS.name} and {COVERAGE.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
