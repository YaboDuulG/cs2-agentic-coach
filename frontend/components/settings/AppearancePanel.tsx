"use client";

import { ThemePicker } from "@/components/identity/ThemePicker";
import { Card, CardHeader } from "@/components/ui";

export function AppearancePanel() {
  return (
    <Card>
      <CardHeader title="Theme" description="Three looks, one app. Side colours and status colours stay the same in all of them." />
      <ThemePicker />
      <p className="mt-4 text-[12px]" style={{ color: "var(--color-text-3)" }}>
        Motion follows your system&apos;s reduced-motion setting automatically.
      </p>
    </Card>
  );
}
