"""Three targets, one blueprint, and the round trip that decides whether they work.

A lossy compiler is invisible from its output. The workflow still imports, the
manifest still parses, the graph still runs — with a field quietly missing, and
the discovery happens at the first deployment that needed it. So the tests here
are mostly the same assertion applied three ways, plus the one that matters
most: proof that the assertion can fail.
"""

from __future__ import annotations

import json

import pytest

from omnex.core.errors import ValidationFailed
from omnex.core.money import Money
from omnex.factory import AgentSpec, Capability, CostModel, Paradigm, Tool
from omnex.factory.compile import (
    Target,
    assert_round_trips,
    code,
    mcp_topology,
    n8n,
    plan,
    round_trip,
)
from omnex.factory.compile.blueprint import Blueprint, Step, StepKind
from omnex.graph.runtime import END, Graph


def _spec(paradigm: Paradigm = Paradigm.REACT, **overrides: object) -> AgentSpec:
    base: dict[str, object] = {
        "name": "mcp-broker",
        "role": "answers currency questions over MCP tools",
        "capabilities": (
            Capability("MCP", "omnex.mcp.McpClient"),
            Capability("Cost Ledger", "omnex.obs.CostLedger"),
        ),
        "tools": (
            Tool("convert", "mcp", Money.from_usd("0.0001")),
            Tool("rates", "mcp", Money.from_usd("0.0000005")),
        ),
        "memory_policy": "nothing beyond the turn",
        "context_policy": "tool output enters untrusted",
        "paradigm": paradigm,
        "eval_suite": "fx_golden",
        "governance": "no spend above 1 USD without a human approval",
        "failure_modes": ("tool timeout", "unknown currency code"),
        "cost_model": CostModel(Money.from_usd("0.002"), Money.from_usd("0.0005")),
    }
    base.update(overrides)
    return AgentSpec(**base)  # type: ignore[arg-type]


ALL_PARADIGMS = list(Paradigm)


# ── the round trip, three targets by five paradigms ────────────────────────
@pytest.mark.parametrize("target", list(Target))
@pytest.mark.parametrize("paradigm", ALL_PARADIGMS)
def test_every_target_round_trips_every_paradigm(target: Target, paradigm: Paradigm) -> None:
    """`parse(emit(bp)) == bp`, for all fifteen combinations.

    A field added to `Blueprint` and forgotten in one emitter fails here rather
    than at the first deployment that needed it.
    """
    assert_round_trips(plan(_spec(paradigm)), target)


def test_the_round_trip_check_can_actually_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    """The test that makes the other fifteen worth running.

    A check that passes because it compares an artifact with itself proves
    nothing. This corrupts one field in the emitter and requires the difference
    to be named — not reported as a boolean, because "lossy" is not actionable and
    "step call_convert lost its ref" is.
    """
    blueprint = plan(_spec())
    original = mcp_topology.emit

    def lossy(bp: Blueprint) -> str:
        payload = json.loads(original(bp))
        for step in payload["steps"]:
            if step["kind"] == "tool":
                step["ref"] = "wrong.Reference"
        return json.dumps(payload)

    monkeypatch.setattr(mcp_topology, "emit", lossy)
    with pytest.raises(ValidationFailed, match="does not round-trip") as caught:
        assert_round_trips(blueprint, Target.MCP)
    assert any("call_convert" in d for d in caught.value.context["differences"])


def test_a_lost_edge_is_caught_too(monkeypatch: pytest.MonkeyPatch) -> None:
    """Losing an END edge is the failure a workflow hides best: it still opens."""
    blueprint = plan(_spec())
    original = n8n.emit

    def lossy(bp: Blueprint) -> str:
        payload = json.loads(original(bp))
        payload["meta"]["omnexEnds"] = []
        return json.dumps(payload)

    monkeypatch.setattr(n8n, "emit", lossy)
    with pytest.raises(ValidationFailed, match="does not round-trip"):
        assert_round_trips(blueprint, Target.N8N)


