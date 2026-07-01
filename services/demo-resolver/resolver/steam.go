package resolver

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ResolveSteam decodes a Steam match sharecode into a demo download URL.
// Steam uses the Game Coordinator (GC) protocol; full implementation
// requires a dedicated Steam bot account. This stub returns the sharecode
// for downstream processing and documents the integration path.
// GET /resolve/steam/:sharecode
func ResolveSteam(c *gin.Context) {
	sharecode := c.Param("sharecode")
	if sharecode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sharecode is required"})
		return
	}

	// TODO: Implement Steam GC bot integration.
	// Steps:
	//   1. Connect a dedicated Steam bot account via steamworks-go or gosteam
	//   2. Call CS2 GC RequestGame with the decoded sharecode (matchid + reservationid + tvport)
	//   3. Await GCMatchInfoResponse which contains demo_url
	//   4. Return {"demo_url": "<url>", "match_id": "<id>"}
	//
	// Reference: https://github.com/nicklvsa/go-csgo (sharecode decoder)
	//            https://github.com/Jessecar96/SteamBot (GC protocol)

	c.JSON(http.StatusNotImplemented, gin.H{
		"status":    "stub",
		"sharecode": sharecode,
		"message":   "Steam GC bot not yet implemented. Requires dedicated Steam bot account.",
		"next_steps": []string{
			"Set up Steam bot account",
			"Implement GC connection in resolver/steam_gc.go",
			"Decode sharecode to matchid+reservationid",
			"Request match info from CS2 GC",
		},
	})
}
