"""P2 — cost-optimised model routing.

Routes by predicted complexity, verifies the answer, escalates when the cheap
tier did not actually answer, falls back sideways when a provider failed, and
enforces a spend ceiling before dispatch rather than after.

The part worth reading first is `economics.py`. It computes the escalation rate
above which routing costs *more* than having no router at all — one minus the
price ratio between tiers — and checks observed traffic against it. A router
whose cheap tier is only 2× cheaper starts losing money past 50% escalation
while still looking busy, and almost nobody measures it.
"""

from .complexity import Complexity, ComplexityClassifier
from .economics import RouterEconomics, break_even_escalation_rate, recommended_bias
from .router import RoutedCompletion, Router, RouteStep, RoutingPolicy
from .verify import HeuristicVerifier, JsonVerifier, Verdict, Verifier, all_of

__all__ = [
    "Complexity",
    "ComplexityClassifier",
    "HeuristicVerifier",
    "JsonVerifier",
    "RouteStep",
    "RoutedCompletion",
    "Router",
    "RouterEconomics",
    "RoutingPolicy",
    "Verdict",
    "Verifier",
    "all_of",
    "break_even_escalation_rate",
    "recommended_bias",
]
