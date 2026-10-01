"use client";

import { useUser } from "@clerk/nextjs";
import { Check } from "lucide-react";
import { useState } from "react";
import { Badge, Button, PageHeader } from "@/components/ui";
import { useCheckout, useEntitlements, useSeasons } from "@/lib/api/hooks";
import { shortDate } from "@/lib/format";
import { SOLO_PRICE_USD, TEAM_SEASON_PRICE_USD } from "@/lib/flags";

const FREE = ["2 demo uploads a month", "Headline and one finding per match", "7-day history"];
const SOLO = ["10 demo uploads a month", "Every finding with round and tick references", "Pro benchmarks and corrective drills", "30-day history"];
const TEAM = ["Create a team, seats for the roster", "Team analysis and opponent scouting", "Practice servers and training modes", "Stratbook with Discord sync", "Unlimited uploads, 365-day history"];

const FAQ = [
  ["What counts as an upload?", "One demo file. If a teammate already uploaded the same match, it is detected and does not count against you."],
  ["How do Team seats work?", "The team owner buys the season. Every member of that team gets team features on that team's demos, with no per-seat charge."],
  ["Refunds?", "Solo Pro can be cancelled any time and runs out at the end of the period. A Team season is refundable within 7 days of purchase if no team demo has been analysed."],
];

/** Pricing. Reachable signed out. Team is sold per ESEA season. */
export default function BillingPage() {
  const { isSignedIn } = useUser();
  const ents = useEntitlements(Boolean(isSignedIn));
  const seasons = useSeasons();
  const checkout = useCheckout();
  const [interval, setInterval] = useState<"month" | "year">("month");

  const tier = ents.data?.tier ?? "FREE";
  const season = seasons.data?.purchasable;
  const ownsSeason = Boolean(ents.data?.season_until && season && new Date(ents.data.season_until) >= new Date(season.access_until));

  const soloPrice = interval === "year" ? `$${SOLO_PRICE_USD.year / 12}` : `$${SOLO_PRICE_USD.month}`;
  const soloPeriod = interval === "year" ? `/ month · $${SOLO_PRICE_USD.year} billed yearly` : "/ month";

  const buy = (plan: "basic" | "pro") => {
    if (!isSignedIn) {
      window.location.assign(`/sign-up?next=${encodeURIComponent("/billing")}`);
      return;
    }
    checkout.mutate({ plan, interval: plan === "basic" ? interval : undefined });
  };

  return (
    <div>
      <PageHeader eyebrow="Pricing" title="Choose your plan" description="Start free. Upgrade when the headline isn't enough." />

      <div className="mb-6 flex items-center gap-1" role="group" aria-label="Solo Pro billing interval">
        {(["month", "year"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={interval === opt}
            onClick={() => setInterval(opt)}
            className="rounded-full px-3 py-1 text-[13px] font-semibold"
            style={{
              background: interval === opt ? "var(--color-accent-soft)" : "var(--color-surface-2)",
              color: interval === opt ? "var(--color-accent)" : "var(--color-text-2)",
              border: "1px solid var(--color-line)",
            }}
          >
            {opt === "month" ? "Monthly" : "Yearly · save 20%"}
          </button>
        ))}
        <span className="ml-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          Applies to Solo Pro. Team is one payment per season.
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <PlanCard
          name="Free"
          price="$0"
          period="forever"
          sub="2 demos a month"
          features={FREE}
          footer={
            <Button variant="secondary" disabled>
              {tier === "FREE" ? "Current plan" : "Included"}
            </Button>
          }
        />
        <PlanCard
          name="Solo Pro"
          price={soloPrice}
          period={soloPeriod}
          sub={interval === "year" ? "Two months free" : "Cancel anytime"}
          features={SOLO}
          footer={
            tier === "SOLO_PRO" ? (
              <Button variant="secondary" disabled>
                Current plan
              </Button>
            ) : tier === "TEAM" ? (
              <Button variant="secondary" disabled>
                Included in Team
              </Button>
            ) : (
              <Button onClick={() => buy("basic")} loading={checkout.isPending && checkout.variables?.plan === "basic"}>
                Upgrade to Solo Pro
              </Button>
            )
          }
        />
        <PlanCard
          name="Team"
          highlight
          price={`$${TEAM_SEASON_PRICE_USD}`}
          period="/ season · one payment"
          sub={season ? `${season.label} · ${shortDate(season.start)} – ${shortDate(season.end)}${season.projected ? " (dates to be confirmed)" : ""}` : "Runs season to season with ESEA"}
          features={TEAM}
          footer={
            ownsSeason ? (
              <Button variant="secondary" disabled>
                You have {season?.label}
              </Button>
            ) : (
              <Button variant="rank" onClick={() => buy("pro")} loading={checkout.isPending && checkout.variables?.plan === "pro"}>
                {season ? `Buy ${season.label}` : "Buy this season"}
              </Button>
            )
          }
        />
      </div>

      {checkout.isError ? (
        <p className="mt-4 text-sm" style={{ color: "var(--color-danger)" }} role="alert">
          {(checkout.error as Error).message}
        </p>
      ) : null}

      <p className="mt-6 text-sm" style={{ color: "var(--color-text-2)" }}>
        Solo Pro renews monthly or yearly. Team is one payment per ESEA season; access runs until the next season starts, so
        renewing is seamless.
      </p>

      <section className="mt-10 max-w-2xl">
        <h2 className="mb-3 text-xl">Questions</h2>
        <dl className="space-y-4">
          {FAQ.map(([q, a]) => (
            <div key={q} className="surface-2 p-4">
              <dt className="font-semibold">{q}</dt>
              <dd className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function PlanCard({
  name,
  price,
  period,
  sub,
  features,
  footer,
  highlight,
}: {
  name: string;
  price: string;
  period: string;
  sub: string;
  features: string[];
  footer: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="surface relative flex flex-col p-5" style={{ borderColor: highlight ? "var(--color-rank)" : undefined }}>
      {highlight ? (
        <Badge tone="rank" className="absolute -top-2.5 left-4 z-10">
          For rosters
        </Badge>
      ) : null}
      <h2 className="text-lg">{name}</h2>
      <p className="mt-2 flex flex-wrap items-baseline gap-1">
        <span className="num text-3xl font-semibold">{price}</span>
        <span className="text-[12px]" style={{ color: "var(--color-text-2)" }}>
          {period}
        </span>
      </p>
      <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--color-focus)" }}>
        {sub}
      </p>
      <ul className="my-5 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-good)" }} aria-hidden="true" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto [&>button]:w-full">{footer}</div>
    </div>
  );
}
