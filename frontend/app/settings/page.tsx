"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppearancePanel } from "@/components/settings/AppearancePanel";
import { PlanPanel } from "@/components/settings/PlanPanel";
import { ProfilePanel } from "@/components/settings/ProfilePanel";
import { PageHeader, Tabs } from "@/components/ui";

type Tab = "profile" | "appearance" | "plan";

function SettingsInner() {
  const params = useSearchParams();
  const tab = ((params.get("tab") as Tab) ?? "profile") as Tab;
  // Native history: instant switch, and useSearchParams still follows it.
  const setTab = (t: Tab) => window.history.replaceState(null, "", t === "profile" ? "/settings" : `/settings?tab=${t}`);

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Settings" description="Your identity, your look, your plan." />
      <Tabs<Tab>
        label="Settings sections"
        value={["profile", "appearance", "plan"].includes(tab) ? tab : "profile"}
        onChange={setTab}
        items={[
          { key: "profile", label: "Profile" },
          { key: "appearance", label: "Appearance" },
          { key: "plan", label: "Plan" },
        ]}
        className="mb-6"
      />
      {tab === "appearance" ? <AppearancePanel /> : tab === "plan" ? <PlanPanel /> : <ProfilePanel steamParam={params.get("steam")} reason={params.get("reason")} />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
