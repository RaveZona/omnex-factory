"""Figure-to-node edges — the properties that stop a graph from lying convincingly.

A knowledge graph fails differently from a pipeline. A pipeline that breaks stops
producing; a graph that breaks produces *more* — edges that render, cluster and
look like structure while meaning nothing. Nobody reading the picture can tell.

So the tests here are mostly refusals. The fence, the stopword rule, and the
dynamic-range check each exist because without them the edge count goes UP and
the result gets worse.
"""

from __future__ import annotations

import pytest
from ingest_atlas import EXPORT, parse
from link_nodes import FLOOR, STOPWORDS, inverse_frequency, link, score_match, tokens

pytestmark = pytest.mark.skipif(
    not EXPORT.exists(), reason="the Universal AI OS export is not in this checkout"
)


def _linked():
    branches, figures = parse(EXPORT.read_text(encoding="utf-8"))
    return branches, figures, link(branches, figures)


def test_no_edge_crosses_into_a_branch_the_figure_never_touched() -> None:
    """The fence, and the reason the graph is not simply larger.

    Node names repeat across branches — "Router", "Cache", "Queue". Without the
    export's own branch mapping as a boundary, one caption reaches every branch
    that happens to share a word, and the graph fills with edges that survive
    every visual inspection.
    """
    branches, _, links = _linked()
    touched = {b.id: set(b.touched) for b in branches}
    for edge in links:
        assert edge.figure_id in touched[edge.branch_id], (
            f"{edge.figure_id} was linked to {edge.branch_id}, which it does not touch"
        )


def test_every_edge_names_a_node_that_exists_on_that_branch() -> None:
    branches, _, links = _linked()
    names = {b.id: set(b.node_names) for b in branches}
    for edge in links:
        assert edge.node in names[edge.branch_id], f"{edge.node} is not on {edge.branch_id}"


def test_a_single_common_word_does_not_make_an_edge() -> None:
    """ "Agent Memory" must not attach to every figure that says "agent"."""
    weight = {"agent": 0.1, "memory": 0.4, "hnsw": 5.0}
    assert score_match({"agent", "memory"}, {"agent"}, weight) == 0.0
    # A rare token alone is evidence, and is allowed through.
    assert score_match({"hnsw"}, {"hnsw"}, weight) >= FLOOR


def test_a_node_made_entirely_of_stopwords_can_never_match() -> None:
    assert score_match({"the", "agent"}, {"the", "agent"}, {}) == 0.0
    assert "agent" in STOPWORDS


def test_the_score_has_real_dynamic_range() -> None:
    """The check that caught this file's own first version.

    Scoring a match as the plain share of node tokens present put 452 of 453
    edges in the top band — a confidence score that cannot separate anything,
    and a review queue empty by construction rather than by quality. Weighting
    by token rarity restored the spread. If this ever collapses again, the
    banding has gone back to being decoration.
    """
    _, _, links = _linked()
    bands = {edge.band for edge in links}
    assert len(bands) > 1, "every edge landed in one band — the score is not measuring"
    top = sum(1 for edge in links if edge.band == "auto")
    assert top < len(links), "nothing needs review, which is not a result, it is a bug"


def test_rarity_ranks_a_distinctive_match_above_a_generic_one() -> None:
    _, figures = parse(EXPORT.read_text(encoding="utf-8"))
    weight = inverse_frequency(figures)
    common = [t for t in weight if weight[t] < 1.0]
    rare = [t for t in weight if weight[t] > 4.0]
    assert common and rare, "the corpus should contain both frequent and rare tokens"
    assert max(weight[t] for t in rare) > max(weight[t] for t in common)


def test_the_uncovered_count_is_reported_as_an_upper_bound() -> None:
    """Lexical matching misses paraphrase, and the document must not pretend otherwise.

    A reader who takes "373 nodes uncovered" as "373 nodes the field ignores"
    has been misled by this repository rather than by the corpus.
    """
    from link_nodes import COVERAGE

    page = COVERAGE.read_text(encoding="utf-8")
    assert "upper bound" in page
    assert "bounded by vocabulary" in page


def test_tokens_ignores_single_characters() -> None:
    assert tokens("A B mcp") == {"mcp"}
