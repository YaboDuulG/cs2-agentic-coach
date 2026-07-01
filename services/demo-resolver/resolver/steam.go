package resolver

import (
	"net/http"

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

	// TODO: Send CMsgGCCStrike15_v2_MatchListRequestFull using compiled protobufs.
	c.JSON(http.StatusNotImplemented, gin.H{"message": "GC Match Request temporarily disabled pending protobuf compilation."})
}
