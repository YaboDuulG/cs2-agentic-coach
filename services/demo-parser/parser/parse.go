package parser

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"cloud.google.com/go/storage"
	"github.com/gin-gonic/gin"
	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	common "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	events "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
)

type ParseRequest struct {
	GCSURI  string `json:"gcs_uri"`
	DemoURL string `json:"demo_url"`
	MatchID string `json:"match_id" binding:"required"`
}

// ParseDemo handles POST /parse
// Downloads the demo from GCS and streams parsed events back as JSON.
func ParseDemo(c *gin.Context) {
	var req ParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.GCSURI == "" && req.DemoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "either gcs_uri or demo_url must be provided"})
		return
	}

	var demoReader io.ReadCloser
	var err error

	if req.GCSURI != "" {
		demoReader, err = downloadFromGCS(c.Request.Context(), req.GCSURI)
	} else {
		demoReader, err = downloadFromHTTP(req.DemoURL)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("download failed: %v", err)})
		return
	}
	defer demoReader.Close()

	// The browser gzips demos before upload (.dem.gz) — decompress on the fly.
	var demoStream io.Reader = demoReader
	source := req.GCSURI
	if source == "" {
		source = req.DemoURL
	}
	if strings.HasSuffix(source, ".gz") {
		gz, gzErr := gzip.NewReader(demoReader)
		if gzErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("gzip decode failed: %v", gzErr)})
			return
		}
		defer gz.Close()
		demoStream = gz
	}

	result, err := parseDemoStream(req.MatchID, demoStream)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("parse failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, result)
}

func downloadFromHTTP(url string) (io.ReadCloser, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("unexpected status code %d fetching demo", resp.StatusCode)
	}
	return resp.Body, nil
}

// downloadFromGCS returns a ReadCloser for the demo file.
func downloadFromGCS(ctx context.Context, gcsURI string) (io.ReadCloser, error) {
	// Strip gs:// prefix and split into bucket/object
	path := strings.TrimPrefix(gcsURI, "gs://")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid GCS URI: %s", gcsURI)
	}

	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCS client: %w", err)
	}

	obj := client.Bucket(parts[0]).Object(parts[1])
	return obj.NewReader(ctx)
}

