"""
Evidence pack builder tests — uses SQLite in-memory so no PostgreSQL needed in CI.
Validates fact extraction from tactician output, baseline lookup with 'any'
fallback, flagged-round retrieval capping, and idempotent baseline seeding.
"""

import os
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Force SQLite for all tests in this module
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from agents.scribe.evidence import (
    MAX_FLAGGED_ROUNDS,
    build_evidence_pack,
    compute_pro_baselines,
    seed_default_baselines,
)
from db.models import Base, ProBaseline, RoundFeature

TEST_MATCH_ID = "test-match-evidence"


@pytest.fixture()
def db_session():
    """Fresh in-memory SQLite DB with all tables per test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _tactical_analysis() -> dict:
    """Fabricated tactician output mirroring the *_to_dict shapes."""
    return {
        "fcr": {
            "match_id": TEST_MATCH_ID,
            "map_name": "de_mirage",
            "total_rounds": 4,
            "ct_fcr_wins": 2,
            "t_fcr_wins": 2,
            "fcr_match_rate": 0.5,
            "flags": [
                {"severity": "warning", "message": "playerA is dying first often.", "player": "playerA"}
            ],
            "rounds": [
                {"round_num": 1, "attacker": "playerB", "victim": "playerA", "round_winner": "CT"},
                {"round_num": 2, "attacker": "playerA", "victim": "playerB", "round_winner": "T"},
                {"round_num": 3, "attacker": "playerB", "victim": "playerA", "round_winner": "CT"},
                {"round_num": 4, "attacker": "playerB", "victim": "playerA", "round_winner": "T"},
            ],
            "player_stats": {
                "playerA": {
                    "player_name": "playerA",
                    "first_kills": 1,
                    "first_deaths": 3,
                    "first_kill_rate": 0.25,
                    "fcr_win_converted": 0,
                    "conversion_rate": 0.0,
                    "survived_first_death": 1,
                },
                "playerB": {
                    "player_name": "playerB",
                    "first_kills": 1,
                    "first_deaths": 0,
                    "first_kill_rate": 1.0,
                    "fcr_win_converted": 1,
                    "conversion_rate": 1.0,
                    "survived_first_death": 0,
                },
            },
        },
        "economy": {
            "overall_coherence_score": 0.75,
            "rounds": [
                {"round_num": 1, "ct_eq_val": 4000, "t_eq_val": 4200, "ct_type": "eco", "t_type": "eco"},
                {"round_num": 2, "ct_eq_val": 12000, "t_eq_val": 24000, "ct_type": "force_buy", "t_type": "full_buy"},
                {"round_num": 3, "ct_eq_val": 22000, "t_eq_val": 21000, "ct_type": "full_buy", "t_type": "full_buy"},
                {"round_num": 4, "ct_eq_val": 23000, "t_eq_val": 11000, "ct_type": "full_buy", "t_type": "force_buy"},
            ],
            "flags": [
                {
                    "round_num": 2,
                    "severity": "warning",
                    "message": "CT forced with poor economy (12000) against T full buy.",
                    "team": "CT",
                }
            ],
        },
        "rotations": {
            "player_scores": [
                {"player": "playerB", "avg_velocity": 5.0, "rotation_score": 0.1}
            ],
            "flags": [
                {
                    "round_num": 4,
                    "player": "playerB",
                    "severity": "warning",
                    "message": "Player 'playerB' showed very low movement/late rotation.",
                }
            ],
        },
        "positions": {
            "tags": [
                {
                    "player": "playerA",
                    "tag": "Aggressive Entry",
                    "severity": "positive",
                    "description": "Takes early duels.",
                }
            ]
        },
        "utility": {
            "overall_efficiency": 0.9,
            "flags": [
                {
                    "round_num": 3,
                    "player": "Team",
                    "severity": "warning",
                    "message": "Heavy smoke usage (2) without any flashbang support.",
                }
            ],
        },
    }


def _scout_out() -> dict:
    return {
        "map_name": "mirage",
        "round_history": [
            {"round_num": 1, "winner_side": "CT"},
            {"round_num": 2, "winner_side": "T"},
            {"round_num": 3, "winner_side": "CT"},
            {"round_num": 4, "winner_side": "T"},
        ],
    }


RAG_CONTEXT = [{"content": "match-level mirage guidelines", "source": "game_rules"}]


class TestFacts:
    """Docstring for TestFacts."""

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_fact_ids_sequential_and_kinds(self, mock_retrieve, db_session):
        """Facts get F1..Fn IDs in order and cover every tactician module."""
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        facts = pack["facts"]
        assert facts, "expected facts to be extracted"
        assert [f["id"] for f in facts] == [f"F{i + 1}" for i in range(len(facts))]
        kinds = {f["kind"] for f in facts}
        assert {"fcr", "economy", "utility", "rotation", "positioning"} <= kinds

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_player_fcr_fact_carries_rounds(self, mock_retrieve, db_session):
        """Per-player FCR facts list the rounds the player was involved in."""
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        player_facts = [
            f for f in pack["facts"] if f["kind"] == "fcr" and f.get("player") == "playerA"
        ]
        rounds_fact = next(f for f in player_facts if f["rounds"])
        assert rounds_fact["rounds"] == [1, 2, 3, 4]
        assert rounds_fact["value"] == 0.25
        # playerB has only 1 FCR involvement — below the 3-round threshold
        assert not any(
            f.get("player") == "playerB" and "first kills" in f["detail"] for f in pack["facts"]
        )

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_economy_flag_fact_has_round_and_value(self, mock_retrieve, db_session):
        """Economy flag facts carry the flagged round and the flagged team's eq value."""
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        eco_facts = [f for f in pack["facts"] if f["kind"] == "economy" and f["rounds"] == [2]]
        assert len(eco_facts) == 1
        assert eco_facts[0]["value"] == 12000  # CT eq value, since the flag targets CT


