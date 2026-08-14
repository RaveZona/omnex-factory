# OMNEX Factory

Two codebases in one repository. `engine/` is a zero-dependency Python AI
platform (18 production systems). The Next.js app at the root is the commercial
surface that sells access to them.

## The commands that gate a change

```bash
# TypeScript — root
npx tsc --noEmit && npx vitest run && npx next build

# Python — from engine/
.venv/bin/ruff check src tests scripts \
  && .venv/bin/ruff format --check src tests \
  && .venv/bin/mypy \
  && .venv/bin/python -m pytest tests/ -q

# citegate — from oss/citegate/
../../engine/.venv/bin/python -m pytest tests/ -q
```

**`ruff format --check` is not optional.** Omitting it locally is what turned CI
red at `01c73c8`; `ruff check` passes on code `ruff format` would rewrite. CI
(`.github/workflows/engine.yml`) runs it on Python 3.11, 3.12 and 3.13.

Current state: **495 engine tests · 68 TypeScript · 15 citegate**, all green.

## engine/src/omnex/ — what each module is for

| module | what it does | the number it carries |
|---|---|---|
| `core` | Money (pico-dollars), Clock, errors, ids | — |
| `router` | cheap→verify→escalate routing | routed spend **42.4%** of always-strong at equal accuracy |
| `rag` | retrieval + page- and figure-anchored citations + grounding | **25–30k** sentences/sec, flat with document size |
| `vectors` | hybrid dense/lexical store, RRF | — |
| `guard` | injection fence, PII, rate limits, sandbox | **30/30** attacks, **1/30** false positives |
| `evals` | golden cases, metrics, regression gate | gates on newly-failing cases, not the mean |
| `crew` | multi-agent consensus, hash-chained audit | — |
| `hitl` | human approval bound to a fingerprint | — |
| `harness` | long-running loop: worth-it gate, contract, evaluator, edges, isolation, state, outer loop | outer loop watches **cost per accepted change** |
| `intel` | opportunity scanning over public sources | — |
| `memory` `obs` `graph` `llm` `serving` `finetune` `deploy` `tenancy` `pipeline` | agent memory · OTel+Prometheus · graph runtime · provider adapters · inference · LoRA/DPO · packaging · multi-tenancy · queues+webhooks | — |

### Non-obvious invariants — breaking these is silent

- **Money is `int` pico-dollars (1e-12 USD).** Micro-dollars round cheap-model
  tokens to zero, so a router that saves money reports saving nothing. Never
  introduce a float currency path.
- **Time comes from an injected `Clock`.** Nothing calls `datetime.now()` or
  `time.monotonic()` directly. `FakeClock` is why the suite asserts on hour-long
  TTLs and still runs in 7 seconds.
- **Zero required dependencies.** Heavy libraries (torch, transformers, pdf) sit
  behind Protocol adapters and are optional extras. A test must not need them.
- **`StrEnum` inherits `str` comparisons**, so `@total_ordering` fills in
  nothing. Any ordered `StrEnum` (e.g. `Tier`) must define all four comparisons
  explicitly.
- **A stated limitation is kept as a passing test.** `test_a_paraphrase_outside_
  the_corpus_is_missed` and the inverted-polarity grounding test are *supposed*
  to be green. Do not "fix" them; they are the honesty anchors.
- **Suite fingerprints refuse cross-suite comparison.** Editing an expected
  answer and re-running is otherwise indistinguishable from an improvement.

## Root app — the money path

- `lib/core/llm/provider.ts` — `LlmResult` carries an optional `usage` block.
  **This is the keystone**: without it nothing downstream can compute cost, and
  the copilot's cost panel reads €0.00 on every real run (the bug fixed in
  `3766976`).
- `lib/core/agents/metering.ts` — `priceCall()` returns `estimated: boolean`.
  An estimate is never displayed as a measurement.
- `lib/core/agents/budget.ts` — `estimateCostEur()` checks `cache:` **before**
  the unknown-provider fallback, or the one free path bills at the most
  expensive rate.
- `lib/modules/registry.ts` — module manifests. **Rule: module N+1 does not
  open until module N has taken a real payment.** Only `studio` is live;
  everything else is `enabled: false` on purpose, and `lib/__tests__/metering.
  test.ts` asserts `liveModules()` is exactly `['studio']`.
- Billing on the copilot: charged **on completion, proportional to measured
  cost, floor 1 credit**. Settlement runs in `onSettled` and fires on success,
  error **and** abort — a run that spent money and failed is the one an operator
  most needs to see.

## Where things live

- `engine/suites/` — benchmark suites + `LEADERBOARD.md` (fingerprint `884533eb08028871`)
- `engine/scripts/skill_numbers.py` — **the only source** of every number the
  skills publish. Re-measures rather than restates.
- `engine/ontology/` — the 28-branch map onto `engine/`. `branches.json` holds
  claims and contains **no figures**; `scripts/ontology_map.py` resolves every
  symbol to decide status and renders `COVERAGE.md`. A claim for code that does
  not import fails CI.
- `skills/` — five packaged skills, each carrying its measured number
- `intel/` — committed scan snapshots and reports
- `oss/citegate/` — standalone, dependency-free citation checker
- `packs/` — image-generation job packs (separate concern from `engine/`)

## Conventions that are already decided

- Docstrings explain **why**, and name the failure the code prevents. Match the
  surrounding density rather than adding a house style.
- Refusals name every failing condition at once, not the first — being refused
  repeatedly is how somebody concludes the check is the obstacle.
- Prefer a structural fix to a tuned threshold. `Fleet.assign()` refuses
  overlapping workspaces rather than trusting workers to take turns.
- New measured claims go in `skill_numbers.py` first, then get quoted.

## Lab notes — mistakes already paid for, do not repeat

- `ruff check` passing does not mean `ruff format --check` passes. Run both.
- A citation like `[url · 2026-08-05]` parses as the asserted figure "2026"
  unless citations are stripped *before* number extraction.
- Masking citations before sentence-splitting is required, **and** the restore
  must substitute only the placeholders a sentence contains — walking the whole
  citation list per sentence is O(n²) and cost 4.5s on a 4,000-sentence filing
  (fixed in `d8d3ca5`, guarded by a growth-ratio test).
- **That splitter exists twice.** `engine/src/omnex/rag/ingest.py` and
  `oss/citegate/src/citegate/grounding.py` are independent copies, on purpose —
  citegate ships dependency-free. The quadratic was fixed in the engine and
  survived in citegate for a further commit. Fix a splitter bug in both, or
  check the other before claiming it is fixed.
- **A benchmark whose shape cannot express a bug reports good numbers straight
  through it.** `bench.py` measured 5,000 answers of four sentences each, where
  the quadratic term is nothing, and published 46,279 sentences/sec while the
  same code did 1,439/sec on one long document. It now measures both shapes.
- A thin artifact (a 50-char PyPI summary) is not evidence of absence. The gap
  matrix excludes corpora under 200 chars and names them, because "nobody does
  model_routing" was nearly published about litellm, which *is* a router.
- The shell's cwd persists between calls and is often already `engine/`.
  `cd engine` then fails. Use absolute paths or check first.
- GitHub, Hugging Face, arXiv and HN Algolia are **403 through the proxy**.
  PyPI, npm, crates.io, GitLab and Docker Hub answer. Committed literals cover
  the blocked ones; don't rebuild a scraper that cannot reach its source.
