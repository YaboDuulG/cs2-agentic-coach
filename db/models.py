"""
DemoSage — SQLAlchemy ORM Models
==================================
Defines the full database schema for parsed CS2 match data.

Tables:
    matches          - Match metadata and processing status (includes user_id FK to Clerk)
    kills            - Per-kill events with positions
    grenades         - Utility/grenade events
    rounds           - Round economy and outcome
    first_contacts   - First engagement per round (FCR data for Tactician)
    trajectories     - Player movement paths per round (heatmap data)
    teams            - Team groups (owner + invite code)
    team_members     - Many-to-many: users <-> teams
    practice_servers - On-demand DatHost CS2 server instances
    training_sessions - Per-session training stats (mode, map, duration)

Notes:
    - All tables use match_id (UUID string) as the foreign key to matches
    - Coordinate columns use Float; JSON columns use Text in SQLite, JSON in Postgres
    - pgvector columns (for RAG embeddings) will be added in Phase 3
"""

from datetime import UTC, datetime
import enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Docstring for Base."""
    pass


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class MatchStatus(str, enum.Enum):
    """Docstring for MatchStatus."""
    PENDING = "pending"  # Uploaded, not yet parsed
    PARSING = "parsing"  # Scout is actively parsing
    COMPLETE = "complete"  # Parsing done, data written
    FAILED = "failed"  # Parse failed — see error_message


class WinnerSide(str, enum.Enum):
    """Docstring for WinnerSide."""
    CT = "CT"
    T = "T"
    DRAW = "DRAW"


# ---------------------------------------------------------------------------
# Match — top-level record
# ---------------------------------------------------------------------------


class Match(Base):
    """Docstring for Match."""
    __tablename__ = "matches"

    match_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    match_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Clerk user ID — nullable so old anonymous rows are unaffected
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    team_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    demo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown")
    tickrate: Mapped[int] = mapped_column(Integer, nullable=False, default=64)
    total_rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        Enum(MatchStatus), nullable=False, default=MatchStatus.PENDING
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cached AI coaching output (JSON string) — written by Great Khan after Scout parse
    coaching_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploader_steam_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_recon: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    gcs_demo_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    gcs_audio_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    gcs_parsed_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    player_stats_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # GameStateGate observability: what the parser stripped (warmup/postgame
    # events, restarts discarded, pause intervals) — JSON, see services/demo-parser.
    phase_summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    parse_duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    kills: Mapped[list["Kill"]] = relationship(
        "Kill", back_populates="match", cascade="all, delete-orphan"
    )
    grenades: Mapped[list["Grenade"]] = relationship(
        "Grenade", back_populates="match", cascade="all, delete-orphan"
    )
    rounds: Mapped[list["Round"]] = relationship(
        "Round", back_populates="match", cascade="all, delete-orphan"
    )
    first_contacts: Mapped[list["FirstContact"]] = relationship(
        "FirstContact", back_populates="match", cascade="all, delete-orphan"
    )
    trajectories: Mapped[list["PlayerTrajectory"]] = relationship(
        "PlayerTrajectory", back_populates="match", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<Match {self.match_id} map={self.map_name} status={self.status}>"


# ---------------------------------------------------------------------------
# Kill — individual kill events
# ---------------------------------------------------------------------------


class Kill(Base):
    """Docstring for Kill."""
    __tablename__ = "kills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    tick: Mapped[int] = mapped_column(Integer, nullable=False)
    attacker: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    attacker_team: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    victim: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    victim_team: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    weapon: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    headshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attacker_steamid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    victim_steamid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attacker_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    attacker_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    attacker_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    victim_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    victim_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    victim_z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    match: Mapped["Match"] = relationship("Match", back_populates="kills")


# ---------------------------------------------------------------------------
# Grenade — utility events
# ---------------------------------------------------------------------------


class Grenade(Base):
    """Docstring for Grenade."""
    __tablename__ = "grenades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    tick: Mapped[int] = mapped_column(Integer, nullable=False)
    thrower: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    team: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    grenade_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    throw_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    throw_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    match: Mapped["Match"] = relationship("Match", back_populates="grenades")


# ---------------------------------------------------------------------------
# Round — round-level economy + outcome
# ---------------------------------------------------------------------------


class Round(Base):
    """Docstring for Round."""
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    winner_side: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ct_eq_val: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    t_eq_val: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ct_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    t_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    match: Mapped["Match"] = relationship("Match", back_populates="rounds")


# ---------------------------------------------------------------------------
# FirstContact — first kill per round (seeds FCR analysis for Tactician)
# ---------------------------------------------------------------------------


class FirstContact(Base):
    """Docstring for FirstContact."""
    __tablename__ = "first_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    tick: Mapped[int] = mapped_column(Integer, nullable=False)
    attacker: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    attacker_team: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    victim: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    weapon: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    headshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attacker_steamid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    victim_steamid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attacker_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    attacker_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    victim_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    victim_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    match: Mapped["Match"] = relationship("Match", back_populates="first_contacts")


# ---------------------------------------------------------------------------
# PlayerTrajectory — sampled movement path per player per round
# ---------------------------------------------------------------------------


class PlayerTrajectory(Base):
    """Docstring for PlayerTrajectory."""
    __tablename__ = "trajectories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    player: Mapped[str] = mapped_column(String(64), nullable=False)
    team: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # JSON-encoded list of {"tick": int, "x": float, "y": float, "z": float}
    # Sampled at every TRAJECTORY_SAMPLE_TICKS ticks to keep storage manageable
    positions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    match: Mapped["Match"] = relationship("Match", back_populates="trajectories")


# ---------------------------------------------------------------------------
# Team — group of players sharing analysis history
# ---------------------------------------------------------------------------


class Team(Base):
    """Docstring for Team."""
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 8-char alphanumeric code shared with teammates
    invite_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    members: Mapped[list["TeamMember"]] = relationship(
        "TeamMember", back_populates="team", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<Team {self.id} name={self.name}>"


# ---------------------------------------------------------------------------
# TeamMember — many-to-many join between users (Clerk IDs) and teams
# ---------------------------------------------------------------------------


class TeamMember(Base):
    """Docstring for TeamMember."""
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="member"
    )  # owner | member
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    team: Mapped["Team"] = relationship("Team", back_populates="members")

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<TeamMember team={self.team_id} user={self.user_id} role={self.role}>"


# ---------------------------------------------------------------------------
# PracticeServer — on-demand Hetzner instances
# ---------------------------------------------------------------------------


class PracticeServer(Base):
    """Docstring for PracticeServer."""
    __tablename__ = "practice_servers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vultr_instance_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(32), nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="booting"
    )  # booting, active, terminated
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="practice")
    rcon_password: Mapped[str] = mapped_column(String(32), nullable=False)
    server_password: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<PracticeServer {self.id} status={self.status} ip={self.ip_address}>"


# ---------------------------------------------------------------------------
# TrainingSession — per-session training log
# ---------------------------------------------------------------------------


class TrainingSession(Base):
    """
    Records each training server session. Created when a server is spun up,
    updated (ended_at + duration) when the server is terminated.
    """

    __tablename__ = "training_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Clerk user ID of whoever spun up the server
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # FK to the practice_servers row (nullable — server may be deleted)
    server_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("practice_servers.id", ondelete="SET NULL"), nullable=True
    )
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="practice")
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, default="de_dust2")
    region: Mapped[str] = mapped_column(String(16), nullable=False, default="dfw")
    started_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="SET NULL"), nullable=True, index=True
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<TrainingSession {self.id} mode={self.mode} user={self.user_id}>"


# ---------------------------------------------------------------------------
# RAG Knowledge Embeddings — Phase 3
# ---------------------------------------------------------------------------

import json
import os

from sqlalchemy.types import TypeDecorator


class SQLiteVectorType(TypeDecorator):
    """Docstring for SQLiteVectorType."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Docstring for process_bind_param."""
        if value is not None:
            if isinstance(value, str):
                return value
            return json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        """Docstring for process_result_value."""
        if value is not None:
            try:
                return json.loads(value)
            except Exception:
                return value
        return value


