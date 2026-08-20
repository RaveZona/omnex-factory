"""The n8n target: a workflow JSON somebody else can host. Branch XI's named gap.

`omnex.pipeline` already runs jobs — queues, workers, webhooks with signature
verification, idempotency, retries, dead letters. What did not exist was emitting
that shape as something a person can import into an n8n instance they own. This
is that, and it is the only one of the three targets that leaves the process.

## What is honestly in the output, and what is not

Nodes are **placeholders**. A blueprint is a topology; an `AgentSpec` names a
tool and its price and says nothing about which HTTP endpoint it is, what
credential it uses, or what body it posts. A compiler that filled those in would
be writing configuration nobody supplied and shipping it as though somebody had —
and the failure lands on whoever imports the workflow and watches it call the
wrong host with the wrong key.

So every node is `n8n-nodes-base.noOp`, carrying the reference it stands for and
the price in picos in its parameters. The result is a wiring diagram that
imports, lays out correctly, and does nothing until a person fills in each node.
That is the honest artifact. `notes` on every node says so inside the file,
where whoever opens it will actually read it.

## Positions

n8n lays nodes out on a canvas and a workflow with every node at the origin is
unreadable. Positions are derived from distance-from-entry so the diagram opens
looking like the graph rather than like a pile, and they are recomputed on parse
rather than trusted, so a hand-moved node does not read back as a topology
change.
"""

from __future__ import annotations

import json
from typing import Any

from ...core.errors import ValidationFailed
from ...graph.runtime import END
from .blueprint import Blueprint, Step, StepKind

__all__ = ["emit", "parse"]

NOOP = "n8n-nodes-base.noOp"
COLUMN = 260
ROW = 140

PLACEHOLDER_NOTE = (
    "Placeholder. This node's behaviour was not specified — the agent spec names "
    "the capability and its price, not the endpoint, credential or payload. Fill "
    "it in before running."
)


def _depths(blueprint: Blueprint) -> dict[str, int]:
    """Distance from the entry, breadth-first, so the canvas reads left to right."""
    depth = {blueprint.entry: 0}
    frontier = [blueprint.entry]
    while frontier:
        name = frontier.pop(0)
        step = blueprint.by_name(name)
        if step is None:
            continue
        for target in step.goes_to:
            if target != END and target not in depth:
                depth[target] = depth[name] + 1
                frontier.append(target)
    for step in blueprint.steps:
        depth.setdefault(step.name, 0)
    return depth


def _positions(blueprint: Blueprint) -> dict[str, list[int]]:
    depth = _depths(blueprint)
    rows: dict[int, int] = {}
    out: dict[str, list[int]] = {}
    for step in blueprint.steps:
        column = depth[step.name]
        row = rows.get(column, 0)
        rows[column] = row + 1
        out[step.name] = [column * COLUMN, row * ROW]
    return out


def emit(blueprint: Blueprint) -> str:
    blueprint.raise_if_invalid()
    prices = dict(blueprint.tool_picos)
    positions = _positions(blueprint)

    nodes: list[dict[str, Any]] = []
    for step in blueprint.steps:
        parameters: dict[str, Any] = {"omnexKind": str(step.kind), "omnexRef": step.ref}
        if step.kind is StepKind.TOOL:
            parameters["omnexPricePicos"] = prices.get(step.ref, 0)
        nodes.append(
            {
                "name": step.name,
                "type": NOOP,
                "typeVersion": 1,
                "position": positions[step.name],
                "parameters": parameters,
                "notes": PLACEHOLDER_NOTE,
            }
        )

    connections: dict[str, Any] = {}
    for step in blueprint.steps:
        outgoing = [
            {"node": target, "type": "main", "index": 0} for target in step.goes_to if target != END
        ]
        # A step whose only target is END still needs its entry in the map, or
        # reading the workflow back loses the edge and the round trip passes by
        # having forgotten the same thing twice.
        connections[step.name] = {"main": [outgoing]}

    payload = {
        "name": blueprint.agent,
        "nodes": nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "meta": {
            "omnexSpec": blueprint.spec_fingerprint,
            "omnexParadigm": blueprint.paradigm,
            "omnexEntry": blueprint.entry,
            "omnexEnds": sorted(s.name for s in blueprint.steps if END in s.goes_to),
            "omnexOrder": [s.name for s in blueprint.steps],
            # Prices belong to the AGENT, not to whichever node happens to
            # reference a tool. Reading them back off the tool nodes lost every
            # price in four of the five paradigms, where tools are resources the
            # steps use rather than steps of their own — and the workflow still
            # imported, so nothing said so.
            "omnexToolPicos": [[name, picos] for name, picos in blueprint.tool_picos],
        },
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def parse(payload: str) -> Blueprint:
    raw: dict[str, Any] = json.loads(payload)
    meta = raw.get("meta") or {}
    if "omnexEntry" not in meta:
        raise ValidationFailed(
            "this workflow was not emitted from a blueprint; without the entry "
            "node and step order there is nothing to compare against"
        )

    connections = raw.get("connections") or {}
    ends = set(meta.get("omnexEnds") or [])
    by_name = {node["name"]: node for node in raw.get("nodes") or []}

    steps: list[Step] = []
    for name in meta.get("omnexOrder") or list(by_name):
        node = by_name[name]
        parameters = node.get("parameters") or {}
        outgoing = tuple(
            entry["node"]
            for group in (connections.get(name, {}).get("main") or [])
            for entry in group
        )
        if name in ends:
            outgoing = (*outgoing, END)
        steps.append(
            Step(
                name=name,
                kind=StepKind(parameters.get("omnexKind", StepKind.CONTROL)),
                ref=str(parameters.get("omnexRef", "")),
                goes_to=outgoing,
            )
        )

    tools: list[tuple[str, int]] = []
    for entry in meta.get("omnexToolPicos") or []:
        name, picos = entry
        if not isinstance(picos, int) or isinstance(picos, bool):
            raise ValidationFailed(
                "a price arrived as something other than an integer count of picos",
                tool=name,
                got=repr(picos),
            )
        tools.append((str(name), picos))
    return Blueprint(
        agent=str(raw["name"]),
        spec_fingerprint=str(meta["omnexSpec"]),
        paradigm=str(meta["omnexParadigm"]),
        entry=str(meta["omnexEntry"]),
        steps=tuple(steps),
        tool_picos=tuple(sorted(tools)),
    )
