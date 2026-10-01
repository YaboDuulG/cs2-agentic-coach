"use client";

import { useUser } from "@clerk/nextjs";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, PageHeader } from "@/components/ui";
import { useEntitlements } from "@/lib/api/hooks";

/** After Stripe: say what they have and the three things to do next. */
export default function BillingSuccessPage() {
  const { user } = useUser();
  const qc = useQueryClient();
  const ents = useEntitlements();

  // The webhook lands a few seconds after the redirect; refresh both caches.
  useEffect(() => {
    const t = setTimeout(() => {
      user?.reload();
      qc.invalidateQueries({ queryKey: ["billing"] });
    }, 2500);
    return () => clearTimeout(t);
  }, [user, qc]);

  const tier = ents.data?.tier ?? "FREE";
  const isTeam = tier === "TEAM";

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        leading={<CheckCircle2 size={32} style={{ color: "var(--color-good)" }} aria-hidden="true" />}
        title={isTeam ? `You're on Team${ents.data?.season ? ` · Season ${ents.data.season}` : ""}` : tier === "SOLO_PRO" ? "You're on Solo Pro" : "Payment received"}
        description={tier === "FREE" ? "Your plan updates in a few seconds." : "Thanks. Here is what to do first."}
      />
      <Card>
        <ol className="space-y-3">
          {(isTeam
            ? [
                ["Create a team", "/teams", "Name it, invite the roster with the code."],
                ["Upload a team demo", "/teams", "From the Team Hub, so it is analysed for the whole roster."],
                ["Link Discord", "/teams", "Strats get proposed and approved from your server."],
              ]
            : [
                ["Link your Steam ID", "/settings", "So every personal finding is about you."],
                ["Upload a demo", "/", "Choose Coach me on the first step."],
                ["Read the full debrief", "/matches", "Every finding, benchmark and drill is unlocked."],
              ]
          ).map(([title, href, body], i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="num mt-0.5 w-5 shrink-0 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
                  {body}
                </p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={href}>Go</Link>
              </Button>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