# ── the blueprint refuses ──────────────────────────────────────────────────
def test_a_step_that_goes_nowhere_is_refused() -> None:
    with pytest.raises(ValidationFailed, match="goes nowhere"):
        Step("orphan", StepKind.CONTROL, "", ())


def test_a_control_step_carrying_a_reference_is_refused() -> None:
    with pytest.raises(ValidationFailed, match="carries a reference"):
        Step("think", StepKind.CONTROL, "omnex.mcp.McpClient", (END,))


def test_a_dangling_target_is_named() -> None:
    blueprint = Blueprint(
        agent="a",
        spec_fingerprint="f",
        paradigm="single",
        entry="one",
        steps=(Step("one", StepKind.CONTROL, "", ("two",)),),
        tool_picos=(),
    )
    assert any("does not exist" in p for p in blueprint.validate())


def test_an_unreachable_step_is_named() -> None:
    """A node nothing routes to is a node that will never run, silently."""
    blueprint = Blueprint(
        agent="a",
        spec_fingerprint="f",
        paradigm="single",
        entry="one",
        steps=(
            Step("one", StepKind.CONTROL, "", (END,)),
            Step("stranded", StepKind.CONTROL, "", (END,)),
        ),
        tool_picos=(),
    )
    assert any("unreachable" in p for p in blueprint.validate())


def test_an_incomplete_spec_never_compiles() -> None:
    """An artifact that looks deployable and refers to nothing is worse than none."""
    with pytest.raises(ValidationFailed, match="not complete"):
        plan(_spec(capabilities=(Capability("Ghost", "omnex.mcp.Ghost"),)))


def test_the_same_paradigm_gives_the_same_skeleton() -> None:
    """Shape comes from the spec, so a difference in output means a difference in spec."""
    first = plan(_spec(Paradigm.PLANNER_EXECUTOR))
    second = plan(_spec(Paradigm.PLANNER_EXECUTOR, name="other", role="does another job"))
    assert [s.name for s in first.steps] == [s.name for s in second.steps]
    assert first.digest != second.digest, "the digest ignores the agent it describes"


# ── the code target runs ───────────────────────────────────────────────────
def test_the_emitted_graph_is_the_graph_the_runtime_executes() -> None:
    """The reason the code target emits an object rather than a file.

    Round-tripping source proves text survived a text transformation. Reading
    the built graph back through `topology()` proves the thing that would
    actually run has the topology the blueprint described.
    """
    blueprint = plan(_spec(Paradigm.PLANNER_EXECUTOR))
    graph = code.emit(blueprint)
    run = graph.run({"path": []})
    assert run.finished
    assert run.state["path"][0] == blueprint.entry
    assert run.state["path"][-1] == "review"


def test_a_branch_takes_the_target_the_state_names() -> None:
    blueprint = plan(_spec(Paradigm.REACT))
    graph = code.emit(blueprint)
    run = graph.run({"path": [], "observe_next": END})
    assert run.finished
    assert run.state["path"].count("think") == 1, "the loop did not exit where told"


def test_parse_refuses_a_graph_that_is_not_the_blueprint() -> None:
    """Reconstructing the missing parts from the original must not extend to inventing steps."""
    blueprint = plan(_spec())
    other = Graph()
    other.add_node("unrelated", lambda state: None)
    other.add_edge("unrelated", END)
    other.set_entry("unrelated")
    with pytest.raises(ValidationFailed, match="does not contain the steps"):
        code.parse(other, blueprint)


# ── the runtime gained a check ─────────────────────────────────────────────
def test_a_router_target_typo_now_fails_before_anything_runs() -> None:
    """Previously caught by `_next` mid-run, after earlier nodes had spent money."""
    graph = Graph()
    graph.add_node("start", lambda state: None)
    graph.add_conditional_edge("start", lambda state: "typo", targets=("typo",))
    graph.set_entry("start")
    with pytest.raises(ValidationFailed, match="declares unknown target"):
        graph.validate()


def test_topology_reports_declared_branches_and_plain_edges_alike() -> None:
    graph = Graph()
    graph.add_node("a", lambda state: None)
    graph.add_node("b", lambda state: None)
    graph.add_edge("a", "b")
    graph.add_conditional_edge("b", lambda state: END, targets=("a", END))
    graph.set_entry("a")
    assert graph.topology() == {"a": ("b",), "b": ("a", END)}


