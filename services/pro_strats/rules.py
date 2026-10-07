"""
Pro-strat rules backend — the eight-point strat template and the
strat / tip / mechanic taxonomy, enforced in code.

`agents/strat_reviewer.py` holds the same template as an LLM prompt; this
module is the deterministic gate. Archetype drafts extracted from pro
telemetry must pass `gate_archetype_draft()` before they become
`ProStratArchetype` rows. The LLM reviewer remains the final judge for
nuance — this module rejects the obvious non-strats cheaply and returns
structured feedback on the rest.

Rules (the minimum bar for a real strat):
  1. At least TWO players coordinating (roles, timing, or utility shared).
  2. At least ONE "if X, then Y" contingency.
A single-player lineup is a tip. An explainer of how the game works is a
mechanic. Neither gets stored as a strat.
"""

from __future__ import annotations

from enum import Enum
import re
from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# The eight-point template. Single source of truth for section definitions;
# agents/strat_reviewer.py's STRAT_TEMPLATE prompt mirrors this list.
# ---------------------------------------------------------------------------

TEMPLATE_SECTIONS: tuple[str, ...] = (
    "identity",  # map, side (T/CT), objective (site, control, retake, default)
    "buy",  # pistol/eco/force/full + utility requirements (AWP yes/no)
    "roles",  # all five players, each with a job
    "timing",  # trigger + order of events
    "utility",  # each grenade: thrower, lineup/spot, purpose
    "execution",  # numbered steps from trigger to plant/hold
    "contingencies",  # "if X, then Y" for likely counters
    "counters",  # what beats it + when not to call it
)


class EntryKind(str, Enum):
    STRAT = "strat"
    TIP = "tip"
    MECHANIC = "mechanic"


class Verdict(str, Enum):
    STRAT = "Strat"
    HALF_STRAT = "Half a strat"
    NOT_A_STRAT = "Not a strat"


class GateDecision(str, Enum):
    ACCEPT = "accept"
    NEEDS_REVIEW = "needs_review"
    REJECT = "reject"


# ---------------------------------------------------------------------------
# Template models
# ---------------------------------------------------------------------------


class PlayerRole(BaseModel):
    """One player's job in the strat. Five of these make a team plan."""

    player: str = Field(description="Player label, e.g. 'Player 1' or a name")
    job: str = Field(
        description="entry, trade, lurk, anchor, support, AWPer, IGL, ..."
    )


class UtilityItem(BaseModel):
    """One grenade with ownership and purpose."""

    thrower: str = Field(description="Which player throws it")
    nade: str = Field(description="smoke | flash | he | molotov")
    purpose: str = Field(description="What it accomplishes, e.g. 'CT smoke'")


class StratIdentity(BaseModel):
    map_name: str
    side: Literal["T", "CT"]
    objective: str = Field(
        description="site execute, map control, retake, default, ..."
    )


class StratTemplate(BaseModel):
    """The eight-point template. A callable pro strat answers all eight."""

    name: str
    identity: StratIdentity
    buy_requirement: str = Field(
        description="pistol/eco/force/full + needed utility and AWP yes/no"
    )
    roles: list[PlayerRole] = Field(
        description="All five players, each with a job", min_length=1
    )
    timing_trigger: str = Field(description="What starts it: round start, 1:10, mid control, a call...")
    timing_order: str = Field(description="Order of events after the trigger")
    utility: list[UtilityItem] = Field(default_factory=list)
    execution_steps: list[str] = Field(
        description="Numbered steps from trigger to plant/hold", min_length=1
    )
    contingencies: list[str] = Field(
        description="Each an 'if X, then Y' for a likely counter",
        default_factory=list,
    )
    what_beats_it: str = ""
    when_not_to_call: str = ""


# ---------------------------------------------------------------------------
# Classification: strat / tip / mechanic (deterministic heuristics)
# ---------------------------------------------------------------------------

# Role words: evidence that a plan has roles at all. Several role words in one
# sentence can describe one player ("the entry waits for support"), so they
# count as ONE player; a second player needs a second label or a pair word.
_ROLE_KEYWORDS = (
    "entry",
    "trader",
    "trade frag",
    "refrag",
    "lurk",
    "anchor",
    "support",
    "awper",
    "igl",
    "caller",
    "bait",
    "second man",
    "crossfire",
    "setup",
)

# Words that only make sense with two people involved.
_PAIR_PATTERNS = (
    r"\btrades? (him|her|them)\b",
    r"\btraded by\b",
    r"\bsecond man\b",
    r"\bcrossfire\b",
    r"\bwhile\b.{0,40}\b(entries|lurks|anchors|holds|throws|flashes|smokes)\b",
    r"\b(both|everyone|the team|the rest|two of us|three of us)\b",
)

