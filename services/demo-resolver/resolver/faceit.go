// Package resolver handles demo URL resolution from external platforms.
package resolver

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

const faceitAPIBase = "https://open.faceit.com/data/v4"

// ResolveFACEIT fetches the demo download URL for a FACEIT match.
// GET /resolve/faceit/:match_id
func ResolveFACEIT(c *gin.Context) {
	matchID := c.Param("match_id")
	apiKey := os.Getenv("FACEIT_API_KEY")
	if apiKey == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "FACEIT_API_KEY not set"})
		return
	}

	url := fmt.Sprintf("%s/matches/%s", faceitAPIBase, matchID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("FACEIT API error: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("FACEIT returned %d", resp.StatusCode)})
		return
	}

	// Forward JSON body from FACEIT API
	c.DataFromReader(http.StatusOK, resp.ContentLength, "application/json", resp.Body, nil)
}
