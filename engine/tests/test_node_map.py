"""The node map — 507 capabilities, and the rule a machine may not break.

`ontology_map.py` is guarded because a branch claim decays when a symbol moves.
This file guards something sharper: the map is largely MACHINE-PROPOSED, and the
temptation it creates is for the proposer to also award itself the coverage. The
load-bearing test is `test_no_node_is_implemented_without_a_human`, which is the
frozen-criteria rule one level below where `ontology_map.py` enforces it.
"""

from __future__ import annotations

import json

import pytest
from ingest_atlas import EXPECTED_NODES
from node_map import CLAIMS, NODES, Node, audit, load, propose, public_symbols, render

pytestmark = pytest.mark.skipif(
    not NODES.exists(), reason="the node claim file is not in this checkout"
)

ALL = load() if NODES.exists() else []


def test_every_node_the_export_declares_is_classified() -> None:
    assert len(ALL) == EXPECTED_NODES


def test_no_node_is_implemented_without_a_human() -> None:
    """A proposer that can also confirm its proposals grades its own work.

    Whether `omnex.vectors.HybridStore` *is* "Vector Search" is a judgement about
    meaning, and it is exactly the judgement a system measuring its own coverage
    gets generously wrong. Resolution is mechanical and stays mechanical;
    agreement is not and may not become so.
    """
    for node in ALL:
        if node.claim == "implemented":
            assert node.verified, f"{node.branch}/{node.name}"


def test_every_alias_resolves_right_now() -> None:
    """The map cannot describe a repository that has been refactored out from under it."""
    problems = audit(ALL)
    assert not problems, problems[:5]


def test_a_claim_above_gap_must_name_an_alias() -> None:
    for node in ALL:
        if node.claim != "gap":
            assert node.alias, f"{node.branch}/{node.name} claims {node.claim} with no alias"
        assert node.claim in CLAIMS


def test_an_alias_pointing_at_nothing_is_caught() -> None:
    """The guard, observed failing, rather than assumed wired."""
    liar = Node(
        branch="XII",
        name="Fabricated",
        claim="proposed",
        alias="omnex.router.NoSuchSymbol",
        verified=False,
    )
    problems = audit([liar])
    assert problems and "NoSuchSymbol" in problems[0]


def test_claiming_implemented_without_verification_is_caught() -> None:
    cheat = Node(
        branch="XII",
        name="Fabricated",
        claim="implemented",
        alias="omnex.router.Router",
        verified=False,
    )
    problems = audit([cheat])
    assert any("human verification" in p for p in problems)


def test_proposals_stay_conservative() -> None:
    """A looser rule makes a longer list a reviewer must DISPROVE one by one.

    That is how a review queue becomes a rubber stamp: the cost of rejecting is
    paid per item, the cost of accepting everything is paid once.
    """
    symbols = public_symbols()
    assert propose("Bananas In Transit", symbols) is None
    assert propose("Router", symbols) == "omnex.router.Router"


def test_the_document_says_a_machine_may_not_award_coverage() -> None:
    page = render(ALL)
    assert "did not decide that two names mean the same thing" in page
    assert "correct, not pessimistic" in page


def test_the_claim_file_is_valid_json_with_every_field() -> None:
    raw = json.loads(NODES.read_text(encoding="utf-8"))
    assert len(raw["nodes"]) == EXPECTED_NODES
    for entry in raw["nodes"]:
        assert set(entry) >= {"branch", "name", "claim", "alias", "verified"}
