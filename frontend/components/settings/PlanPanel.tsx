"use client";

import { useUser } from "@clerk/nextjs";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Card, CardHeader, Input, Label, ProgressBar, Skeleton, toast } from "@/components/ui";
import { useEntitlements, useRedeem, useReferral } from "@/lib/api/hooks";
import { longDate } from "@/lib/format";

const tierName = { FREE: "Free", SOLO_PRO: "Solo Pro", TEAM: "Team" } as const;

export function PlanPanel() {
  const { user } = useUser();
  const ents = useEntitlements();
  const referral = useReferral();
  const redeem = useRedeem();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const meta = (user?.publicMetadata ?? {}) as { uploadsThisMonth?: number };
  const tier = ents.data?.tier ?? "FREE";
  const limit = tier === "FREE" ? 2 : tier === "SOLO_PRO" ? 10 : null;
  const used = meta.uploadsThisMonth ?? 0;

  const sourceLine =
    ents.data?.source === "season" && ents.data.season
      ? `ESEA Season ${ents.data.season}, access until ${longDate(ents.data.season_until)}`
      : ents.data?.source === "trial"
        ? `Trial, ends ${longDate(ents.data.current_period_end)}`
        : ents.data?.source === "stripe"
          ? `Subscription${ents.data.current_period_end ? `, renews ${longDate(ents.data.current_period_end)}` : ""}`
          : "No subscription";

  async function copyLink() {
    if (!referral.data) return;
    try {
      await navigator.clipboard.writeText(referral.data.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      linkRef.current?.select();
      toast.error("Copy was blocked. The link is selected, press Ctrl+C.");
    }
  }

  async function onRedeem() {
    try {
      const r = await redeem.mutateAsync(code.trim());
      toast.success(`${tierName[r.tier]} unlocked for ${r.days} days, until ${longDate(r.until)}.`);
      setCode("");
      await user?.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That code could not be redeemed.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Your plan"
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/billing">{tier === "TEAM" ? "Plans" : "Upgrade"}</Link>
            </Button>
          }
        />
        {ents.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <p className="text-2xl">{tierName[tier]}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
              {sourceLine}
            </p>
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span>Uploads this month</span>
                <span className="num">{limit === null ? `${used} · unlimited` : `${used} / ${limit}`}</span>
              </div>
              {limit !== null ? <ProgressBar value={used} max={limit} label="Monthly upload quota" /> : null}
              <p className="mt-1 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                Resets on the 1st.
              </p>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Invite a friend" description={`They get ${referral.data?.invitee_days ?? 7} days of Solo Pro free. So do you, every time it's used.`} />
        {referral.isError ? (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            Couldn&apos;t load your invite code. Refresh to try again.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="num rounded-md px-2.5 py-1 text-sm font-semibold tracking-widest" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                {referral.data?.code ?? "……"}
              </span>
              {referral.data && referral.data.uses > 0 ? (
                <span className="num text-[12px]" style={{ color: "var(--color-text-3)" }}>
                  used {referral.data.uses}×
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Input ref={linkRef} id="invite-link" readOnly mono value={referral.data?.share_url ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <Button variant="secondary" onClick={copyLink} disabled={!referral.data}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 border-t hairline pt-4">
          <Label htmlFor="redeem-code">Have a code?</Label>
          <div className="flex gap-2">
            <Input
              id="redeem-code"
              mono
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && onRedeem()}
              placeholder="TRIAL-XXXX-XXXX or REF-XXXXXX"
              maxLength={32}
            />
            <Button variant="secondary" onClick={onRedeem} loading={redeem.isPending} disabled={!code.trim()}>
              Redeem
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
