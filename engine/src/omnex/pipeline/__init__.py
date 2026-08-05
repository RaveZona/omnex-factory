"""P16 — agentic automation: webhooks, async execution, idempotency, dead letters.

An idempotency key covers the PAYLOAD as well as the key: the usual
implementation returns a cached result for a repeated key, which is right for a
retry and catastrophic for a caller that reused a key with a different body.
Dead letters keep everything needed to replay — a DLQ holding only error
messages is a list of things you know broke and cannot retry.
"""

from .queue import (
    DeadLetter,
    IdempotencyStore,
    InMemoryBroker,
    Job,
    JobState,
    Worker,
    payload_hash,
)
from .webhook import WebhookEvent, WebhookVerifier, verify_signature

__all__ = [
    "DeadLetter",
    "IdempotencyStore",
    "InMemoryBroker",
    "Job",
    "JobState",
    "WebhookEvent",
    "WebhookVerifier",
    "Worker",
    "payload_hash",
    "verify_signature",
]