class TestBaselines:
    """Docstring for TestBaselines."""

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_baselines_seeded_and_ids_sequential(self, mock_retrieve, db_session):
        """Seeded 'any' baselines are found and get B1..Bn IDs."""
        seed_default_baselines(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        baselines = pack["baselines"]
        assert baselines
        assert [b["id"] for b in baselines] == [f"B{i + 1}" for i in range(len(baselines))]
        metrics = {b["metric"] for b in baselines}
        assert {"fcr_win_rate", "eco_save_threshold", "force_buy_winrate"} <= metrics

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_map_specific_baseline_beats_any(self, mock_retrieve, db_session):
        """A de_mirage-specific row wins over 'any' even when scout says just 'mirage'."""
        seed_default_baselines(db_session)
        db_session.add(
            ProBaseline(
                metric="fcr_win_rate",
                map_name="de_mirage",
                side="CT",
                value=0.61,
                unit="ratio",
                detail="mirage CT specific",
                source="test",
            )
        )
        db_session.commit()

        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        ct_rows = [b for b in pack["baselines"] if b["metric"] == "fcr_win_rate" and b["side"] == "CT"]
        assert len(ct_rows) == 1
        assert ct_rows[0]["value"] == 0.61
        assert ct_rows[0]["map_name"] == "de_mirage"

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_baseline_fallback_to_any(self, mock_retrieve, db_session):
        """Without a map-specific row, the 'any/any' bootstrap row is used."""
        seed_default_baselines(db_session)
        scout = _scout_out()
        scout["map_name"] = "ancient"  # no map-specific rows seeded
        pack = build_evidence_pack(db_session, TEST_MATCH_ID, scout, _tactical_analysis(), [])
        eco = next(b for b in pack["baselines"] if b["metric"] == "eco_save_threshold")
        assert eco["map_name"] == "any"
        assert eco["side"] == "any"
        assert eco["value"] == 2000.0

    def test_seed_default_baselines_idempotent(self, db_session):
        """Seeding twice inserts nothing the second time."""
        first = seed_default_baselines(db_session)
        assert first > 0
        count_after_first = db_session.query(ProBaseline).count()
        second = seed_default_baselines(db_session)
        assert second == 0
        assert db_session.query(ProBaseline).count() == count_after_first


class TestProExamples:
    """Docstring for TestProExamples."""

    @patch("db.rag.retrieve_similar_chunks")
    def test_situation_query_built_from_round_state(self, mock_retrieve, db_session):
        """Retrieval query encodes side, buy tier, and outcome of the flagged round."""
        mock_retrieve.return_value = [
            {"content": "pro chunk", "source": "hltv_pro_match", "score": 0.9}
        ]
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), RAG_CONTEXT
        )

        queries = [c.kwargs["query"] for c in mock_retrieve.call_args_list]
        # Round 2: economy flag targets CT, CT force-bought, T won → CT lost
        assert any("CT side force_buy round lost" in q for q in queries)
        # Round-linked example carries the round_ref and a P-id
        linked = [p for p in pack["pro_examples"] if p["round_ref"] == 2]
        assert linked
        assert linked[0]["id"].startswith("P")
        assert linked[0]["detail"] == "pro chunk"

    @patch("db.rag.retrieve_similar_chunks")
    def test_rag_context_reused_as_match_level_examples(self, mock_retrieve, db_session):
        """The match-level rag_context is appended with round_ref=None."""
        mock_retrieve.return_value = []
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), RAG_CONTEXT
        )
        match_level = [p for p in pack["pro_examples"] if p["round_ref"] is None]
        assert len(match_level) == 1
        assert match_level[0]["detail"] == "match-level mirage guidelines"
        ids = [p["id"] for p in pack["pro_examples"]]
        assert ids == [f"P{i + 1}" for i in range(len(ids))]

    @patch("db.rag.retrieve_similar_chunks")
    def test_flagged_round_retrieval_is_capped(self, mock_retrieve, db_session):
        """More than MAX_FLAGGED_ROUNDS flags → retrieval only for the first cap."""
        mock_retrieve.return_value = [
            {"content": "pro chunk", "source": "hltv_pro_match", "score": 0.9},
            {"content": "pro chunk 2", "source": "hltv_pro_match", "score": 0.8},
        ]
        analysis = _tactical_analysis()
        analysis["economy"]["flags"] = [
            {
                "round_num": rn,
                "severity": "warning",
                "message": f"Round {rn} bad force.",
                "team": "T",
            }
            for rn in range(1, 13)  # 12 flagged rounds
        ]
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), analysis, []
        )

        assert mock_retrieve.call_count == MAX_FLAGGED_ROUNDS
        round_linked = [p for p in pack["pro_examples"] if p["round_ref"] is not None]
        assert len(round_linked) == MAX_FLAGGED_ROUNDS * 2
        assert pack["flagged_rounds"] == list(range(1, MAX_FLAGGED_ROUNDS + 1))

    @patch("db.rag.retrieve_similar_chunks")
    @patch("services.rag_engine.retrieval.retrieve_pro_comps")
    def test_hybrid_retrieval_is_primary_and_carries_attribution(
        self, mock_hybrid, mock_legacy, db_session
    ):
        """When the archetype library answers, the legacy path is not used and
        the example carries pro_match_id for the citation contract."""
        mock_hybrid.return_value = [
            {
                "id": "pt-1",
                "text": "Vitality CT B hold vs force",
                "score": 0.03,
                "source": "hltv_pro_match",
                "pro_match_id": "hltv-2377810",
                "metadata": {"map": "de_mirage"},
            }
        ]
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )

        assert mock_legacy.call_count == 0
        linked = [p for p in pack["pro_examples"] if p["round_ref"] is not None]
        assert linked
        assert linked[0]["detail"] == "Vitality CT B hold vs force"
        assert linked[0]["pro_match_id"] == "hltv-2377810"
        # Filters derived from the round's actual state reach the hybrid call
        kwargs = mock_hybrid.call_args.kwargs
        assert kwargs["map_name"] == "mirage"
        assert kwargs["side"] in ("CT", "T")

    @patch("db.rag.retrieve_similar_chunks")
    @patch("services.rag_engine.retrieval.retrieve_pro_comps", return_value=[])
    def test_empty_hybrid_falls_back_to_legacy(self, mock_hybrid, mock_legacy, db_session):
        """An empty archetype library degrades to the legacy corpus search."""
        mock_legacy.return_value = [
            {"content": "legacy chunk", "source": "hltv_pro_match", "score": 0.9}
        ]
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        assert mock_hybrid.call_count > 0
        assert mock_legacy.call_count > 0
        linked = [p for p in pack["pro_examples"] if p["round_ref"] is not None]
        assert linked[0]["detail"] == "legacy chunk"
        assert linked[0]["pro_match_id"] is None


