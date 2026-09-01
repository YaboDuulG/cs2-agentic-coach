package parser

import "testing"

// harness simulating the recording buffers the gate protects.
type recorder struct {
	events int
}

func newGateWithRecorder() (*GameStateGate, *recorder) {
	rec := &recorder{}
	gate := NewGameStateGate(
		func() bool { return rec.events > 0 },
		func() { rec.events = 0 },
	)
	return gate, rec
}

func (r *recorder) record(g *GameStateGate) {
	if g.IsLive() {
		r.events++
	} else {
		g.CountStripped()
	}
}

// The canonical all-or-nothing demo: warmup deathmatch → knife round →
// restart → real match with a technical pause → postgame spray-down.
func TestFullDemoLifecycle(t *testing.T) {
	gate, rec := newGateWithRecorder()

	// Warmup: server up, match not started, warmup flag on.
	gate.SetWarmup(true)
	rec.record(gate) // warmup kill
	rec.record(gate) // warmup kill
	if rec.events != 0 {
		t.Fatalf("warmup events recorded: %d", rec.events)
	}

	// Knife round: warmup off, match "starts".
	gate.SetWarmup(false)
	gate.SetMatchStarted(true)
	rec.record(gate) // knife kill — live as far as the engine knows
	if rec.events != 1 {
		t.Fatalf("knife kill should be recorded until restart, got %d", rec.events)
	}

	// mp_restartgame after side choice: match restarts → knife data discarded.
	gate.SetMatchStarted(false)
	gate.SetMatchStarted(true)
	if rec.events != 0 {
		t.Fatalf("restart should clear recorded events, got %d", rec.events)
	}
	if gate.Summary.RestartsDiscarded != 1 {
		t.Fatalf("expected 1 restart discarded, got %d", gate.Summary.RestartsDiscarded)
	}

	// Round 1: freezetime then live.
	gate.SetFreezetime(true, 1000, 64)
	rec.record(gate) // buy-time event — stripped
	gate.SetFreezetime(false, 1960, 64) // 15s — normal, not a pause
	rec.record(gate) // live kill
	rec.record(gate) // live kill

	// Technical pause: freezetime that runs 3 minutes.
	gate.SetFreezetime(true, 10000, 64)
	rec.record(gate) // event during pause — stripped
	gate.SetFreezetime(false, 10000+64*180, 64)
	rec.record(gate) // live kill after resume

	// Postgame: win panel shown, players spray each other.
	gate.MatchEnded(30000)
	rec.record(gate)
	rec.record(gate)

	if rec.events != 3 {
		t.Fatalf("expected exactly 3 live events, got %d", rec.events)
	}
	s := gate.Summary
	if s.WarmupEventsStripped != 2 {
		t.Errorf("warmup stripped = %d, want 2", s.WarmupEventsStripped)
	}
	if s.PausedEventsStripped != 2 { // one buy-time, one during the pause
		t.Errorf("paused/freezetime stripped = %d, want 2", s.PausedEventsStripped)
	}
	if s.PostgameEventsStripped != 2 {
		t.Errorf("postgame stripped = %d, want 2", s.PostgameEventsStripped)
	}
	if len(s.Pauses) != 1 {
		t.Fatalf("expected 1 pause interval, got %d", len(s.Pauses))
	}
	if got := s.Pauses[0]; got.StartTick != 10000 || got.EndTick != 10000+64*180 {
		t.Errorf("pause interval = %+v", got)
	}
}

func TestNormalFreezetimeIsNotAPause(t *testing.T) {
	gate, _ := newGateWithRecorder()
	gate.SetMatchStarted(true)
	gate.SetFreezetime(true, 0, 64)
	gate.SetFreezetime(false, 64*15, 64) // 15 seconds
	if len(gate.Summary.Pauses) != 0 {
		t.Fatalf("15s freezetime reported as pause: %+v", gate.Summary.Pauses)
	}
}

func TestPregameEventsBeforeAnyMatchStart(t *testing.T) {
	gate, rec := newGateWithRecorder()
	rec.record(gate) // connect-phase artifact, warmup flag not yet seen
	if rec.events != 0 {
		t.Fatal("pregame event recorded")
	}
	if gate.Summary.PregameEventsStripped != 1 {
		t.Fatalf("pregame stripped = %d, want 1", gate.Summary.PregameEventsStripped)
	}
}

func TestRestartWithNothingRecordedIsNotCounted(t *testing.T) {
	gate, _ := newGateWithRecorder()
	gate.SetMatchStarted(true) // first go-live with empty buffers
	if gate.Summary.RestartsDiscarded != 0 {
		t.Fatal("clean first start counted as restart")
	}
}

func TestMatchEndClosesDanglingFreeze(t *testing.T) {
	gate, _ := newGateWithRecorder()
	gate.SetMatchStarted(true)
	gate.SetFreezetime(true, 5000, 64)
	gate.MatchEnded(5000 + 64*300) // demo ends during a long pause
	if len(gate.Summary.Pauses) != 1 {
		t.Fatalf("dangling pause not closed: %+v", gate.Summary.Pauses)
	}
	if gate.IsLive() {
		t.Fatal("live after match end")
	}
}