# ── the mcp manifest ───────────────────────────────────────────────────────
def test_prices_cross_the_wire_as_integer_picos() -> None:
    """The one field where a float is silently wrong rather than loudly wrong."""
    payload = json.loads(mcp_topology.emit(plan(_spec())))
    picos = [tool["picos"] for tool in payload["tools"]]
    assert all(isinstance(p, int) for p in picos)
    assert 500_000 in picos, "a half-micro-dollar tool lost its price"


def test_a_price_that_is_not_an_integer_is_refused_on_read() -> None:
    payload = json.loads(mcp_topology.emit(plan(_spec())))
    payload["tools"][0]["picos"] = 0.0001
    with pytest.raises(ValidationFailed, match="integer count of picos"):
        mcp_topology.parse(json.dumps(payload))


def test_a_manifest_from_another_version_is_refused() -> None:
    """Reading it anyway applies this version's meanings to another version's fields."""
    payload = json.loads(mcp_topology.emit(plan(_spec())))
    payload["manifest"] = 99
    with pytest.raises(ValidationFailed, match="version mismatch"):
        mcp_topology.parse(json.dumps(payload))


# ── the n8n workflow ───────────────────────────────────────────────────────
def test_every_n8n_node_says_in_the_file_that_it_is_a_placeholder() -> None:
    """Whoever imports this must read it there, not in a commit message.

    The spec names a tool and its price. It does not name the endpoint, the
    credential or the payload, and a compiler that filled those in would ship
    invented configuration as though somebody had supplied it.
    """
    payload = json.loads(n8n.emit(plan(_spec())))
    assert payload["nodes"]
    for node in payload["nodes"]:
        assert "Placeholder" in node["notes"]
        assert node["type"] == "n8n-nodes-base.noOp"


def test_the_canvas_reads_left_to_right_from_the_entry() -> None:
    """A workflow with every node at the origin is a pile, not a diagram."""
    blueprint = plan(_spec(Paradigm.PLANNER_EXECUTOR))
    payload = json.loads(n8n.emit(blueprint))
    positions = {node["name"]: node["position"] for node in payload["nodes"]}
    assert positions[blueprint.entry][0] == 0
    assert positions["review"][0] > positions[blueprint.entry][0]
    assert len({tuple(p) for p in positions.values()}) == len(positions), "two nodes overlap"


def test_a_hand_moved_node_does_not_read_back_as_a_topology_change() -> None:
    """Positions are canvas, not meaning. Somebody will drag a node."""
    blueprint = plan(_spec())
    payload = json.loads(n8n.emit(blueprint))
    payload["nodes"][0]["position"] = [9999, 9999]
    assert n8n.parse(json.dumps(payload)) == blueprint


def test_a_workflow_this_did_not_emit_is_refused_rather_than_guessed() -> None:
    with pytest.raises(ValidationFailed, match="not emitted from a blueprint"):
        n8n.parse(json.dumps({"name": "someone else's", "nodes": [], "connections": {}}))


# ── choosing a target ──────────────────────────────────────────────────────
def test_the_caller_chooses_the_target_and_nothing_defaults() -> None:
    from omnex.factory.compile import compile_spec

    spec = _spec()
    assert isinstance(compile_spec(spec, Target.CODE), Graph)
    assert isinstance(compile_spec(spec, Target.MCP), str)
    assert isinstance(compile_spec(spec, Target.N8N), str)


def test_all_three_targets_agree_on_the_same_topology() -> None:
    """The question the neutral blueprint exists to make answerable.

    "Does the n8n workflow do the same thing as the code" has no meaning while
    the two artifacts share no vocabulary. Through the blueprint it is one
    equality.
    """
    blueprint = plan(_spec())
    results = [round_trip(blueprint, target) for target in Target]
    assert all(result.digest == blueprint.digest for result in results)
    assert len({result.digest for result in results}) == 1