_db_url = (
    os.getenv("DATABASE_URL_TEST")
    or os.getenv("DATABASE_URL_LOCAL")
    or os.getenv("DATABASE_URL")
    or "sqlite:///:memory:"
)

if _db_url.startswith("sqlite"):
    # Fallback for SQLite in CI/unit testing environments
    VectorType = SQLiteVectorType()
else:
    from pgvector.sqlalchemy import Vector

    VectorType = Vector(768)


class KnowledgeEmbedding(Base):
    """
    RAG Knowledge Embeddings for Khan's Library.
    Stores chunked texts and their high-dimensional vector representations.
    """

    __tablename__ = "knowledge_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(VectorType, nullable=False)
    source: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )  # e.g., "game_rules", "hltv_pro_match", "tactical_playbook"
    metadata_json: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # Stored JSON string metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<KnowledgeEmbedding {self.id} source={self.source}>"


class MapPlaybook(Base):
    """
    Map Playbooks for CS2.
    Stores default high-level tactical setups and baseline JSON configurations for a map.
    """

    __tablename__ = "map_playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    playbook_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<MapPlaybook map={self.map_name}>"


class SystemConfig(Base):
    """
    Key-Value System Configurations for LLM Prompts and settings.
    """

    __tablename__ = "system_configs"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<SystemConfig {self.key}>"


