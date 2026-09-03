// demo-parser: high-performance CS2 demo parser using demoinfocs-golang.
// Triggered by Cloud Tasks; reads .dem from GCS, streams parsed events to Postgres.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/YaboDuulG/cs2-agentic-coach/demo-parser/parser"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "demo-parser"})
	})

	// Parse a demo from GCS URI
	// Body: {"gcs_uri": "gs://bucket/path/demo.dem", "match_id": "uuid"}
	r.POST("/parse", parser.ParseDemo)

	log.Printf("demo-parser listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