TELEMETRY_V2_KINDS = {
    "opening_flash",
    "opening_zone",
    "util_damage",
    "team_flash",
    "trade_spacing",
    "exec_sync",
}

TELEMETRY_V2_METRICS = {
    "util_damage_per_round",
    "enemy_blind_seconds_per_flash",
    "team_flash_seconds_per_round",
    "trade_window_s",
    "trade_success_rate",
    "exec_sync_score",
    "opening_flash_assist_rate",
}


def _seed_round_features(db_session):
    """Three fabricated telemetry-v2 rounds: a flash-assisted opening win, a dry
    loss at Inferno_Banana with a heavy team flash, and a second Banana loss."""
    rows = [
        RoundFeature(
            match_id=TEST_MATCH_ID,
            round_num=1,
            side_focus="T",
            opening_duel_won=True,
            opening_zone="Inferno_Mid",
            opening_flash_assist=True,
            util_damage=150,
            enemy_blind_seconds=4.0,
            team_blind_seconds=0.0,
            trade_success_rate=1.0,
            avg_trade_window_s=1.8,
            exec_sync_score=0.9,
        ),
        RoundFeature(
            match_id=TEST_MATCH_ID,
            round_num=2,
            side_focus="T",
            opening_duel_won=False,
            opening_zone="Inferno_Banana",
            opening_flash_assist=False,
            util_damage=30,
            enemy_blind_seconds=0.5,
            team_blind_seconds=2.5,
            trade_success_rate=0.0,
            avg_trade_window_s=4.2,
            exec_sync_score=0.3,
        ),
        RoundFeature(
            match_id=TEST_MATCH_ID,
            round_num=3,
            side_focus="T",
            opening_duel_won=False,
            opening_zone="Inferno_Banana",
            opening_flash_assist=False,
            util_damage=60,
            enemy_blind_seconds=1.0,
            team_blind_seconds=0.7,
            trade_success_rate=0.5,
            avg_trade_window_s=3.0,
            exec_sync_score=None,
        ),
    ]
    db_session.add_all(rows)
    db_session.commit()


