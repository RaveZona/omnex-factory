"""Classify every node in the ontology against code that actually imports.

    python scripts/node_map.py

`ontology_map.py` answers "which of 28 branches does `engine/` cover". That is
the resolution at which the answer is comfortable. This asks the same question of
all 507 NODES, which is the resolution at which it is not.

## Three claims, and why `implemented` is not one a machine may award

A node name will never equal a symbol name — "Vector Search" is
`omnex.vectors.HybridStore`, and no amount of string handling makes that
identity. So each node carries an **alias**: a dotted symbol somebody asserts
means the same capability.

    gap          no alias. Nothing in `engine/` is even a candidate.
    proposed     an alias that IMPORTS, proposed by lexical match, confirmed by
                 nobody. The symbol exists; whether it means the same thing is
                 an open question.
    implemented  a proposed alias a human has marked `verified`.

The machine may propose and may verify that a symbol resolves. It may not decide
that two names mean the same capability, because that is precisely the judgement
a system grading its own coverage would get generously wrong — the frozen-criteria
problem, one level down from where `ontology_map.py` refuses it.

So a freshly generated map reports **zero implemented**, and that is correct
rather than pessimistic. Coverage here is earned by a person reading a proposal
and agreeing with it, one node at a time.

## What the number replaces

Every gap count quoted before this was measured against 28 branches or against a
list somebody wrote down. This one is measured against 507 named capabilities and
320 exported symbols, and it can be re-derived from the repository at any time.
"""

from __future__ import annotations

import importlib
import json
import pkgutil
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ingest_atlas import EXPECTED_NODES, EXPORT, parse
from ontology_map import resolve

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
NODES = ROOT / "ontology" / "nodes.json"
OUTPUT = REPO / "corpus" / "universal-ai-os" / "NODE_MAP.md"

CLAIMS = ("implemented", "proposed", "gap")


@dataclass
class Node:
    """One capability the ontology names, and what in `engine/` might be it."""

    branch: str
    name: str
    claim: str
    alias: str | None
    verified: bool
    note: str = ""
    #: Set by the audit, never stored: whether the alias imports right now.
    resolves: bool = field(default=False, compare=False)


def public_symbols() -> dict[str, str]:
    """Every name the package exports, mapped to the module that exports it."""
    import omnex

    found: dict[str, str] = {}
    for module in pkgutil.iter_modules(omnex.__path__):
        if module.name.startswith("_"):
            continue
        dotted = f"omnex.{module.name}"
        try:
            loaded = importlib.import_module(dotted)
        except ImportError:  # pragma: no cover - an optional extra is absent
            continue
        for name in getattr(loaded, "__all__", []):
            found.setdefault(name, dotted)
    return found


def _split_symbol(name: str) -> set[str]:
    parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+", name)
    return {p.lower() for p in parts if len(p) > 1}


