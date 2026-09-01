package parser

// GameStateGate decides which demo events belong to the real match.
//
// CS2 demos are all-or-nothing recordings: warmup, knife round, technical and
// tactical pauses, halftime, restarts, and postgame are all in the stream.
// Downstream systems (first-contact derivation, economy/utility heuristics,
// the coaching evidence pack) treat persisted rows as ground truth, so
// anything recorded outside live play becomes a false "fact". Every event
// handler consults IsLive() before recording; stripped events are counted so
// the strip report is visible downstream instead of silent.
//
// Restart semantics: a knife round or mp_restartgame produces a fresh
// match-start after events were already recorded. The real match is the final
// go-live, so on restart the gate fires onRestart (which clears all recorded
// buffers) — canonical round numbers then come straight from the engine's
// TotalRoundsPlayed, which resets on restart too.

// PauseInterval is one paused span, in demo ticks.
//
// demoinfocs v4 exposes no direct pause event; CS2 pauses (tactical and
// technical) manifest as freezetime that runs far longer than the configured
// freeze time. The gate treats ALL freezetime as non-live (players are frozen
// at spawn — recording it as play pollutes trajectories and timing metrics)
// and reports spans longer than pauseThresholdSeconds as pauses.
type PauseInterval struct {
	StartTick int64  `json:"start_tick"`
	EndTick   int64  `json:"end_tick"`
	Kind      string `json:"kind"` // "pause" (tactical/technical — engine doesn't distinguish reliably)
}

// pauseThresholdSeconds: normal competitive freezetime is 12-20s; anything
// beyond this is a timeout or technical pause.
const pauseThresholdSeconds = 40.0

// PhaseSummary reports what the gate stripped — persisted on the match for
// observability, so an all-warmup demo fails loudly rather than producing an
// empty-but-plausible report.
type PhaseSummary struct {
	WarmupEventsStripped   int             `json:"warmup_events_stripped"`
	PausedEventsStripped   int             `json:"paused_events_stripped"`
	PostgameEventsStripped int             `json:"postgame_events_stripped"`
	PregameEventsStripped  int             `json:"pregame_events_stripped"`
	RestartsDiscarded      int             `json:"restarts_discarded"`
	Pauses                 []PauseInterval `json:"pauses"`
}

// GameStateGate tracks match phase from engine callbacks. Not safe for
// concurrent use; demoinfocs dispatches events on a single goroutine.
type GameStateGate struct {
	warmup     bool
	started    bool
	postgame   bool
	freezetime bool
	freezeFrom int64

	hasRecorded func() bool // whether any live events were recorded so far
	onRestart   func()      // clears recorded buffers

	Summary PhaseSummary
}

// NewGameStateGate wires the gate to the recording buffers. hasRecorded
// reports whether any events survived so far; onRestart must clear them.
func NewGameStateGate(hasRecorded func() bool, onRestart func()) *GameStateGate {
	return &GameStateGate{
		// Demos begin in warmup in practice, but the engine tells us via
		// IsWarmupPeriodChanged; until a match start arrives nothing is live.
		hasRecorded: hasRecorded,
		onRestart:   onRestart,
	}
}

// IsLive reports whether events at this moment belong to the real match.
// Freezetime counts as non-live: players are frozen, so no legitimate
// gameplay events occur, and excluding it keeps trajectories in-round only.
func (g *GameStateGate) IsLive() bool {
	return g.started && !g.warmup && !g.postgame && !g.freezetime
}

// CountStripped attributes a suppressed event to the phase that caused it.
func (g *GameStateGate) CountStripped() {
	switch {
	case g.postgame:
		g.Summary.PostgameEventsStripped++
	case g.freezetime:
		g.Summary.PausedEventsStripped++
	case g.warmup:
		g.Summary.WarmupEventsStripped++
	default: // match never started (pregame before first go-live)
		g.Summary.PregameEventsStripped++
	}
}

// SetWarmup handles IsWarmupPeriodChanged.
func (g *GameStateGate) SetWarmup(warmup bool) {
	g.warmup = warmup
}

// SetMatchStarted handles MatchStartedChanged. A fresh go-live after events
// were already recorded means the earlier "match" was a knife round or a
// restart — discard it.
func (g *GameStateGate) SetMatchStarted(started bool) {
	if started && !g.started && g.hasRecorded != nil && g.hasRecorded() {
		g.Summary.RestartsDiscarded++
		if g.onRestart != nil {
			g.onRestart()
		}
	}
	g.started = started
	if started {
		// A restart also ends any postgame state from a prior map segment.
		g.postgame = false
	}
}

// SetFreezetime handles RoundFreezetimeChanged. tickRate converts the span
// to seconds; spans beyond pauseThresholdSeconds are recorded as pauses.
func (g *GameStateGate) SetFreezetime(freezetime bool, tick int64, tickRate float64) {
	if freezetime == g.freezetime {
		return
	}
	g.freezetime = freezetime
	if freezetime {
		g.freezeFrom = tick
		return
	}
	if tickRate <= 0 {
		tickRate = 64
	}
	if float64(tick-g.freezeFrom)/tickRate > pauseThresholdSeconds {
		g.Summary.Pauses = append(g.Summary.Pauses, PauseInterval{
			StartTick: g.freezeFrom,
			EndTick:   tick,
			Kind:      "pause",
		})
	}
}

// MatchEnded handles the final win panel: everything after is postgame.
func (g *GameStateGate) MatchEnded(tick int64) {
	// Close a dangling freeze span so the interval list stays well-formed.
	if g.freezetime {
		g.SetFreezetime(false, tick, 64)
	}
	g.postgame = true
}
