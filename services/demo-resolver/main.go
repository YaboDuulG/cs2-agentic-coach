// demo-resolver: resolves demo download URLs from FACEIT and Steam GC.
// Exposes a lightweight HTTP API consumed by the FastAPI gateway.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/YaboDuulG/cs2-agentic-coach/demo-resolver/resolver"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	// Initialize the Steam bot
	resolver.InitBot()

	// Start the cron job for GC messages
	resolver.StartCron()

	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "demo-resolver"})
	})

	// Resolve a FACEIT match demo URL
	r.GET("/resolve/faceit/:match_id", resolver.ResolveFACEIT)

	// Resolve a Steam match demo via sharecode
	r.GET("/resolve/steam/:sharecode", resolver.ResolveSteam)

	// SteamGuard code endpoint
	r.POST("/auth/steamguard", resolver.HandleSteamGuard)

	log.Printf("demo-resolver listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