# Distinct player labels ("Player 1", "P2") and named roles ("the entry").
_PLAYER_LABEL = re.compile(r"\b(?:player|p)\s*(\d)\b")
_NAMED_ROLE = re.compile(
    r"\b(?:the|our)\s+(entry|trader|lurker|anchor|support|awper|igl|caller|bait)\b"
)

# Signals of an "if X, then Y" contingency. "if X, Y" with a comma counts:
# people rarely write "then".
_CONTINGENCY_PATTERNS = (
    r"\bif\b.{0,60}\bthen\b",
    r"\bif\b.{3,60},\s*(we|he|she|they|everyone|player|the)\b",
    r"\bon contact\b",
    r"\bfall ?back\b",
    r"\bif they\b",
    r"\bif the (ct|t)s?\b",
    r"\bif we (lose|get|see|don.t|can.t)\b",
    r"\bcounter[- ]strat\b",
    r"\bwhen (they|the (ct|t)s?)\b.{0,60}\b(rotate|collapse|swing|fall ?back|re-?peek|retake)\b",
)

# Signals that the text explains game mechanics, not a team plan.
_MECHANIC_KEYWORDS = (
    "counter-straf",
    "counter straf",
    "spray control",
    "recoil",
    "movement technique",
    "how to aim",
    "peekers advantage",
    "tick rate",
    "how the economy works",
)


def _count_coordinating_players(text: str) -> int:
    """Heuristic: how many distinct players does the text coordinate?

    Distinct labels ("Player 1", "P2") each count. Named roles ("the entry",
    "our AWPer") each count once. Bare role words are evidence of one player,
    not one per word; a pair word ("trades him", "while ... lurks", "both")
    adds the second. Never more than five.
    """
    lowered = text.lower()
    labels = set(_PLAYER_LABEL.findall(lowered))
    named = set(_NAMED_ROLE.findall(lowered))
    count = len(labels) + len(named)
    if count == 0 and any(kw in lowered for kw in _ROLE_KEYWORDS):
        count = 1
    if count < 2 and any(re.search(p, lowered) for p in _PAIR_PATTERNS):
        count += 1
    return min(count, 5)


def _has_contingency(text: str) -> bool:
    lowered = text.lower()
    return any(re.search(p, lowered) for p in _CONTINGENCY_PATTERNS)


def _looks_like_mechanic(text: str) -> bool:
    lowered = text.lower()
    return any(kw in lowered for kw in _MECHANIC_KEYWORDS)


class Classification(BaseModel):
    kind: EntryKind
    reasons: list[str] = Field(default_factory=list)


def classify_entry(text: str) -> Classification:
    """Classify free text as strat / tip / mechanic using the minimum bar.

    Strat: ≥2 players coordinating AND ≥1 contingency.
    Tip: advice without a coordinated plan (default when the bar isn't met).
    Mechanic: explains how the game works rather than a team plan.
    """
    reasons: list[str] = []
    text = (text or "").strip()
    if not text:
        return Classification(
            kind=EntryKind.TIP, reasons=["empty text cannot be a strat"]
        )

    players = _count_coordinating_players(text)
    contingency = _has_contingency(text)
    mechanic = _looks_like_mechanic(text)

    # A mechanics explainer stays a mechanic however many players it names:
    # "Player 1 and Player 2 should practise counter-strafing" is drill advice.
    if mechanic:
        reasons.append("explains a game mechanic, not a team plan")
        return Classification(kind=EntryKind.MECHANIC, reasons=reasons)

    if players >= 2 and contingency:
        reasons.append(f"{players} coordinating players with a contingency")
        return Classification(kind=EntryKind.STRAT, reasons=reasons)

    if players < 2:
        reasons.append("fewer than two players coordinating: a tip, not a strat")
    if not contingency:
        reasons.append("no 'if X, then Y' contingency")
    return Classification(kind=EntryKind.TIP, reasons=reasons)


# ---------------------------------------------------------------------------
# Template validation: the eight-point checklist
# ---------------------------------------------------------------------------


class SectionCheck(BaseModel):
    section: str
    passed: bool
    note: str = ""


class TemplateChecklist(BaseModel):
    checks: list[SectionCheck]
    passed_count: int
    verdict: Verdict
    missing: list[str] = Field(default_factory=list)


def _nonblank(value: str) -> bool:
    return bool(value and value.strip())


