# Counter-Strike 2 (CS2) Game Rules & Tactical Knowledge Base

This document serves as the static reference corpus for DemoSage's RAG system, providing core game mechanics, economy configurations, round timings, and map-specific callouts to coach players effectively.

---

## 1. Economy & Buy Guidelines

In CS2, managing team economy is critical to securing victory. Teams must coordinate their buys to ensure they have matching equipment levels.

### 1.1 Round Rewards & Bonuses
* **Starting Cash:** $800 (for pistol round of each half).
* **Maximum Cash Cap:** $16,000.
* **Round Win Rewards:**
  * **CT / T Win by elimination:** $3,250.
  * **CT Win by defusing bomb:** $3,500.
  * **T Win by detonating bomb:** $3,500.
  * **T Round Loss by time limit (but bomb not planted):** T players who survive receive $0. Dead T players receive the standard loss bonus.
* **Loss Bonus System (CS2 Loss Streak):**
  * Level 0 (First loss or after streak reduced): **$1,400**
  * Level 1 (2 consecutive losses): **$1,900**
  * Level 2 (3 consecutive losses): **$2,400**
  * Level 3 (4 consecutive losses): **$2,900**
  * Level 4 (5+ consecutive losses): **$3,400**
  * *Note on CS2 Mechanic:* Winning a round reduces the loss streak level by 1, rather than resetting it to 0 completely.
* **Bomb Plant/Defuse Bonuses:**
  * If Terrorists plant the bomb but lose the round, every T player receives a **+$800** bonus on top of their loss bonus.
  * The player who plants the bomb receives a personal **+$300** cash reward.
  * The player who defuses the bomb receives a personal **+$300** cash reward.

### 1.2 Equipment & Item Costs
* **Armor:**
  * Kevlar Vest (Kevlar only): $650.
  * Kevlar + Helmet: $1,000 (if upgrading from Kevlar: $350).
  * Defusal Kit (CT only): $400.
* **Grenades (Utility):**
  * HE Grenade: $300.
  * Flashbang: $200 (max 2 per player).
  * Smoke Grenade: $300.
  * Molotov (T only): $400.
  * Incendiary Grenade (CT only): $500.
  * Decoy Grenade: $50.
* **Weapons:**
  * USP-S / Glock-18: $0 (default).
  * P250: $300.
  * Desert Eagle: $700.
  * MAC-10 (T only): $1,050.
  * MP9 (CT only): $1,250.
  * Galil AR (T only): $1,800.
  * FAMAS (CT only): $2,050.
  * AK-47 (T only): $2,700.
  * M4A4 (CT only): $3,100.
  * M4A1-S (CT only): $2,900.
  * AWP: $4,750.

### 1.3 Buy Thresholds & Strategies
* **Eco / Save Round (Economy < $2,000 per player):**
  * Do not spend cash. Keep money above $2,000 to ensure a full buy next round.
  * Objective is to save, search for exit kills, and damage the opponent's economy.
* **Force Buy (Economy $2,000 – $3,500):**
  * Spend all available cash on SMGs (MP9/MAC-10), pistols (Desert Eagle), Kevlar, and limited utility.
  * Played when desperate, or to break the opponent's economy after winning a pistol round.
* **Half Buy / Semi-Buy (Economy $3,000 – $4,000):**
  * Buy Kevlar + cheaper rifles (FAMAS/Galil) or SMGs, keeping enough bank to guarantee $3,900+ (T) or $4,300+ (CT) for the next round.
* **Full Buy (T: $3,700+, CT: $4,700+):**
  * **T Full Buy ($3,700 minimum, $4,500 preferred):** AK-47 ($2,700), Kevlar + Helmet ($1,000), Smoke ($300), Molotov ($400), Flashbangs ($400).
  * **CT Full Buy ($4,300 minimum, $5,500 preferred):** M4A1-S ($2,900) or M4A4 ($3,100), Kevlar + Helmet/Kevlar ($650-$1,000), Defusal Kit ($400), Smoke ($300), Incendiary ($500), Flashbangs ($400).

---

## 2. Round Timing & Mechanics