class UserStrategy(Base):
    """
    User-drawn custom strategies from the interactive Stratbook.
    """

    __tablename__ = "user_strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    strategy_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<UserStrategy {self.title} map={self.map_name}>"


class TeamPlaybook(Base):
    """
    Team-specific custom playbooks from the interactive Stratbook.
    """

    __tablename__ = "team_playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    playbook_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    team: Mapped["Team"] = relationship("Team")

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<TeamPlaybook {self.title} map={self.map_name}>"


# ---------------------------------------------------------------------------
# LinkedAccount — external platform connections (Steam, FACEIT)
# ---------------------------------------------------------------------------


class LinkedAccount(Base):
    """Docstring for LinkedAccount."""
    __tablename__ = "linked_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # 'steam' | 'faceit'
    provider_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<LinkedAccount user={self.user_id} provider={self.provider} id={self.provider_user_id}>"


# ---------------------------------------------------------------------------
# Job — the single work queue for the pipeline (parse → coach)
# Claimed by workers with SELECT ... FOR UPDATE SKIP LOCKED (db/jobs.py).
# Replaces the Pub/Sub push + Cloud Tasks + BackgroundTasks trio: one queue,
# transactional with the match rows it describes.
# ---------------------------------------------------------------------------


class JobKind(str, enum.Enum):
    """Docstring for JobKind."""
    PARSE = "parse"
    COACH = "coach"


class JobStatus(str, enum.Enum):
    """Docstring for JobStatus."""
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Job(Base):
    """Docstring for Job."""
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("matches.match_id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(Enum(JobKind), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum(JobStatus), nullable=False, default=JobStatus.PENDING, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    claimed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<Job {self.id} {self.kind} match={self.match_id} status={self.status}>"


# ---------------------------------------------------------------------------
# ProBaseline — numeric professional-play reference values.
# Baselines are lookups, not vector searches: the Scribe compares a player's
# computed metric against these numbers and must cite both in its findings.
# ---------------------------------------------------------------------------


class ProBaseline(Base):
    """Docstring for ProBaseline."""
    __tablename__ = "pro_baselines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Metric key, e.g. 'fcr_win_rate', 'eco_save_threshold', 'util_prekill_pct'
    metric: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Context discriminators — 'any' matches everything
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, default="any")
    side: Mapped[str] = mapped_column(String(8), nullable=False, default="any")  # CT | T | any
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="ratio")
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<ProBaseline {self.metric} map={self.map_name} side={self.side} value={self.value}>"


# ---------------------------------------------------------------------------
# Pro meta registry — HLTV S/A-tier ingestion for the RAG engine
# (services/rag_engine). Demo binaries never land in the DB: the *_uri
# columns hold object-storage URIs only.
# ---------------------------------------------------------------------------


