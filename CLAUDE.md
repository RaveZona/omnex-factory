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
  && .venv/bin/ruff format --check src tests scripts \
  && .venv/bin/mypy \
  && .venv/bin/python -m pytest tests/ -q

# citegate — from oss/citegate/
../../engine/.venv/bin/python -m pytest tests/ -q
```

**`ruff format --check` is not optional.** Omitting it locally is what turned CI
red at `01c73c8`; `ruff check` passes on code `ruff format` would rewrite. CI
(`.github/workflows/engine.yml`) runs it on Python 3.11, 3.12 and 3.13.

**This block is not documentation, it is an assertion.**
`engine/tests/test_ci_contract.py` reads it and requires CI to be a superset of
it. That test also catches the reverse failure, which had already happened: CI
ran `vitest run` against two hand-named files, one of which did not exist, so it
covered one suite of seven. Note its boundary honestly — it compares this block
with CI and cannot see a rule that is weak on *both* sides. `ruff format --check`
omitted `scripts` here and in CI, they agreed, and only reading them together
with fresh eyes found it.

Current state: **911 engine tests · 68 TypeScript · 16 citegate**, all green.
All 68 TypeScript tests now run in CI; until this commit, seven of them did.

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
| `mcp` | JSON-RPC 2.0 tool protocol over a `Transport` Protocol | built because **62 of 509 figures** named it — the top of `BUILD_ORDER.md` |
| `factory` | spec · gates · compilers · per-run economics · portfolio · the loop back | `worth_it` at the head of ten stages; `parse(emit(bp)) == bp` across **3 targets × 5 paradigms**; margin per run in exact picos |
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
- `engine/ontology/` — the branch map onto `engine/`. `branches.json` holds
  claims and contains **no figures**; `scripts/ontology_map.py` resolves every
  symbol to decide status and renders `COVERAGE.md`. A claim for code that does
  not import fails CI. **`source` is load-bearing**: `proposal` branches were
  written down before anyone looked, `corpus:` branches were read out of a
  document. A map of an assumed list can confirm every entry on it and still be
  missing the field — v1 said 10 gaps against 28 assumed branches, and reading
  one corpus added 10 more.
- `engine/ontology/nodes.json` — all **507 nodes** against exported symbols.
  Three claims: `gap` (no candidate), `proposed` (an alias that imports,
  unconfirmed), `implemented` (**a person agreed**). A machine proposes and
  verifies resolution; it may never decide two names mean the same
  capability. Four claims, not three: `rejected` (a human said no) exists
  because the first `refresh()` after `omnex.mcp` landed proposed `Code →
  omnex.mcp.ErrorCode`, which is wrong — and with nowhere to record that, the
  same wrong proposal returns on every run and the queue can only grow.
  `refresh()` may propose for a gap; `prune()` withdraws proposals the current
  rule would no longer make; neither may touch anything a human verified.
  **Containment runs one way**: a symbol more specific than the node can be its
  implementation (`MCP` → `McpClient`), one broader cannot — `omnex.factory.Tool`
  was proposed for fourteen different "Tool X" nodes at once before that rule
  landed. Pruning that noise raised the gap count from 447 to 464, which is the
  honest direction. Currently **464 gap · 43 proposed · 0 rejected · 0
  implemented**.
- `corpus/universal-ai-os/BUILD_ORDER.md` — the join, from
  `scripts/build_order.py`: every node with no code, ranked by how many figures
  name it. **Only direct lexical edges sort it.** Chapter-affinity edges
  outnumber them 736 to 550, so ranking on the total ranks on chapter size —
  ReAct (6 direct, 63 chapter) would beat Vector Search (22, 21). And `gap`
  means *no alias was proposed*, never *the capability is absent*: `Vector
  Search` is a gap while `omnex.vectors.HybridStore` is in the package, so a
  node whose branch already exports symbols gets `alias?` (go read that code
  first), and only a branch exporting nothing gets `build`. **The queue moves as
  code lands**: MCP led it at 62 figures until `omnex.mcp` was built, at which
  point branch XII began exporting, the node became `proposed`, and every other
  XII node went from `build` to `alias?`. `test_the_queue_moved_when_the_node_at_
  its_head_was_built` is the record of that; the head is no longer pinned by
  name, because pinning it is what made the first version brittle.
- `corpus/universal-ai-os/` — 509 figures from *AI Engineering* (Pachaar &
  Chawla), the committed source export beside them, and `RECONCILIATION.md`
  joining corpus weight against `engine/` coverage. `scripts/ingest_atlas.py`
  parses it and **asserts the export's own totals** — a regex matching 400 of
  509 writes a smaller manifest and raises nothing. The n/10 scores in that
  export are deliberately not imported: its author scored its own nodes.
- `engine/src/omnex/factory/` — a set of capabilities compiled into an
  `AgentSpec`: role, capabilities bound to symbols that must import, priced
  tools, memory and context policy, paradigm, eval suite, governance, failure
  modes, cost model. The spec is fingerprinted and derives a `harness.Contract`,
  so one rescoped after approval fails the next gate. `Stage` makes the gate
  order a type — `idea → market → unit economics → architecture → simulation →
  evaluation → security → deploy → observe → scale/kill` — and
  `Pipeline.advance()` refuses anything out of order. Only three gates can be
  decided from the spec (idea, unit economics, architecture); the rest take
  evidence a person supplies, because a spec must not grade its own market.
  **`Stage` is the `StrEnum` trap in the flesh**: inherited string comparison
  makes `Stage.DEPLOY < Stage.IDEA` true, and `@total_ordering` fills in nothing
  because all four operators are already inherited. They are written out.
- `engine/src/omnex/factory/compile/` — one neutral `Blueprint` (topology, never
  implementation) and three emitters: a runnable `graph.Graph`, an MCP server
  manifest, an n8n workflow JSON. **The property that makes them compilers is
  `parse(emit(bp)) == bp`**, checked across every target × paradigm, and
  `test_the_round_trip_check_can_actually_fail` breaks an emitter on purpose so
  the other fifteen are not comparing an artifact with itself. That matrix found
  a real bug: n8n read tool prices off tool *nodes*, so four of five paradigms
  lost every price and the workflow still imported. Prices now travel in `meta`.
  Every n8n node is `noOp` and says **in its own `notes` field** that it is a
  placeholder — a spec names a tool and its price, never the endpoint,
  credential or payload, and inventing those ships configuration nobody
  supplied.
- `engine/src/omnex/factory/economics.py` — margin per run, per agent, per
  customer, in exact picos. **Acquisition is not a per-run cost**: charging it
  that way makes a customer look worse the more they use the product, so it is
  answered by `payback_runs()` instead. A failed run is costed and counted, or
  the cheapest agent is one that fails everything. Margin is reported as a
  distribution — `worst()` is the number that says "cap the loop", the mean is
  the number that says everything is fine. `is_losing_money()` is **three-valued**
  and answers `None` below `MINIMUM_RUNS`, like `router.break_even()`.
  `cost_drift()` compares what the gate approved (an estimate) against what
  happened (a measurement) — the `metering.ts` `estimated: boolean` rule again.
- `engine/src/omnex/factory/portfolio.py` — live agents as assets with one
  explicit decision each. **`recommend()` proposes, `enact()` records a person's
  name** — the node map's rule at the level where it costs most, because `KILL`
  is irreversible and is what an optimiser under cost pressure reaches for
  first. Three refusals: too few runs is `WATCH`; nothing is killed on a
  dimension nobody measured (`None` means unmeasured, never zero); `MERGE` comes
  from overlap across the portfolio. `report()` opens with **`n=1. This is not a
  portfolio yet`** whenever there are fewer than two assets.
- `engine/src/omnex/factory/feedback.py` — runs, compiler results and portfolio
  decisions become one stream `harness.meta.diagnose()` reads, and an accepted
  improvement writes back a node claim. **That claim is always `proposed` and
  there is no parameter that makes it `implemented`** — the thing producing the
  evidence does not grade it. A zero-cost observation is refused: cost per
  accepted change falls toward zero the more of them a loop emits, and that is
  the one number the outer loop cannot afford to have gamed.
  `test_the_chain_runs_from_spec_to_an_observation_the_outer_loop_accepts` walks
  the whole thing in one pass, so a decorative link fails.
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
- **A concurrency test written the obvious way passes without the lock.** At
  CPython's default 5ms switch interval, eight threads rarely interleave inside
  a short critical section, so the first version of `test_concurrency.py` was
  green against an unguarded `CostLedger` and proved nothing.
  `sys.setswitchinterval(1e-9)` plus 16×400 makes it unmistakable: the unlocked
  ledger reports **the right event count and half the money** ($0.29 of $0.64).
  The GIL narrows this window; it does not close it, and free-threaded CPython
  removes it.
- **Twins can diverge in their DATA while their code stays identical.** The two
  splitters were line-for-line equivalent and the engine's `_ABBREVIATIONS` had
  quietly grown by `dr.`/`mr.`/`ms.`, so citegate split "Mr. Lee and Ms. Park
  disagreed." into four fragments. Comparing the functions found nothing; only
  `test_citegate_parity.py`, running both over one corpus, did.
- **Symbol resolution lives in `omnex.core.symbols`, imported by everything.**
  `ontology_map.py`, `node_map.py` and `omnex.factory` all ask "does this name
  exist"; the splitter lesson below is what a second copy costs.
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
- **The open web is not reachable — only an allowlist is.** Measured: PyPI, npm,
  crates.io, GitLab and Docker Hub answer, and GitHub arrives through the git
  lane (`add_repo`, then clone). Everything else — `example.com`,
  `wikipedia.org`, `vercel.com`, `lovable.app`, `drive.google.com` — gets
  `gateway answered 403 to CONNECT` and never opens a socket. The previous
  version of this note named four blocked hosts and what answers, which reads as
  "the rest is fine"; that omission cost a session, with three clients
  (WebFetch, curl, Chromium through the proxy) each refused identically before
  anyone thought to test `wikipedia.org` as a control. **Read
  `curl -sS "$HTTPS_PROXY/__agentproxy/status"` → `recentRelayFailures` before
  trying any host not on the list** — the proxy logs its own refusals, so one
  read replaces a round of guessing. A 403 there is an org policy decision:
  report it, never route around it. Content from a blocked host arrives by `@`
  upload or through a GitHub repo, and the network policy itself is the user's
  to widen at environment level.
- **A polling loop on a quiet resource fails this repo's own `worth_it` gate.**
  An hourly PR check-in ran ~30 times against a green, unchanged PR: `repeats`
  holds, `budget` does not — it spent every hour and shipped nothing, and
  `goal` does not, because no metric moved. Webhook subscription already wakes
  the session on real PR events, so the poll was redundant with a mechanism that
  costs nothing when nothing happens. Prefer the event; if a fallback is needed
  at all, make it daily.