* **Freeze Time:** 15 seconds (Premier / Competitive matchmaking). Players cannot move but can purchase equipment.
* **Round Time:** 1 minute, 55 seconds (115 seconds).
* **Bomb Timer:** 40 seconds. Once planted, the round timer is replaced by the bomb detonation countdown.
* **Planting Duration:** 3.0 seconds. The T player must hold the use key without moving.
* **Defusal Duration:**
  * **Without Defusal Kit:** 10.0 seconds.
  * **With Defusal Kit:** 5.0 seconds.
* **Spawn Protection (Deathmatch only):** 5 seconds or until movement/shooting.

---

## 3. Map Overviews & Tactical Callouts

CS2 matches are played on a standard set of active-duty maps. Here are the callouts and tactical considerations for each.

### 3.1 de_dust2
* **A-Site:** Entry via Long A (large open lane) or Short A (Catwalk). Defended from Goose, Car, Site, and CT Spawn.
* **B-Site:** Entry via Upper Tunnels (tight choke point) or Mid doors via CT Spawn. Defended from Back Plat, Window, Door, and Car.
* **Middle:** Key area connecting T Spawn, Catwalk, B Doors, and CT Spawn. Controlling Mid allows quick rotations.
* **Tactical Tip:** CTs must smoke/flash Mid doors early to cross to B safely due to T AWP lines. T side needs execute utility to break B Site or Long A.

### 3.2 de_mirage
* **A-Site:** Entry via A Ramp, Palace, or Underpass/Conector. Defended from Ticket, Jungle, Stairs, Firebox, and Triple.
* **B-Site:** Entry via B Apps or Short/Catwalk. Defended from Bench, Van, Apartments, and Kitchen/Market.
* **Middle:** The tactical heart of the map. Includes Top Mid, Connector, Window (Sniper's Nest), Underpass, and Catwalk.
* **Tactical Tip:** Smoking Window and Connector is mandatory for T side to take Mid control. CTs should hold Mid aggressively with AWPs or dynamic crossfires.

### 3.3 de_inferno
* **A-Site:** Entry via Short A, Long A, or Apartments. Defended from Pit, Graveyard, Site, and Balcony.
* **B-Site:** Accessed via Banana (crucial choke point). Defended from Car, CT, Sandbag, and Fountain.
* **Middle:** T-Spawn leads to Second Mid and Main Mid, leading up to A Site.
* **Tactical Tip:** Banana control decides the B site. CTs should use incendiaries/HE grenades to delay B rushes. Ts must bait out CT utility before executing.

### 3.4 de_nuke
* **A-Site (Upper):** Entry via Squeaky door, Hut, or Heaven. Defended from rafters and site boxes.
* **B-Site (Lower):** Entry via Ramp, Secret (outside stairs), or Vents. Defended from Control, Dark, and Back B.
* **Outside:** Large open area connecting T Spawn to Secret, Main, and Garage.
* **Tactical Tip:** Smoke walls Outside are crucial for Ts to cross to Secret. CT Heaven players must rotate quickly down Vent or elevator to support Ramp or Lower.

### 3.5 de_ancient
* **A-Site:** Entry via A Main or Temple. Defended from Donut, CT Spawn, and Temple.
* **B-Site:** Entry via B Ramp or Cave. Defended from Wood, Pillar, and Lane.
* **Middle:** High-ground connection via Red/House, Donut, and Elbow.
* **Tactical Tip:** Cave and Donut control are crucial. Fast rotations through Temple/Donut allow CTs to react quickly. Ts should pressure Mid to split A or B.

### 3.6 de_anubis
* **A-Site:** Entry via A Main or Drop/Heaven. Defended from Fountain, Walkway, and Site.
* **B-Site:** Entry via B Long or Palace. Defended from Back Site, Sniper, and Ninja.
* **Middle & Water (Canal):** Mid connects to Bridge and Water. Water is a fast connector to B or A Connector.
* **Tactical Tip:** Ts have a faster spawn timing to Mid/Canals. CTs must play retake-heavy or contest water with strong utility pairings.

### 3.7 de_vertigo
* **A-Site:** Entry via A Ramp or Crane. Defended from Lane, Headshot, Back Site, and Heaven.
* **B-Site:** Entry via B Stairs or Catwalk. Defended from Site, Electric, and Mid.
* **Mid:** Connects T-mid to Elevator and CT-Spawn.
* **Tactical Tip:** A-Ramp control is contested heavily. Ts must use deep smokes to cover CT Spawn/Heaven lines. CTs must counter-flash and delay A rushes.
