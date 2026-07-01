package resolver

import (
	"log"
	"time"

	"github.com/13k/go-steam-resources/v2/pb/cstrike15"
	"github.com/Philipp15b/go-steam/v3/protocol/gamecoordinator"
)

// StartCron starts a background ticker to periodically poll for connected users.
func StartCron() {
	ticker := time.NewTicker(10 * time.Minute)
	go func() {
		for range ticker.C {
			if SteamBot == nil || !SteamBot.Connected() {
				continue
			}

			accountID := uint32(SteamBot.SteamId().GetAccountId())

			req := &cstrike15.CMsgGCCStrike15_V2_MatchListRequestRecentUserGames{
				Accountid: &accountID,
			}

			// 730 is CS2 AppID
			msg := gamecoordinator.NewGCMsgProtobuf(730, uint32(cstrike15.ECsgoGCMsg_k_EMsgGCCStrike15_v2_MatchListRequestRecentUserGames), req)
			
			log.Println("Cron: Sending MatchListRequestRecentUserGames to GC...")
			SteamBot.GC.Write(msg)
		}
	}()
}
