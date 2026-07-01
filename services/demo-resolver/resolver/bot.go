package resolver

import (
	"crypto/sha1"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/Philipp15b/go-steam/v3"
	"github.com/Philipp15b/go-steam/v3/protocol/steamlang"
	"github.com/gin-gonic/gin"
)

var (
	SteamBot       *steam.Client
	sentryPath     = "sentry.bin"
	steamGuardCode string
)

// InitBot initializes the Steam bot using credentials from the environment.
func InitBot() {
	username := os.Getenv("STEAM_USERNAME")
	password := os.Getenv("STEAM_PASSWORD")

	if username == "" || password == "" {
		log.Println("Steam credentials not set. Bot will not be started.")
		return
	}

	SteamBot = steam.NewClient()

	go func() {
		for event := range SteamBot.Events() {
			switch e := event.(type) {
			case *steam.ConnectedEvent:
				log.Println("Steam connected, attempting log on...")

				logonDetails := &steam.LogOnDetails{
					Username: username,
					Password: password,
				}

				if steamGuardCode != "" {
					logonDetails.AuthCode = steamGuardCode
				} else {
					envCode := os.Getenv("STEAM_GUARD_CODE")
					if envCode != "" {
						logonDetails.AuthCode = envCode
					}
				}

				if _, err := os.Stat(sentryPath); err == nil {
					sentryData, _ := ioutil.ReadFile(sentryPath)
					h := sha1.New()
					h.Write(sentryData)
					logonDetails.SentryFileHash = h.Sum(nil)
				}

				SteamBot.Auth.LogOn(logonDetails)

			case *steam.LoggedOnEvent:
				log.Println("Steam logged on successfully!")
				SteamBot.Social.SetPersonaState(steamlang.EPersonaState_Online)

				// Establish Game Coordinator connection to CS2
				SteamBot.GC.SetGamesPlayed(730)

			case *steam.MachineAuthUpdateEvent:
				log.Println("Received Machine Auth Update. Saving sentry file.")
				ioutil.WriteFile(sentryPath, e.Hash, 0666)

			case *steam.LogOnFailedEvent:
				log.Printf("Steam log on failed: %v", e.Result)
				if e.Result == steamlang.EResult_AccountLogonDenied {
					log.Println("SteamGuard required! Provide via POST /auth/steamguard")
				}

			case *steam.DisconnectedEvent:
				log.Println("Steam disconnected, reconnecting in 5s...")
				time.Sleep(5 * time.Second)
				SteamBot.Connect()

			case *steam.FatalErrorEvent:
				log.Printf("Steam fatal error: %v", e)
			}
		}
	}()

	SteamBot.Connect()
}

// HandleSteamGuard receives a SteamGuard code via HTTP POST and applies it.
func HandleSteamGuard(c *gin.Context) {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	steamGuardCode = req.Code
	if SteamBot != nil {
		SteamBot.Disconnect()
	}

	c.JSON(http.StatusOK, gin.H{"message": "SteamGuard code updated, reconnecting..."})
}
