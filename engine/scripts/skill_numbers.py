"""Re-measure every number the packaged skills claim.

A skill that says "cuts spend by half" and cannot show the run that produced the
half is marketing. Every figure in `skills/*/SKILL.md` comes out of this script,
so a reader who does not trust the claim can produce it themselves in one
command, and a change that quietly degrades one of these systems moves the
number here before anybody has to notice it in production.

    python scripts/skill_numbers.py

Two of the five figures come from other committed artifacts rather than from
this file — the FinGround rows are `scripts/leaderboard.py` and the suite
fingerprint pins them — and this script reads and re-prints them rather than
restating them from memory, which is how the two drift apart.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from random import Random

from omnex.core import FakeClock, Money
from omnex.guard.injection import InjectionDetector
from omnex.llm import CallOptions, CapabilityModel, Message, Task, Tier, spec_for
from omnex.rag import Grounder
from omnex.router import Router, RoutingPolicy
from omnex.vectors import Chunk

ROOT = Path(__file__).resolve().parents[1]

# Synthetic prices with an obvious ratio: the strong tier is exactly 30x the
# cheap one on output. Deliberately not the shipped catalogue — a vendor
# repricing must not silently change a published figure.
CHEAP = spec_for("test/cheap", Tier.SMALL, "0.05", "0.10")
STRONG = spec_for("test/strong", Tier.LARGE, "1.50", "3.00")


def _msg(text: str) -> list[Message]:
    return [Message("user", text)]


def _benchmark_tasks() -> dict[str, Task]:
    """200 tasks: 120 genuinely easy, 60 genuinely hard, 20 hard in disguise.

    The last 20 are the point. They read like lookups and are not, so a
    classifier alone routes them wrong and only the verifier catches it.
    """
    tasks: dict[str, Task] = {}
    for i in range(120):
        p = f"Classify ticket {i} as billing or technical: the card was declined at checkout."
        tasks[p] = Task(p, Tier.SMALL, "billing")
    for i in range(60):
        p = (
            f"Why does service {i} deadlock under load, and compare the trade-offs "
            f"of each fix step by step?"
        )
        tasks[p] = Task(p, Tier.LARGE, "Lock ordering.")
    for i in range(20):
        p = f"What is the capital of the country whose central bank set rate {i} in 1997?"
        tasks[p] = Task(p, Tier.LARGE, "Prague")
    return tasks


def router_numbers() -> dict[str, object]:
    """Routed spend against the always-strong ceiling, at equal accuracy.

    Equal accuracy is the condition that makes the saving mean anything. A
    router that is cheaper and worse is not a router, it is a downgrade, so the
    accuracy figures are printed next to the money.
    """
    tasks = _benchmark_tasks()
    prompts = list(tasks)

    def baseline(spec: object) -> tuple[Money, int]:
        model = CapabilityModel(model_spec=spec, tasks=tasks, reference=STRONG)  # type: ignore[arg-type]
        cost, correct = Money.zero(), 0
        for p in prompts:
            completion = model.complete(_msg(p), CallOptions())
            cost = cost + completion.cost
            correct += completion.text == tasks[p].answer
        return cost, correct

    cheap_cost, cheap_correct = baseline(CHEAP)
    strong_cost, strong_correct = baseline(STRONG)

    router = Router(
        [
            CapabilityModel(model_spec=CHEAP, tasks=tasks, reference=STRONG),
            CapabilityModel(model_spec=STRONG, tasks=tasks, reference=STRONG),
        ],
        policy=RoutingPolicy(),
        clock=FakeClock(),
        rng=Random(1),
    )
    router.calibrate()

    routed_cost, routed_correct, escalated = Money.zero(), 0, 0
    for p in prompts:
        result = router.route(_msg(p))
        routed_cost = routed_cost + result.total_cost
        routed_correct += (
            result.completion is not None and result.completion.text == tasks[p].answer
        )
        escalated += result.escalated

    return {
        "routed_share_of_strong": routed_cost.picos / strong_cost.picos,
        "escalation_rate": router.economics.escalation_rate,
        "break_even": router.economics.break_even(),
        "cheap_only_accuracy": cheap_correct / len(prompts),
        "strong_only_accuracy": strong_correct / len(prompts),
        "routed_accuracy": routed_correct / len(prompts),
        "escalated": escalated,
        "cheap_only_cost": cheap_cost,
        "strong_only_cost": strong_cost,
        "routed_cost": routed_cost,
    }


def grounder_numbers(sentences: int = 20_000) -> dict[str, object]:
    """Verification throughput, and the two verdicts that matter.

    Throughput is worth stating because the usual objection to verifying every
    sentence is that it costs a second model call. It does not: this check is
    lexical and runs on the machine that already has the answer.
    """
    evidence = [
        Chunk(
            id="c1",
            text=(
                "Revenue for the quarter was 4.2 million euro, up from 3.1 million. "
                "The company operates 12 regional offices across Europe."
            ),
            doc_id="d1",
            page=7,
        )
    ]
    grounder = Grounder()

    supported = "Revenue for the quarter was 4.2 million euro. [p. 7]"
    invented = "Revenue for the quarter was 9.9 million euro. [p. 7]"
    fabricated = "Revenue for the quarter was 4.2 million euro. [p. 99]"

    answer = " ".join([supported] * sentences)
    started = time.perf_counter()
    checked = grounder.check(answer, evidence)
    elapsed = time.perf_counter() - started

    return {
        "sentences_per_second": len(checked.checks) / elapsed if elapsed else float("inf"),
        "sentences": len(checked.checks),
        "supported_kept": grounder.check(supported, evidence).checks[0].keep,
        "wrong_number_dropped": not grounder.check(invented, evidence).checks[0].keep,
        "uncited_page_dropped": not grounder.check(fabricated, evidence).checks[0].keep,
    }


def injection_numbers() -> dict[str, object]:
    """Detection and false-positive rates over the committed corpus.

    Printed as fractions rather than percentages on purpose: 30/30 says the
    corpus is small and saturated, where "100%" invites the reading that the
    problem is solved. It is not — the missed-paraphrase test in
    `tests/test_guard.py` is the honest counterweight and stays green.
    """
    corpus = json.loads((ROOT / "tests/data/injection_corpus.json").read_text())
    detector = InjectionDetector()
    attacks = corpus["attacks"]
    benign = corpus["benign"]
    caught = sum(detector.is_injection(e["text"]) for e in attacks)
    flagged = sum(detector.is_injection(e["text"]) for e in benign)
    return {
        "detected": f"{caught}/{len(attacks)}",
        "false_positives": f"{flagged}/{len(benign)}",
        "detection_rate": caught / len(attacks),
        "false_positive_rate": flagged / len(benign),
    }


def finground_numbers() -> dict[str, object]:
    """Read the committed leaderboard rather than restating it.

    Restating a number from memory next to the artifact that produces it is how
    a document and its evidence quietly disagree.
    """
    text = (ROOT / "suites/LEADERBOARD.md").read_text()
    rows: dict[str, dict[str, str]] = {}
    for line in text.splitlines():
        if not line.startswith("| ") or line.startswith("| System") or "---" in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) >= 7:
            rows[cells[0]] = {"overall": cells[1], "refusal": cells[5], "hallucination": cells[6]}
    fingerprint = re.search(r"fingerprint `([0-9a-f]+)`", text)
    return {
        "fingerprint": fingerprint.group(1) if fingerprint else "unknown",
        "rows": rows,
    }


def main() -> None:
    router = router_numbers()
    print("cost-router  (scripts/skill_numbers.py)")
    print(f"  routed spend        {router['routed_share_of_strong']:.1%} of always-strong")
    print(f"  escalation rate     {router['escalation_rate']:.1%}")
    print(f"  break-even rate     {router['break_even']:.1%}")  # type: ignore[str-format]
    print(
        f"  accuracy            cheap-only {router['cheap_only_accuracy']:.1%} · "
        f"routed {router['routed_accuracy']:.1%} · strong-only {router['strong_only_accuracy']:.1%}"
    )

    ground = grounder_numbers()
    print("\ngrounded-answers  (scripts/skill_numbers.py)")
    print(f"  throughput          {ground['sentences_per_second']:,.0f} sentences/sec")
    print(f"  supported kept      {ground['supported_kept']}")
    print(f"  wrong number cut    {ground['wrong_number_dropped']}")
    print(f"  uncited page cut    {ground['uncited_page_dropped']}")

    injection = injection_numbers()
    print("\ninjection-corpus  (tests/data/injection_corpus.json)")
    print(f"  detected            {injection['detected']}")
    print(f"  false positives     {injection['false_positives']}")

    fin = finground_numbers()
    print(f"\nfinground  (suites/LEADERBOARD.md, fingerprint {fin['fingerprint']})")
    for name, row in fin["rows"].items():  # type: ignore[union-attr]
        print(
            f"  {name:<22}{row['overall']} overall · {row['refusal']} refusal · "
            f"{row['hallucination']} hallucination"
        )


if __name__ == "__main__":
    main()