class ProTournament(Base):
    """Docstring for ProTournament."""
    __tablename__ = "pro_tournaments"
    __table_args__ = (CheckConstraint("tier IN ('S', 'A')", name="ck_pro_tournaments_tier"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hltv_event_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tier: Mapped[str] = mapped_column(String(1), nullable=False)  # 'S' | 'A'
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    matches: Mapped[list["ProMatch"]] = relationship(
        "ProMatch", back_populates="tournament", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<ProTournament {self.hltv_event_id} tier={self.tier} name={self.name}>"


class ProMatch(Base):
    """Docstring for ProMatch."""
    __tablename__ = "pro_matches"

    hltv_match_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_tournaments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team_a: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    team_b: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown")
    played_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Object-storage URI of the raw .dem — never the bytes themselves.
    demo_gcs_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Object-storage URI of the parsed ParseResult JSON.
    parsed_gcs_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    patch_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # NULL = queued for ingestion; set once archetypes are extracted + vectorized.
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    tournament: Mapped["ProTournament"] = relationship("ProTournament", back_populates="matches")
    rounds: Mapped[list["ProRound"]] = relationship(
        "ProRound", back_populates="pro_match", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<ProMatch {self.hltv_match_id} {self.team_a} vs {self.team_b} map={self.map_name}>"


class ProRound(Base):
    """Docstring for ProRound."""
    __tablename__ = "pro_rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pro_match_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("pro_matches.hltv_match_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False, default="")  # CT | T
    buy_type: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    round_type: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    winner: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    archetype_label: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    metrics_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    pro_match: Mapped["ProMatch"] = relationship("ProMatch", back_populates="rounds")

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<ProRound match={self.pro_match_id} r{self.round_num} {self.side} {self.archetype_label}>"


class ProStratArchetype(Base):
    """
    One vectorizable pro-strat pattern (e.g. "Mirage A-Execute with 2 Smokes")
    aggregated from ProRound telemetry. summary_text is what gets embedded;
    qdrant_point_id links back to the pro_playbook collection point.
    """

    __tablename__ = "pro_strat_archetypes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False, default="")  # CT | T
    buy_type: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    round_type: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    team_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    patch_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    metrics_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    qdrant_point_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<ProStratArchetype {self.label} map={self.map_name} side={self.side}>"


# ---------------------------------------------------------------------------
# Stratbook — versioned team strats with a review state machine, plus the
# Discord binding and sync outbox (module 3). Transition rules live in
# services/stratbook/service.py; these rows are pure data.
# ---------------------------------------------------------------------------


class StratStatus(str, enum.Enum):
    """Docstring for StratStatus."""
    DRAFT = "DRAFT"
    IN_REVIEW = "IN_REVIEW"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class Strat(Base):
    """Docstring for Strat."""
    __tablename__ = "strats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    map_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False, default="T")  # T | CT
    buy_type: Mapped[str] = mapped_column(String(16), nullable=False, default="full_buy")
    status: Mapped[str] = mapped_column(
        Enum(StratStatus), nullable=False, default=StratStatus.DRAFT, index=True
    )
    current_revision_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Discord thread this strat syncs with (set on first outbound post)
    discord_thread_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    revisions: Mapped[list["StratRevision"]] = relationship(
        "StratRevision", back_populates="strat", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<Strat {self.id} {self.title} map={self.map_name} status={self.status}>"


class StratRevision(Base):
    """Docstring for StratRevision."""
    __tablename__ = "strat_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    strat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("strats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # Canvas schema (validated in services/stratbook/service.py):
    # {steps: [{t, label, positions, utility: [...]}], callouts: [{name, x, y}]}
    canvas_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Utility lineup list [{type, callout, from:{x,y}, to:{x,y}}] for embeds
    utility_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    author_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="web")  # web|discord|ai
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )

    strat: Mapped["Strat"] = relationship("Strat", back_populates="revisions")


class TeamDiscordLink(Base):
    """
    Binds ONE Discord guild/channel to a team. Created only through the
    HMAC-signed bind-code flow (services/discord_bot), so a Discord server
    cannot attach itself to a team it doesn't own the code for.
    """

    __tablename__ = "team_discord_links"

    team_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True
    )
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    channel_id: Mapped[str] = mapped_column(String(32), nullable=False)
    bound_by: Mapped[str] = mapped_column(String(64), nullable=False)  # discord user id
    bound_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )


class OutboxStatus(str, enum.Enum):
    """Docstring for OutboxStatus."""
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class SyncOutbox(Base):
    """
    Transactional outbox for Discord sync and AI refinement work. HTTP
    handlers only INSERT here (same transaction as the strat change) and
    return immediately; the worker drains it with FOR UPDATE SKIP LOCKED —
    a Discord outage never blocks a web or interaction response.
    """

    __tablename__ = "sync_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # strat_upsert | strat_status | discord_reply | ai_adapt
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(
        Enum(OutboxStatus), nullable=False, default=OutboxStatus.PENDING, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(UTC)
    )


# ---------------------------------------------------------------------------
# Subscription — Stripe-backed plan authority (module 4). Written only by
# the billing sync path (webhook fan-out); read by the entitlement layer.
# Clerk publicMetadata.plan remains a display cache.
# ---------------------------------------------------------------------------


class Subscription(Base):
    """Docstring for Subscription."""
    __tablename__ = "subscriptions"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    plan: Mapped[str] = mapped_column(String(16), nullable=False, default="free")
    # active | trialing | past_due | canceled
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # past_due keeps entitlements until here (period_end + grace window)
    grace_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        """Docstring for __repr__."""
        return f"<Subscription {self.user_id} plan={self.plan} status={self.status}>"
