"""The gates, gated. Nothing in this repository checked its own checkers.

`test_the_round_trip_check_can_actually_fail` exists because a compiler that
compares an artifact with itself proves nothing. The same hole was open one level
up and stayed open longer: CI named two test files by hand, one of which did not
exist, and so ran one suite of seven while reporting green. The suites it skipped
were the ones holding the money path — `liveModules()` is exactly `['studio']`,
the cache-before-fallback rule, the `usage` block every cost figure depends on.

Nothing found that, because nothing was looking. This looks.

## Why the workflows are read as text rather than parsed as YAML

The engine takes no required dependencies, and a test that needs PyYAML is a test
that stops running on a bare interpreter — which is the property that makes this
suite worth having at all. What these assertions are actually about is the
literal shell command each step runs, and a line scan reads exactly that. A YAML
parser would give a tidier tree and the same strings.

## The third assertion is the one that keeps prose honest

CLAUDE.md documents the gate. CI runs the gate. Nothing made them agree, and they
had drifted in the direction that matters: the document was STRICTER than CI, so
a developer running the documented command locally saw failures CI never would.
`test_ci_covers_every_directory_the_documented_gate_covers` reads the fenced
block out of CLAUDE.md and requires CI to be a superset of it.

Its boundary, stated rather than discovered later: it compares two sides and
cannot see a rule that is weak on both. `ruff format --check` omitted `scripts`
in the document AND in CI, so they agreed and this test was satisfied. Only
reading them together with fresh eyes found that one. A drift check is not a
correctness check, and pretending otherwise is how the next weak rule survives.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
REPO = ENGINE.parent
WORKFLOWS = REPO / ".github" / "workflows"
CLAUDE_MD = REPO / "CLAUDE.md"

pytestmark = pytest.mark.skipif(
    not WORKFLOWS.is_dir(), reason="no .github/workflows in this checkout"
)

#: A token in a shell command that looks like a path into this repository.
#: Deliberately narrow: it must contain a slash and a dot, so `npm` and
#: `--noEmit` are not mistaken for files while `lib/__tests__/x.test.ts` is not
#: missed.
_PATHLIKE = re.compile(r"(?<![\w/.-])([A-Za-z_][\w./-]*/[\w.-]+\.[A-Za-z]{2,4})(?![\w/.-])")


def _run_commands(path: Path) -> list[str]:
    """Every shell command a workflow runs, including block scalars.

    `run: cmd` yields one command. `run: |` yields each following line that is
    indented past the `run:` key, which is how the eval gate writes its multi-line
    step.
    """
    commands: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(\s*)-?\s*run:\s*(.*)$", line)
        if match is None:
            index += 1
            continue
        indent, rest = len(match.group(1)), match.group(2).strip()
        index += 1
        if rest not in ("|", ">", "|-", ">-"):
            if rest:
                commands.append(rest)
            continue
        while index < len(lines):
            body = lines[index]
            if body.strip() and (len(body) - len(body.lstrip())) <= indent:
                break
            if body.strip():
                commands.append(body.strip())
            index += 1
    return commands


def _all_commands() -> dict[str, list[str]]:
    return {path.name: _run_commands(path) for path in sorted(WORKFLOWS.glob("*.yml"))}


def _working_directory(path: Path) -> Path:
    """`defaults.run.working-directory`, which engine.yml sets to `engine`."""
    match = re.search(r"working-directory:\s*(\S+)", path.read_text(encoding="utf-8"))
    return REPO / match.group(1) if match else REPO


# ── a workflow may not name a file that does not exist ────────────────────
def test_every_file_a_workflow_names_exists() -> None:
    """The assertion that would have caught the phantom on the day it was written.

    `lib/__tests__/agent-memory.test.ts` was named in CI and has never existed.
    vitest treats positional arguments as filters, so a filter matching nothing
    is not an error — it silently narrows the run instead. The step went green
    for months while covering one file.
    """
    missing: list[str] = []
    for path in sorted(WORKFLOWS.glob("*.yml")):
        base = _working_directory(path)
        for command in _run_commands(path):
            for token in _PATHLIKE.findall(command):
                if token.startswith(("http", "vercel.")) or "${{" in token:
                    continue
                if not (base / token).exists() and not (REPO / token).exists():
                    missing.append(f"{path.name}: {token}")
    assert not missing, "workflows name files that are not in the repository: " + ", ".join(missing)


# ── every test on disk must actually run ──────────────────────────────────
def test_the_typescript_suite_runs_whole_and_not_by_a_hand_written_list() -> None:
    """A file list stops covering whatever somebody adds next, silently.

    So the requirement is not "these seven files are named" — that has the same
    defect one commit later. It is that some step runs vitest with no file
    filter at all.
    """
    ts_tests = sorted(p for p in (REPO / "lib" / "__tests__").glob("*.test.ts"))
    assert ts_tests, "no TypeScript tests found, so this assertion is vacuous"

    whole_suite = [
        command
        for commands in _all_commands().values()
        for command in commands
        if _is_unfiltered(command, "vitest run")
    ]
    assert whole_suite, (
        "no workflow runs `vitest run` without a file filter, so the suites nobody "
        f"named are not covered: {', '.join(p.name for p in ts_tests)}"
    )


def test_the_python_suite_runs_whole() -> None:
    py_tests = sorted(p.name for p in (ENGINE / "tests").glob("test_*.py"))
    assert py_tests
    assert any(
        _is_unfiltered(command, "pytest tests/")
        for commands in _all_commands().values()
        for command in commands
    ), "no workflow runs the whole pytest suite"


def _is_unfiltered(command: str, runner: str) -> bool:
    """True when `runner` appears with no positional file argument after it.

    Flags are allowed — `-q`, `--reporter` and the like narrow output, not
    coverage. A path argument is what narrows coverage, and it is the thing this
    refuses.
    """
    if runner not in command:
        return False
    tail = command.split(runner, 1)[1].strip()
    return not any(token for token in tail.split() if not token.startswith("-") and "." in token)


# ── CI must not be weaker than the documented gate ────────────────────────
def _documented_gate() -> list[str]:
    """The commands in CLAUDE.md's "commands that gate a change" block."""
    text = CLAUDE_MD.read_text(encoding="utf-8")
    block = re.search(r"## The commands that gate a change\s*\n+```bash\n(.*?)```", text, re.S)
    assert block is not None, "CLAUDE.md no longer documents a gate block"
    joined = block.group(1).replace("\\\n", " ")
    return [
        line.strip() for line in joined.splitlines() if line.strip() and not line.startswith("#")
    ]


