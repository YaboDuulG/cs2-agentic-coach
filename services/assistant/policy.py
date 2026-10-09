"""
Who may use the assistant, and how much.
=========================================
Owner decisions (2026-10-09): the assistant is a paid feature because every
turn costs Gemini calls. Free users see it locked with the upgrade modal.
Budgets are per user per UTC day, in Gemini tokens (input + output), and are
testing values until real usage says otherwise.
"""

from services.billing.entitlements import Entitlement, Tier

ASSISTANT_ENTITLEMENT = Entitlement.FULL_COACHING  # Solo Pro and Team

# Tokens per user per UTC day. 0 = no access. Testing values.
DAILY_TOKEN_BUDGET: dict[Tier, int] = {
    Tier.FREE: 0,
    Tier.SOLO_PRO: 60_000,
    Tier.TEAM: 200_000,
}
ADMIN_DAILY_TOKEN_BUDGET = 1_000_000

MAX_TOOL_CALLS_PER_TURN = 8
MAX_TURNS_BEFORE_COMPACTION = 30


def assistant_allowed(ents: set[Entitlement]) -> bool:
    """Docstring for assistant_allowed."""
    return ASSISTANT_ENTITLEMENT in ents


def daily_budget(tier: Tier, *, is_admin: bool = False) -> int:
    """Docstring for daily_budget."""
    if is_admin:
        return ADMIN_DAILY_TOKEN_BUDGET
    return DAILY_TOKEN_BUDGET.get(tier, 0)
