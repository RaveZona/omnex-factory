"""Validate the n8n binding catalogue, and say how much of it anybody has seen work.

    python scripts/n8n_bindings_check.py

`ontology_map.py` checks claims about branches. `invariant_map.py` checks this
repository's rules. This checks the one piece of configuration the engine cannot
derive and cannot verify: what an n8n node actually is.

## The number it exists to report

Not "how many bindings are written down" — writing one down costs nothing and
proves nothing. The number is **how many have been confirmed by an import**, and
today it is zero of seven. That figure can only go up when a person imports a
workflow into a real n8n instance and records their name against the binding, so
it is the one thing here a script cannot flatter.

The structural checks — a binding naming a node type that does not exist, a
confirmation with nobody behind it, a value shaped like a credential, a
network-calling node with no address and no explanation — all run on load and
raise together rather than one at a time.

Exits non-zero on a catalogue that will not load. It does **not** exit non-zero
on unconfirmed bindings: unconfirmed is the honest starting state of every entry,
and a permanently red build is one people learn to ignore.
"""

from __future__ import annotations

import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE / "src"))

from omnex.core.errors import ValidationFailed  # noqa: E402
from omnex.factory.compile import bindings  # noqa: E402

CATALOGUE = ENGINE / "ontology" / "n8n_bindings.json"


def main() -> int:
    try:
        catalogue = bindings.load(CATALOGUE)
    except ValidationFailed as exc:
        print(f"FAIL {exc}")
        return 1

    print(catalogue.summary())
    print()

    width = max((len(ref) for ref in catalogue.bindings), default=0)
    for ref, binding in sorted(catalogue.bindings.items()):
        node_type = catalogue.node_type_of(binding)
        if catalogue.is_confirmed(ref):
            status = f"confirmed by {binding.confirmed_by} on {binding.confirmed_at}"
        elif binding.confirmed:
            status = f"binding confirmed, node type {node_type.name!r} is not"
        else:
            status = f"proposed ({binding.source})"
        print(f"  {ref:<{width}}  {node_type.type:<32} {status}")

    unaddressed = sorted(
        ref
        for ref, binding in catalogue.bindings.items()
        if catalogue.node_type_of(binding).calls_out and not binding.parameters.get("url")
    )
    if unaddressed:
        print()
        print(
            f"{len(unaddressed)} binding(s) reach the network with no url, each "
            "carrying a note saying why:"
        )
        for ref in unaddressed:
            print(f"  {ref}")

    print()
    print(
        "Confirmed means somebody imported it and n8n accepted it. Nothing here "
        "can establish that, which is why the count is the number worth reading."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