def validate_template(strat: StratTemplate) -> TemplateChecklist:
    """Checklist the eight template sections. Verdicts:
    Strat = 8/8, Half a strat = 5-7, Not a strat = <5 or minimum bar failed.
    """
    roles_ok = len(strat.roles) >= 5 and all(
        _nonblank(r.player) and _nonblank(r.job) for r in strat.roles
    )
    utility_ok = len(strat.utility) > 0 and all(
        _nonblank(u.thrower) and _nonblank(u.nade) and _nonblank(u.purpose)
        for u in strat.utility
    )
    contingencies_ok = any(
        re.search(r"\bif\b.{0,60}\bthen\b", c.lower()) or "fallback" in c.lower()
        for c in strat.contingencies
    )

    results = [
        (
            "identity",
            _nonblank(strat.identity.map_name)
            and _nonblank(strat.identity.objective),
            "map, side and objective present",
        ),
        (
            "buy",
            _nonblank(strat.buy_requirement),
            "buy requirement stated",
        ),
        (
            "roles",
            roles_ok,
            "all five players have a job" if roles_ok else "needs five players with jobs",
        ),
        (
            "timing",
            _nonblank(strat.timing_trigger) and _nonblank(strat.timing_order),
            "trigger and order of events present",
        ),
        (
            "utility",
            utility_ok,
            "every grenade has thrower and purpose" if utility_ok else "utility needs thrower + purpose each",
        ),
        (
            "execution",
            len(strat.execution_steps) >= 2,
            "numbered steps from trigger to plant/hold",
        ),
        (
            "contingencies",
            contingencies_ok,
            "'if X, then Y' contingency present" if contingencies_ok else "needs an 'if X, then Y' contingency",
        ),
        (
            "counters",
            _nonblank(strat.what_beats_it) and _nonblank(strat.when_not_to_call),
            "what beats it + when not to call it",
        ),
    ]

    checks = [
        SectionCheck(section=s, passed=p, note=n) for s, p, n in results
    ]
    passed = sum(1 for c in checks if c.passed)
    missing = [c.section for c in checks if not c.passed]

    # Minimum bar mirrors classify_entry: no contingency, no strat.
    if not contingencies_ok:
        verdict = Verdict.NOT_A_STRAT
    elif passed == 8:
        verdict = Verdict.STRAT
    elif passed >= 5:
        verdict = Verdict.HALF_STRAT
    else:
        verdict = Verdict.NOT_A_STRAT

    return TemplateChecklist(
        checks=checks, passed_count=passed, verdict=verdict, missing=missing
    )


# ---------------------------------------------------------------------------
# Gate: the single entry point for archetype drafts from pro telemetry
# ---------------------------------------------------------------------------


class GateResult(BaseModel):
    decision: GateDecision
    kind: EntryKind
    verdict: Verdict | None = None
    reasons: list[str] = Field(default_factory=list)
    missing_sections: list[str] = Field(default_factory=list)


def gate_archetype_draft(draft: dict) -> GateResult:
    """Gate a pro-strat archetype draft before it becomes a row.

    `draft` carries at least `summary_text`; it may also carry a
    `template` dict matching StratTemplate for full validation.
    ACCEPT: reads as a strat AND passes the full template.
    NEEDS_REVIEW: reads as a strat but the template is incomplete
        (goes to the LLM reviewer in agents/strat_reviewer.py).
    REJECT: tip or mechanic — never stored as a strat.
    """
    text = str(draft.get("summary_text") or draft.get("label") or "")
    classification = classify_entry(text)

    if classification.kind is not EntryKind.STRAT:
        return GateResult(
            decision=GateDecision.REJECT,
            kind=classification.kind,
            reasons=classification.reasons
            + ["rejected: tips and mechanics are not stored as strats"],
        )

    template_data = draft.get("template")
    if not template_data:
        # Reads as a strat but unstructured: needs the reviewer to flesh it out.
        return GateResult(
            decision=GateDecision.NEEDS_REVIEW,
            kind=EntryKind.STRAT,
            reasons=classification.reasons
            + ["no structured template: send to the strat reviewer"],
        )

    try:
        template = StratTemplate.model_validate(template_data)
    except Exception as exc:  # malformed template is a review, not a crash
        return GateResult(
            decision=GateDecision.NEEDS_REVIEW,
            kind=EntryKind.STRAT,
            reasons=[f"template failed validation: {exc}"],
        )

    checklist = validate_template(template)
    if checklist.verdict is Verdict.STRAT:
        return GateResult(
            decision=GateDecision.ACCEPT,
            kind=EntryKind.STRAT,
            verdict=checklist.verdict,
            reasons=["passes all eight template sections"],
        )
    if checklist.verdict is Verdict.HALF_STRAT:
        return GateResult(
            decision=GateDecision.NEEDS_REVIEW,
            kind=EntryKind.STRAT,
            verdict=checklist.verdict,
            reasons=[f"incomplete sections: {', '.join(checklist.missing)}"],
            missing_sections=checklist.missing,
        )
    return GateResult(
        decision=GateDecision.REJECT,
        kind=EntryKind.STRAT,
        verdict=checklist.verdict,
        reasons=[f"fails the minimum bar: {', '.join(checklist.missing)}"],
        missing_sections=checklist.missing,
    )
