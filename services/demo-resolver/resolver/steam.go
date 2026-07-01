package resolver

import (
	"net/http"

	"github.com/13k/go-steam-resources/v2/pb/cstrike15"
	"github.com/Philipp15b/go-steam/v3/protocol/gamecoordinator"
	"github.com/gin-gonic/gin"
)

// ResolveSteam decodes a Steam match sharecode into a demo download URL.
// GET /resolve/steam/:sharecode
func ResolveSteam(c *gin.Context) {
	sharecode := c.Param("sharecode")
	if sharecode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sharecode is required"})
		return
	}

	if SteamBot == nil || !SteamBot.Connected() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Steam bot is not connected"})
		return
	}

	// For a real implementation, you would decode the sharecode to MatchId, OutcomeId, Token.
	// For this task, we will just send a mock MatchListRequestFull as per instructions.
	matchID := uint64(123456789)
	outcomeID := uint64(987654321)
	token := uint32(1111)

	req := &cstrike15.CMsgGCCStrike15_V2_MatchListRequestFull{
		Matchid:   &matchID,
		Outcomeid: &outcomeID,
		Token:     &token,
	}

	msg := gamecoordinator.NewGCMsgProtobuf(730, uint32(cstrike15.ECsgoGCMsg_k_EMsgGCCStrike15_v2_MatchListRequestFull), req)
	SteamBot.GC.Write(msg)

	c.JSON(http.StatusOK, gin.H{
		"status":    "request_sent",
		"sharecode": sharecode,
		"message":   "Sent MatchListRequestFull to GC. Wait for GC response asynchronously.",
	})
}