class TestTelemetryV2Facts:
    """Facts and baselines derived from RoundFeature telemetry-v2 aggregates."""

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_opening_flash_fact(self, mock_retrieve, db_session):
        """Flash-assist rate covers every round with an opening duel."""
        _seed_round_features(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        fact = next(f for f in pack["facts"] if f["kind"] == "opening_flash")
        assert "1 of 3 opening duels" in fact["detail"]
        assert fact["value"] == pytest.approx(1 / 3, abs=1e-4)
        assert fact["rounds"] == [1, 2, 3]

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_opening_zone_fact_names_repeat_loss_zone(self, mock_retrieve, db_session):
        """The most frequent lost-opening zone is called out by canonical name."""
        _seed_round_features(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        fact = next(f for f in pack["facts"] if f["kind"] == "opening_zone")
        assert "Inferno_Banana" in fact["detail"]
        assert fact["rounds"] == [2, 3]
        assert fact["value"] == 2.0

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_utility_facts_and_team_flash_rounds(self, mock_retrieve, db_session):
        """Avg util damage plus the team-flash callout with the offending rounds."""
        _seed_round_features(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        util = next(f for f in pack["facts"] if f["kind"] == "util_damage")
        assert util["value"] == 80.0  # (150 + 30 + 60) / 3
        assert util["rounds"] == [1, 2, 3]

        team_flash = next(f for f in pack["facts"] if f["kind"] == "team_flash")
        assert "blinded teammates for 3.2s total" in team_flash["detail"]
        assert team_flash["value"] == pytest.approx(3.2)
        assert team_flash["rounds"] == [2, 3]  # only rounds with team_blind_seconds > 0

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_trade_and_exec_sync_facts(self, mock_retrieve, db_session):
        """Trade fact carries the worst rounds by success rate; sync the worst two."""
        _seed_round_features(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        trade = next(f for f in pack["facts"] if f["kind"] == "trade_spacing")
        assert trade["value"] == 0.5  # mean of 1.0, 0.0, 0.5
        assert "average trade window 3.0s" in trade["detail"]
        assert trade["rounds"] == [1, 2, 3]  # only 3 rounds, so all are the "worst 3"

        sync = next(f for f in pack["facts"] if f["kind"] == "exec_sync")
        assert sync["value"] == pytest.approx(0.6)  # mean of 0.9 and 0.3 (round 3 is null)
        assert sync["rounds"] == [1, 2]

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_new_baselines_seeded_and_paired(self, mock_retrieve, db_session):
        """The telemetry-v2 bootstrap baselines resolve into the pack via lookup."""
        seed_default_baselines(db_session)
        _seed_round_features(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        metrics = {b["metric"] for b in pack["baselines"]}
        assert TELEMETRY_V2_METRICS <= metrics
        util_bl = next(b for b in pack["baselines"] if b["metric"] == "util_damage_per_round")
        assert util_bl["value"] == 85.0
        assert util_bl["unit"] == "hp"
        assert util_bl["source"] == "bootstrap default, replace with pro round_features distributions"
        # B-ids stay sequential with the new metrics mixed in
        assert [b["id"] for b in pack["baselines"]] == [
            f"B{i + 1}" for i in range(len(pack["baselines"]))
        ]

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_zero_round_features_changes_nothing(self, mock_retrieve, db_session):
        """No RoundFeature rows → no telemetry facts, no telemetry baselines."""
        seed_default_baselines(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        assert not TELEMETRY_V2_KINDS & {f["kind"] for f in pack["facts"]}
        assert not TELEMETRY_V2_METRICS & {b["metric"] for b in pack["baselines"]}

    def test_compute_pro_baselines_stub_returns_zero(self, db_session):
        """No pro round_features exist yet, so the upgrade pass is a no-op."""
        seed_default_baselines(db_session)
        assert compute_pro_baselines(db_session) == 0


UPLOADER_SID = "76561198000000001"


def _seed_uploader_events(db_session):
    """Kill feed + flashes + damage where the uploader is a real participant.

    Round 1: uploader wins the opener (headshot), later dies and IS traded.
    Round 2: uploader loses the opener (first death), NOT traded.
    Round 3: uploader wins the opener (no headshot).
    """
    from db.models import Damage, FlashEventRow, Kill

    kills = [
        # (round, tick, attacker_sid, victim_sid, headshot)
        (1, 1000, UPLOADER_SID, "E1", True),
        (1, 1200, "E2", UPLOADER_SID, False),
        (1, 1300, "T2", "E2", False),  # trade: 100 ticks < 5s window
        (2, 2000, "E1", UPLOADER_SID, False),  # opening loss, never traded
        (3, 3000, UPLOADER_SID, "E2", False),
    ]
    for rn, tick, att, vic, hs in kills:
        db_session.add(
            Kill(
                match_id=TEST_MATCH_ID,
                round_num=rn,
                tick=tick,
                attacker=att,
                victim=vic,
                attacker_steamid=att,
                victim_steamid=vic,
                headshot=hs,
            )
        )
    db_session.add(
        FlashEventRow(
            match_id=TEST_MATCH_ID,
            round_num=1,
            tick=900,
            thrower_steamid=UPLOADER_SID,
            blinded_steamid="E1",
            blind_duration=1.5,
            is_teammate=False,
        )
    )
    db_session.add(
        FlashEventRow(
            match_id=TEST_MATCH_ID,
            round_num=2,
            tick=1900,
            thrower_steamid=UPLOADER_SID,
            blinded_steamid="T2",
            blind_duration=0.8,
            is_teammate=True,
        )
    )
    db_session.add(
        Damage(
            match_id=TEST_MATCH_ID,
            round_num=1,
            tick=950,
            attacker_steamid=UPLOADER_SID,
            victim_steamid="E1",
            weapon="hegrenade",
            hp_damage=45,
            hitgroup="generic",
            is_utility=True,
        )
    )
    db_session.add(
        Damage(
            match_id=TEST_MATCH_ID,
            round_num=1,
            tick=1000,
            attacker_steamid=UPLOADER_SID,
            victim_steamid="E1",
            weapon="ak47",
            hp_damage=100,
            hitgroup="head",
            is_utility=False,
        )
    )
    db_session.commit()


class TestUploaderFacts:
    """Personal-mode facts scoped to the uploader's Steam ID."""

    def _personal_scout(self) -> dict:
        return {**_scout_out(), "uploader_steam_id": UPLOADER_SID}

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_uploader_facts_present_and_attributed(self, mock_retrieve, db_session):
        """you_* facts exist, carry player=steamid, and measure the right things."""
        _seed_uploader_events(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, self._personal_scout(), _tactical_analysis(), []
        )
        by_kind = {f["kind"]: f for f in pack["facts"] if f["kind"].startswith("you_")}
        assert {"you_opening", "you_traded", "you_crosshair", "you_flash", "you_util_damage"} <= set(
            by_kind
        )
        assert all(f["player"] == UPLOADER_SID for f in by_kind.values())
        # Openers: won r1 + r3, lost r2 → 2/3
        assert by_kind["you_opening"]["value"] == pytest.approx(2 / 3, abs=1e-3)
        assert by_kind["you_opening"]["rounds"] == [1, 2, 3]
        # Deaths: r1 traded, r2 not → 0.5; untraded rounds list = [2]
        assert by_kind["you_traded"]["value"] == 0.5
        assert by_kind["you_traded"]["rounds"] == [2]
        # Kills: 2, one headshot → 0.5
        assert by_kind["you_crosshair"]["value"] == 0.5
        # Flash: 1.5s enemy blind; util: 45 HP (rifle damage excluded)
        assert by_kind["you_flash"]["value"] == 1.5
        assert by_kind["you_util_damage"]["value"] == 45.0

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_no_linked_steam_id_yields_identity_warning(self, mock_retrieve, db_session):
        """Personal mode without a linked Steam ID says so instead of guessing."""
        _seed_uploader_events(db_session)
        pack = build_evidence_pack(
            db_session, TEST_MATCH_ID, _scout_out(), _tactical_analysis(), []
        )
        identity = [f for f in pack["facts"] if f["kind"] == "identity"]
        assert len(identity) == 1
        assert "No Steam ID is linked" in identity[0]["detail"]
        assert not any(f["kind"].startswith("you_") for f in pack["facts"])

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_steam_id_absent_from_demo_yields_identity_warning(self, mock_retrieve, db_session):
        """A linked Steam ID that never appears in the kill feed is flagged."""
        _seed_uploader_events(db_session)
        scout = {**_scout_out(), "uploader_steam_id": "76561198999999999"}
        pack = build_evidence_pack(db_session, TEST_MATCH_ID, scout, _tactical_analysis(), [])
        identity = [f for f in pack["facts"] if f["kind"] == "identity"]
        assert len(identity) == 1
        assert "does not appear" in identity[0]["detail"]
        assert not any(f["kind"].startswith("you_") for f in pack["facts"])

    @patch("db.rag.retrieve_similar_chunks", return_value=[])
    def test_team_mode_skips_uploader_facts(self, mock_retrieve, db_session):
        """Team uploads get no personal you_* facts and no identity nag."""
        _seed_uploader_events(db_session)
        scout = {**self._personal_scout(), "team_id": "team-1"}
        pack = build_evidence_pack(db_session, TEST_MATCH_ID, scout, _tactical_analysis(), [])
        kinds = {f["kind"] for f in pack["facts"]}
        assert not any(k.startswith("you_") for k in kinds)
        assert "identity" not in kinds
