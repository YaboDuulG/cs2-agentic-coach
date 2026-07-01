package resolver

import (
	"log"
	"time"
)

func StartCron() {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if SteamBot != nil && SteamBot.Connected() {
				log.Println("Steam cron: Would poll recent matches here, pending protobuf compilation.")
			}
		}
	}()
}
