import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { STRIPE_PRICES } from "@/lib/flags";

// Force dynamic — no static prerendering or module-level Stripe init
export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const AUTH = { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` };

// Two checkout shapes:
//   basic  → Stripe subscription, monthly or yearly price
//   pro    → Stripe one-time payment for the purchasable ESEA season; the
//            webhook writes season + season_until to the backend.
export async function POST(req: NextRequest) {
  // Dynamic import — Stripe module only loads at request time, never at build time
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan, interval = "month" } = (await req.json()) as {
    plan?: string;
    interval?: "month" | "year";
  };
  const origin = req.headers.get("origin") ?? req.nextUrl.origin;

  if (plan === "basic") {
    const price = interval === "year" ? STRIPE_PRICES.soloYearly : STRIPE_PRICES.soloMonthly;
    if (!price) {
      return NextResponse.json(
        { error: `Solo Pro ${interval}ly price is not configured (STRIPE_PRICE_SOLO_${interval === "year" ? "YEARLY" : "MONTHLY"}).` },
        { status: 500 },
      );
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing`,
      client_reference_id: userId,
      metadata: { clerk_user_id: userId, plan, interval },
      subscription_data: { metadata: { clerk_user_id: userId, plan, interval } },
    });
    return NextResponse.json({ url: session.url });
  }

  if (plan === "pro") {
    if (!STRIPE_PRICES.teamSeason) {
      return NextResponse.json(
        { error: "Team season price is not configured (STRIPE_PRICE_TEAM_SEASON)." },
        { status: 500 },
      );
    }
    // The backend decides which season is on sale (current, or next during
    // the gap) and whether this user already owns it.
    const [seasonsRes, entRes] = await Promise.all([
      fetch(`${API_URL}/api/billing/seasons`, { headers: AUTH, cache: "no-store" }),
      fetch(`${API_URL}/api/billing/entitlements?user_id=${userId}`, { headers: AUTH, cache: "no-store" }),
    ]);
    if (!seasonsRes.ok) {
      return NextResponse.json({ error: "Season calendar unavailable." }, { status: 502 });
    }
    const { purchasable } = (await seasonsRes.json()) as {
      purchasable: { number: number; label: string; start: string; end: string; access_until: string };
    };
    const ent = entRes.ok ? ((await entRes.json()) as { season_until?: string | null }) : {};
    if (ent.season_until && new Date(ent.season_until) >= new Date(purchasable.access_until)) {
      return NextResponse.json(
        { error: `You already have ${purchasable.label}. The next season goes on sale when it starts.`, code: "already_owned" },
        { status: 409 },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: STRIPE_PRICES.teamSeason, quantity: 1 }],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing`,
      client_reference_id: userId,
      metadata: { clerk_user_id: userId, plan, season: String(purchasable.number) },
      payment_intent_data: {
        description: `DemoSage Team — ${purchasable.label} (${purchasable.start} to ${purchasable.end})`,
        metadata: { clerk_user_id: userId, plan, season: String(purchasable.number) },
      },
    });
    return NextResponse.json({ url: session.url });
  }

  return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
}