// parseDemoStream runs demoinfocs-golang on the reader and returns ParseResult.
func parseDemoStream(matchID string, r io.Reader) (*ParseResult, error) {
	p := dem.NewParser(r)
	defer p.Close()

	result := &ParseResult{MatchID: matchID}

	// Phase gating: only events from live rounds are recorded. Warmup, knife
	// round, pauses, restarts, and postgame are stripped and counted; a fresh
	// match start after data was recorded discards the earlier (fake) match.
	gate := NewGameStateGate(
		func() bool {
			return len(result.Kills) > 0 || len(result.Rounds) > 0 ||
				len(result.Grenades) > 0 || len(result.Positions) > 0 ||
				len(result.Damages) > 0 || len(result.Flashes) > 0
		},
		func() {
			result.Kills = nil
			result.Rounds = nil
			result.Grenades = nil
			result.Positions = nil
			result.Damages = nil
			result.Flashes = nil
		},
	)

	p.RegisterEventHandler(func(e events.IsWarmupPeriodChanged) {
		gate.SetWarmup(e.NewIsWarmupPeriod)
	})
	p.RegisterEventHandler(func(e events.MatchStartedChanged) {
		gate.SetMatchStarted(e.NewIsStarted)
	})
	p.RegisterEventHandler(func(e events.AnnouncementWinPanelMatch) {
		gate.MatchEnded(int64(p.CurrentFrame()))
	})
	// Timeouts / technical pauses keep IsMatchStarted true but manifest as
	// extended freezetime; without this, idle positions and pause-time events
	// would be recorded as live play. All freezetime is non-live (players are
	// frozen); long spans are reported as pauses in the summary.
	p.RegisterEventHandler(func(e events.RoundFreezetimeChanged) {
		gate.SetFreezetime(e.NewIsFreezetime, int64(p.CurrentFrame()), p.TickRate())
	})

	// Kill events
	p.RegisterEventHandler(func(e events.Kill) {
		if !gate.IsLive() {
			gate.CountStripped()
			return
		}
		attacker := ""
		victim := ""
		if e.Killer != nil {
			attacker = fmt.Sprintf("%d", e.Killer.SteamID64)
		}
		if e.Victim != nil {
			victim = fmt.Sprintf("%d", e.Victim.SteamID64)
		}

		kill := KillEvent{
			Round:      p.GameState().TotalRoundsPlayed(),
			Tick:       int64(p.CurrentFrame()),
			Attacker:   attacker,
			Victim:     victim,
			Weapon:     e.Weapon.String(),
			IsHeadshot: e.IsHeadshot,
		}
		if e.Killer != nil {
			pos := e.Killer.LastAlivePosition
			kill.AttackerX = float32(pos.X)
			kill.AttackerY = float32(pos.Y)
		}
		if e.Victim != nil {
			pos := e.Victim.LastAlivePosition
			kill.VictimX = float32(pos.X)
			kill.VictimY = float32(pos.Y)
			// Calculate distance
			dx := kill.AttackerX - kill.VictimX
			dy := kill.AttackerY - kill.VictimY
			kill.Distance = float32(math.Sqrt(float64(dx*dx + dy*dy)))
		}
		result.Kills = append(result.Kills, kill)
	})

	// Round end events
	p.RegisterEventHandler(func(e events.RoundEnd) {
		if !gate.IsLive() {
			gate.CountStripped()
			return
		}
		gs := p.GameState()
		tEcon := gs.TeamTerrorists().CurrentEquipmentValue()
		ctEcon := gs.TeamCounterTerrorists().CurrentEquipmentValue()

		roundType := "full"
		switch {
		case tEcon+ctEcon < 5000:
			roundType = "pistol"
		case tEcon < 2000 || ctEcon < 2000:
			roundType = "eco"
		case tEcon < 4000 || ctEcon < 4000:
			roundType = "force"
		}

		winner := "T"
		if e.Winner == 3 { // common.TeamCounterTerrorists is 3 in v4
			winner = "CT"
		}

		result.Rounds = append(result.Rounds, RoundEvent{
			RoundNum:   gs.TotalRoundsPlayed(),
			WinnerSide: winner,
			TMoney:     tEcon,
			CTMoney:    ctEcon,
			RoundType:  roundType,
		})
	})

	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		if !gate.IsLive() {
			gate.CountStripped()
			return
		}
		throwerID := ""
		if e.Projectile.Thrower != nil {
			throwerID = fmt.Sprintf("%d", e.Projectile.Thrower.SteamID64)
		}
		gType := "Unknown"
		if e.Projectile.WeaponInstance != nil {
			gType = e.Projectile.WeaponInstance.String()
		}
		result.Grenades = append(result.Grenades, GrenadeEvent{
			Round:       p.GameState().TotalRoundsPlayed(),
			Tick:        int64(p.CurrentFrame()),
			ThrowerID:   throwerID,
			GrenadeType: gType,
			LandX:       float32(e.Projectile.Position().X),
			LandY:       float32(e.Projectile.Position().Y),
		})
	})

	// Damage events — hp/armor + hitgroup (crosshair-placement proxy) and
	// utility damage (HE/molotov/incendiary). Gated like everything else.
	p.RegisterEventHandler(func(e events.PlayerHurt) {
		if !gate.IsLive() {
			gate.CountStripped()
			return
		}
		attacker, victim := "", ""
		if e.Attacker != nil {
			attacker = fmt.Sprintf("%d", e.Attacker.SteamID64)
		}
		if e.Player != nil {
			victim = fmt.Sprintf("%d", e.Player.SteamID64)
		}
		weapon := ""
		isUtility := false
		if e.Weapon != nil {
			weapon = e.Weapon.String()
			switch e.Weapon.Type {
			case common.EqHE, common.EqMolotov, common.EqIncendiary, common.EqSmoke, common.EqDecoy:
				isUtility = true
			}
		}
		result.Damages = append(result.Damages, DamageEvent{
			Round:           p.GameState().TotalRoundsPlayed(),
			Tick:            int64(p.CurrentFrame()),
			AttackerSteamID: attacker,
			VictimSteamID:   victim,
			Weapon:          weapon,
			HpDamage:        e.HealthDamage,
			ArmorDamage:     e.ArmorDamage,
			Hitgroup:        hitgroupName(e.HitGroup),
			IsUtility:       isUtility,
		})
	})

	// Flash events — real blind durations per blinded player, incl. team flashes.
	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		if !gate.IsLive() {
			gate.CountStripped()
			return
		}
		thrower, blinded := "", ""
		isTeammate := false
		if e.Attacker != nil {
			thrower = fmt.Sprintf("%d", e.Attacker.SteamID64)
		}
		if e.Player != nil {
			blinded = fmt.Sprintf("%d", e.Player.SteamID64)
			if e.Attacker != nil && e.Attacker.Team == e.Player.Team {
				isTeammate = true
			}
		}
		result.Flashes = append(result.Flashes, FlashEvent{
			Round:          p.GameState().TotalRoundsPlayed(),
			Tick:           int64(p.CurrentFrame()),
			ThrowerSteamID: thrower,
			BlindedSteamID: blinded,
			BlindDuration:  e.FlashDuration().Seconds(),
			IsTeammate:     isTeammate,
		})
	})

	lastPosTick := 0
	p.RegisterEventHandler(func(e events.FrameDone) {
		if gate.IsLive() && p.CurrentFrame()-lastPosTick > int(p.TickRate()*2) {
			lastPosTick = p.CurrentFrame()
			for _, player := range p.GameState().Participants().Playing() {
				steamId := ""
				if player.SteamID64 != 0 {
					steamId = fmt.Sprintf("%d", player.SteamID64)
				}
				result.Positions = append(result.Positions, PositionEvent{
					Round:   p.GameState().TotalRoundsPlayed(),
					Tick:    int64(p.CurrentFrame()),
					SteamID: steamId,
					X:       float32(player.Position().X),
					Y:       float32(player.Position().Y),
					Z:       float32(player.Position().Z),
					IsAlive: player.IsAlive(),
				})
			}
		}
	})

	// Parse all frames
	if err := p.ParseToEnd(); err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	header := p.Header()
	result.MapName = header.MapName
	result.Tickrate = int(p.TickRate())
	result.PhaseSummary = &gate.Summary

	return result, nil
}
