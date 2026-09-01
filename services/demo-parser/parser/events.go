package parser

// KillEvent represents a parsed kill from a CS2 demo.
type KillEvent struct {
	Round      int     `json:"round"`
	Tick       int64   `json:"tick"`
	Attacker   string  `json:"attacker_steam_id"`
	Victim     string  `json:"victim_steam_id"`
	Weapon     string  `json:"weapon"`
	IsHeadshot bool    `json:"is_headshot"`
	AttackerX  float32 `json:"attacker_x"`
	AttackerY  float32 `json:"attacker_y"`
	VictimX    float32 `json:"victim_x"`
	VictimY    float32 `json:"victim_y"`
	Distance   float32 `json:"distance"`
}

// GrenadeEvent represents a grenade throw/detonate event.
type GrenadeEvent struct {
	Round       int     `json:"round"`
	Tick        int64   `json:"tick"`
	ThrowerID   string  `json:"thrower_steam_id"`
	GrenadeType string  `json:"grenade_type"`
	ThrowX      float32 `json:"throw_x"`
	ThrowY      float32 `json:"throw_y"`
	LandX       float32 `json:"land_x"`
	LandY       float32 `json:"land_y"`
}

// RoundEvent represents round-level metadata.
type RoundEvent struct {
	RoundNum   int    `json:"round_num"`
	WinnerSide string `json:"winner_side"` // CT | T
	TMoney     int    `json:"t_money"`
	CTMoney    int    `json:"ct_money"`
	RoundType  string `json:"round_type"` // pistol | eco | force | full
}

// PositionEvent represents a player's position snapshot.
type PositionEvent struct {
	Round    int     `json:"round"`
	Tick     int64   `json:"tick"`
	SteamID  string  `json:"steam_id"`
	X        float32 `json:"x"`
	Y        float32 `json:"y"`
	Z        float32 `json:"z"`
	IsAlive  bool    `json:"is_alive"`
}

// ParseResult is the full output of parsing one demo.
type ParseResult struct {
	MatchID      string          `json:"match_id"`
	MapName      string          `json:"map_name"`
	Tickrate     int             `json:"tickrate"`
	Rounds       []RoundEvent    `json:"rounds"`
	Kills        []KillEvent     `json:"kills"`
	Grenades     []GrenadeEvent  `json:"grenades"`
	Positions    []PositionEvent `json:"positions"`
	PhaseSummary *PhaseSummary   `json:"phase_summary,omitempty"`
}
