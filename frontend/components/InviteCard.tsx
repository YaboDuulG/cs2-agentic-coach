"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Gift, Ticket } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/components/ui";

interface Referral {
  code: string;
  uses: number;
  invitee_days: number;
  referrer_days: number;
  share_url: string;
}

// Profile card: the user's invite link (both sides get a week of Solo Pro)
// and a box to redeem a trial or invite code.
export function InviteCard() {
  const { user } = useUser();
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const { data: referral, isError: loadError, refetch } = useQuery<Referral>({
    queryKey: ["billing", "referral"],
    queryFn: async () => {
      const r = await fetch("/api/billing/referral");
      if (!r.ok) throw new Error("Could not load invite code");
      return (await r.json()) as Referral;
    },
  });

  async function copyLink() {
    if (!referral) return;
    try {
      await navigator.clipboard.writeText(referral.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions, insecure context): leave the link
      // selected so a manual copy is one keystroke away.
      linkRef.current?.select();
      toast.error("Copy blocked by the browser — the link is selected, press Ctrl+C.");
    }
  }

  async function redeemCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setRedeeming(true);
    try {
      const res = await fetch("/api/billing/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "That code could not be redeemed.");
        return;
      }
      const tier = data.tier === "TEAM" ? "Team" : "Solo Pro";
      const until = new Date(data.until).toLocaleDateString(undefined, { dateStyle: "medium" });
      toast.success(`${tier} unlocked for ${data.days} days — until ${until}.`);
      setCode("");
      await user?.reload();
      await refetch();
    } catch {
      toast.error("Network error. Try again in a moment.");
    } finally {
      setRedeeming(false);
    }
  }

  const days = referral?.invitee_days ?? 7;

  return (
    <div
      className="card p-5 mt-6"
      style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Gift size={15} style={{ color: "var(--color-accent-primary)" }} aria-hidden="true" />
        <h3 className="font-semibold text-[0.85rem]" style={{ color: "var(--color-text-primary)" }}>
          Invite a friend
        </h3>
      </div>
      <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--color-text-secondary)" }}>
        Anyone who signs up with your link gets {days} days of Solo Pro free. So do you, every
        time it&apos;s used.
      </p>

      {loadError ? (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t load your invite code. Refresh to try again.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-sm font-bold tracking-widest px-2.5 py-1 rounded-md"
              style={{
                background: "var(--color-accent-soft)",
                color: "var(--color-accent-primary)",
                border: "1px solid var(--color-border-primary)",
              }}
              aria-label="Your invite code"
            >
              {referral?.code ?? "……"}
            </span>
            {referral && referral.uses > 0 && (
              <span className="text-[11px] font-mono" style={{ color: "var(--color-text-muted)" }}>
                used {referral.uses}×
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              ref={linkRef}
              id="invite-share-url"
              readOnly
              value={referral?.share_url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs font-mono outline-none"
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-primary)",
                color: "var(--color-text-secondary)",
              }}
              aria-label="Invite link"
            />
            <button
              type="button"
              onClick={copyLink}
              disabled={!referral}
              className="ds-btn px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--gradient-accent)", color: "#fff" }}
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--color-border-primary)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Ticket size={14} style={{ color: "var(--color-text-secondary)" }} aria-hidden="true" />
          <label htmlFor="redeem-code" className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Have a code?
          </label>
        </div>
        <div className="flex gap-2">
          <input
            id="redeem-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && redeemCode()}
            placeholder="TRIAL-XXXX-XXXX or REF-XXXXXX"
            maxLength={32}
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs font-mono uppercase outline-none"
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-primary)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            type="button"
            onClick={redeemCode}
            disabled={redeeming || !code.trim()}
            className="ds-btn px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            {redeeming ? "Redeeming…" : "Redeem"}
          </button>
        </div>
      </div>
    </div>
  );
}