def _ruff_directories(commands: list[str], subcommand: str) -> set[str]:
    found: set[str] = set()
    for command in commands:
        for part in command.split("&&"):
            part = part.strip()
            if subcommand not in part:
                continue
            tail = part.split(subcommand, 1)[1]
            found |= {
                token
                for token in tail.split()
                if not token.startswith("-") and "/" not in token and "." not in token
            }
    return found


@pytest.mark.parametrize("subcommand", ["ruff check", "ruff format --check"])
def test_ci_covers_every_directory_the_documented_gate_covers(subcommand: str) -> None:
    """The document was stricter than CI, which is the direction that hurts.

    A developer running the documented command locally saw failures CI would
    never produce, so a red CI was the only thing anybody trusted and the
    documented gate quietly became advice.
    """
    documented = _ruff_directories(_documented_gate(), subcommand)
    assert documented, f"CLAUDE.md's gate no longer runs {subcommand}"
    in_ci = _ruff_directories(
        [command for commands in _all_commands().values() for command in commands], subcommand
    )
    assert documented <= in_ci, (
        f"CI runs `{subcommand}` on {sorted(in_ci)} while CLAUDE.md documents "
        f"{sorted(documented)}; the gate and the document have drifted"
    )


def test_the_extractor_reads_block_scalars_and_not_just_one_liners(tmp_path: Path) -> None:
    """Proof the parser is not quietly seeing half the workflow.

    Every assertion above is only as good as this function. A `run: |` step it
    skipped would make the file-existence check pass by not looking.
    """
    workflow = tmp_path / "sample.yml"
    workflow.write_text(
        "jobs:\n"
        "  a:\n"
        "    steps:\n"
        "      - name: one\n"
        "        run: echo single\n"
        "      - name: two\n"
        "        run: |\n"
        "          echo first\n"
        "          echo second\n"
        "      - name: three\n"
        "        run: echo after\n",
        encoding="utf-8",
    )
    assert _run_commands(workflow) == [
        "echo single",
        "echo first",
        "echo second",
        "echo after",
    ]


def test_a_filtered_runner_is_recognised_as_filtered() -> None:
    """The check that makes the coverage assertions mean something."""
    assert _is_unfiltered("npx vitest run", "vitest run")
    assert _is_unfiltered("uv run pytest tests/ -q", "pytest tests/")
    assert not _is_unfiltered("npx vitest run lib/__tests__/one.test.ts", "vitest run")
    assert not _is_unfiltered(
        "npx vitest run lib/__tests__/a.test.ts lib/__tests__/b.test.ts", "vitest run"
    )
