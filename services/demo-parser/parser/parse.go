package parser

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	events "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
	"github.com/gin-gonic/gin"
)

type ParseRequest struct {
	GCSURI  string `json:"gcs_uri" binding:"required"`
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

	// Download demo from GCS (using signed URL or GOOGLE_APPLICATION_CREDENTIALS)
	demoReader, err := downloadFromGCS(c.Request.Context(), req.GCSURI)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("GCS download failed: %v", err)})
		return
	}
	defer demoReader.Close()

	result, err := parseDemoStream(req.MatchID, demoReader)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("parse failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, result)
}

// downloadFromGCS returns a ReadCloser for the demo file.
// Supports gs:// URIs. Requires GOOGLE_APPLICATION_CREDENTIALS.
func downloadFromGCS(ctx context.Context, gcsURI string) (io.ReadCloser, error) {
	// Strip gs:// prefix and split into bucket/object
	path := strings.TrimPrefix(gcsURI, "gs://")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid GCS URI: %s", gcsURI)
	}

	// In production, replace this stub with:
	// client, _ := storage.NewClient(ctx)
	// obj := client.Bucket(parts[0]).Object(parts[1])
	// return obj.NewReader(ctx)
	_ = ctx
	return nil, fmt.Errorf(
		"GCS download stub: implement with cloud.google.com/go/storage. Bucket=%s Object=%s",
		parts[0], parts[1],
	)
}

// parseDemoStream runs demoinfocs-golang on the reader and returns ParseResult.
func parseDemoStream(matchID string, r io.Reader) (*ParseResult, error) {
	p, err := dem.NewParser(r)
	if err != nil {
		return nil, fmt.Errorf("failed to create parser: %w", err)
	}
	defer p.Close()

	result := &ParseResult{MatchID: matchID}

	// Kill events
	p.RegisterEventHandler(func(e events.Kill) {
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
			kill.AttackerX = pos.X
			kill.AttackerY = pos.Y
		}
		if e.Victim != nil {
			pos := e.Victim.LastAlivePosition
			kill.VictimX = pos.X
			kill.VictimY = pos.Y
			// Calculate distance
			dx := kill.AttackerX - kill.VictimX
			dy := kill.AttackerY - kill.VictimY
			kill.Distance = float32(math.Sqrt(float64(dx*dx + dy*dy)))
		}
		result.Kills = append(result.Kills, kill)
	})

	// Round end events
	p.RegisterEventHandler(func(e events.RoundEnd) {
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
		if e.Winner.String() == "CT" {
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

	// Parse all frames
	if err := p.ParseToEnd(); err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	header := p.Header()
	result.MapName = header.MapName
	result.Tickrate = int(p.TickRate())

	return result, nil
}
