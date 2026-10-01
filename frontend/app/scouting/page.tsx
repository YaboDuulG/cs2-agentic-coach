import { redirect } from "next/navigation";

/** Scouting is a team feature: it lives in the Team Hub's Opponents tab. */
export default function ScoutingRedirect() {
  redirect("/teams");
}