def _split_node(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", name.lower()) if len(t) > 1}


def propose(node_name: str, symbols: dict[str, str]) -> str | None:
    """Suggest a dotted symbol for a node name, or nothing.

    Deliberately conservative: an exact token-set match, or one set wholly
    contained in the other. A looser rule produces a longer list of proposals
    that a reviewer then has to disprove one by one, which is how a review queue
    becomes a rubber stamp.
    """
    wanted = _split_node(node_name)
    if not wanted:
        return None
    best: tuple[str, float] | None = None
    for symbol, module in symbols.items():
        have = _split_symbol(symbol)
        if not have:
            continue
        if wanted == have:
            score = 1.0
        elif wanted <= have or have <= wanted:
            score = 0.8
        else:
            continue
        if best is None or score > best[1]:
            best = (f"{module}.{symbol}", score)
    return best[0] if best else None


def load() -> list[Node]:
    raw: dict[str, Any] = json.loads(NODES.read_text(encoding="utf-8"))
    return [
        Node(
            branch=entry["branch"],
            name=entry["name"],
            claim=entry["claim"],
            alias=entry["alias"],
            verified=entry["verified"],
            note=entry.get("note", ""),
        )
        for entry in raw["nodes"]
    ]


def generate() -> list[Node]:
    """Build the first version of the claim file from the export plus the code."""
    branches, _ = parse(EXPORT.read_text(encoding="utf-8"))
    symbols = public_symbols()
    nodes: list[Node] = []
    for branch in branches:
        for name in branch.node_names:
            alias = propose(name, symbols)
            nodes.append(
                Node(
                    branch=branch.id,
                    name=name,
                    claim="proposed" if alias else "gap",
                    alias=alias,
                    verified=False,
                )
            )
    return nodes


def audit(nodes: list[Node]) -> list[str]:
    """Every rule, collected — refusals are reported together, never one at a time."""
    problems: list[str] = []
    for node in nodes:
        if node.claim not in CLAIMS:
            problems.append(f"{node.branch}/{node.name}: claim {node.claim!r} is unknown")

        if node.alias:
            reason = resolve(node.alias)
            node.resolves = reason is None
            if reason is not None:
                problems.append(f"{node.branch}/{node.name}: alias {node.alias} — {reason}")
        elif node.claim != "gap":
            problems.append(f"{node.branch}/{node.name}: claims {node.claim!r} with no alias")

        if node.claim == "implemented" and not node.verified:
            problems.append(
                f"{node.branch}/{node.name}: 'implemented' without a human verification"
            )
        if node.verified and not node.alias:
            problems.append(f"{node.branch}/{node.name}: verified nothing")
    return problems


def render(nodes: list[Node]) -> str:
    counts = {claim: sum(1 for n in nodes if n.claim == claim) for claim in CLAIMS}
    by_branch: dict[str, list[Node]] = {}
    for node in nodes:
        by_branch.setdefault(node.branch, []).append(node)

    lines = [
        "# Node map — 507 capabilities against code that imports",
        "",
        "Generated by `engine/scripts/node_map.py`. Do not edit.",
        "",
        f"**{counts['gap']} of {len(nodes)} nodes have no candidate in `engine/` at "
        f"all.** {counts['proposed']} have an alias that imports but that nobody has "
        f"confirmed means the same capability. {counts['implemented']} are confirmed.",
        "",
        "A machine proposed every alias here by lexical match and verified that each "
        "one imports. It did not decide that two names mean the same thing, and it "
        "may not: that is the judgement a system grading its own coverage gets "
        "generously wrong. `implemented` is earned by a person reading a proposal "
        "and agreeing with it, one node at a time — so a freshly generated map "
        "reporting zero implemented is correct, not pessimistic.",
        "",
        "Every gap count quoted before this one was measured against 28 branches or "
        "against a list somebody wrote down. This is measured against 507 named "
        "capabilities and the package's own exported symbols.",
        "",
        "| # | Nodes | gap | proposed | implemented |",
        "|---|--:|--:|--:|--:|",
    ]
    for branch in sorted(by_branch, key=lambda b: -len(by_branch[b])):
        rows = by_branch[branch]
        lines.append(
            f"| {branch} | {len(rows)} | "
            f"{sum(1 for n in rows if n.claim == 'gap')} | "
            f"{sum(1 for n in rows if n.claim == 'proposed')} | "
            f"{sum(1 for n in rows if n.claim == 'implemented')} |"
        )

    lines += ["", "## Proposals awaiting a human", ""]
    for node in sorted(nodes, key=lambda n: (n.branch, n.name)):
        if node.claim == "proposed":
            lines.append(f"- `{node.branch}` **{node.name}** → `{node.alias}`")
    lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    if NODES.exists():
        nodes = load()
    else:
        nodes = generate()
        NODES.write_text(
            json.dumps(
                {
                    "ontology_version": "2",
                    "nodes": [
                        {
                            "branch": n.branch,
                            "name": n.name,
                            "claim": n.claim,
                            "alias": n.alias,
                            "verified": n.verified,
                            "note": n.note,
                        }
                        for n in nodes
                    ],
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

    problems = audit(nodes)
    if len(nodes) != EXPECTED_NODES:
        problems.append(f"{len(nodes)} nodes loaded, the export declares {EXPECTED_NODES}")

    if problems:
        for problem in problems[:20]:
            print(f"FAIL {problem}")
        if len(problems) > 20:
            print(f"... and {len(problems) - 20} more")
        return 1

    OUTPUT.write_text(render(nodes), encoding="utf-8")
    counts = {claim: sum(1 for n in nodes if n.claim == claim) for claim in CLAIMS}
    print(f"{len(nodes)} nodes · {len(public_symbols())} exported symbols")
    print(f"  gap          {counts['gap']}")
    print(f"  proposed     {counts['proposed']}  (alias imports, unconfirmed)")
    print(f"  implemented  {counts['implemented']}  (a person agreed)")
    print(f"\nwrote {OUTPUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
