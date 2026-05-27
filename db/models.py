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
    team_members     - Many-to-many: users ↔ teams

Notes:
    - All tables use match_id (UUID string) as the foreign key to matches
    - Coordinate columns use Float; JSON columns use Text in SQLite, JSON in Postgres
    - pgvector columns (for RAG embeddings) will be added in Phase 3
"""

from datetime import UTC, datetime
import enum

from sqlalchemy import (
    Boolean,
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
    pass


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class MatchStatus(str, enum.Enum):
    PENDING = "pending"  # Uploaded, not yet parsed
    PARSING = "parsing"  # Scout is actively parsing
    COMPLETE = "complete"  # Parsing done, data written
    FAILED = "failed"  # Parse failed — see error_message


class WinnerSide(str, enum.Enum):
    CT = "CT"
    T = "T"
    DRAW = "DRAW"


# ---------------------------------------------------------------------------
# Match — top-level record
# ---------------------------------------------------------------------------


class Match(Base):
    __tablename__ = "matches"

    match_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Clerk user ID — nullable so old anonymous rows are unaffected
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
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
    gcs_demo_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    gcs_audio_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    gcs_parsed_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    player_stats_json: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        return f"<Match {self.match_id} map={self.map_name} status={self.status}>"


# ---------------------------------------------------------------------------
# Kill — individual kill events
# ---------------------------------------------------------------------------


class Kill(Base):
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
        return f"<Team {self.id} name={self.name}>"


# ---------------------------------------------------------------------------
# TeamMember — many-to-many join between users (Clerk IDs) and teams
# ---------------------------------------------------------------------------


class TeamMember(Base):
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
        return f"<TeamMember team={self.team_id} user={self.user_id} role={self.role}>"


# ---------------------------------------------------------------------------
# PracticeServer — on-demand Hetzner instances
# ---------------------------------------------------------------------------


class PracticeServer(Base):
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
        return f"<PracticeServer {self.id} status={self.status} ip={self.ip_address}>"
