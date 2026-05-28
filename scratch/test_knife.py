import demoparser2
import sys
import pandas as pd

def test_demo(demo_path):
    parser = demoparser2.DemoParser(demo_path)
    
    try:
        round_df = parser.parse_event(
            "round_end",
            other=["winner", "reason", "total_rounds_played"],
        )
        if round_df is not None and not round_df.empty:
            round_df = round_df.sort_values("tick")
            print("All round_end events:")
            print(round_df[['tick', 'total_rounds_played', 'winner', 'reason']])
            
            # Detect restarts by looking for drops or repeats in total_rounds_played
            last_reset_idx = -1
            prev_r = -1
            for idx, row in round_df.iterrows():
                curr_r = row['total_rounds_played']
                if curr_r <= prev_r:
                    last_reset_idx = idx
                prev_r = curr_r
            
            final_rounds = []
            knife_round = None
            
            for idx, row in round_df.iterrows():
                if idx < last_reset_idx:
                    # Before final reset. If it has a valid winner, it might be the knife round
                    if row['winner'] in (2, 3, "CT", "T", "TERRORIST"):
                        knife_round = row
                else:
                    # After or at final reset, these are live rounds
                    if row['winner'] in (2, 3, "CT", "T", "TERRORIST"):
                        final_rounds.append(row)
            
            print("\nKnife Round:")
            if knife_round is not None:
                print(knife_round)
            else:
                print("None found")
                
            print("\nLive Rounds count:", len(final_rounds))
            
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_demo(sys.argv[1])
    else:
        test_demo(r"C:\dev\cs2-agentic-coach\demos\DemolitionNuke.dem")
