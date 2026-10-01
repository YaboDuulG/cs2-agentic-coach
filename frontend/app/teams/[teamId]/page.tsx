"use client";

import { use } from "react";
import { TeamHub } from "@/components/teams/TeamHub";

export default function TeamHubPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  return <TeamHub teamId={teamId} />;
}
