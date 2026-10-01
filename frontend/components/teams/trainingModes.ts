/** The ten practice-server modes. Keys match services/warlord/dathost_client.py. */
export interface TrainingModeCard {
  key: string;
  label: string;
  description: string;
  image: string;
  tags: [string, string];
}

export const TRAINING_MODES: TrainingModeCard[] = [
  { key: "practice", label: "Practice Mode", description: "Free-form practice with infinite ammo, cheats enabled.", image: "/training_practice.png", tags: ["Free", "Warmup"] },
  { key: "prefire", label: "Prefire Mode", description: "Pre-aim common spots and prefire every peek systematically.", image: "/training_prefire.png", tags: ["Aim", "Timing"] },
  { key: "defense", label: "Defense Mode", description: "Master angles, holds, and passive plays on each site.", image: "/training_defense.png", tags: ["Positioning", "Holds"] },
  { key: "tradefire", label: "Tradefire Mode", description: "Drill trade mechanics so no teammate dies unavenged.", image: "/training_tradefire.png", tags: ["Teamwork", "Mechanics"] },
  { key: "spray", label: "Spray Transfer/Pattern Mode", description: "Perfect your spray control and inter-target transitions.", image: "/training_spray.png", tags: ["Recoil", "Control"] },
  { key: "awp", label: "AWP Mode", description: "Sniper-only deathmatch to sharpen flick shots and positioning.", image: "/training_awp.png", tags: ["Sniping", "Flicks"] },
  { key: "aimtrainer", label: "Aim Trainer", description: "Track and click bots to build raw aiming mechanics.", image: "/training_aimtrainer.png", tags: ["Aim", "Tracking"] },
  { key: "promode", label: "Pro Mode", description: "Full competitive rules: no cheats, real economy.", image: "/training_promode.png", tags: ["Competitive", "Economy"] },
  { key: "grenade", label: "Grenade Learner", description: "Visualise grenade trajectories and learn lineups on any map.", image: "/training_grenade.png", tags: ["Utility", "Smokes"] },
  { key: "retake", label: "Retake Mode", description: "Post-plant retake scenarios: clutch or defuse.", image: "/training_retake.png", tags: ["Clutch", "Post-plant"] },
];

export function trainingModeLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return TRAINING_MODES.find((m) => m.key === key)?.label ?? key;
}
