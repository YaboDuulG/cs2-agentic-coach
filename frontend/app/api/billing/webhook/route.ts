import { clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Force dynamic — no static prerendering or module-level Stripe init
export const dynamic = "force-dynamic";

// Plan mapping from Stripe price IDs. Subscriptions are Solo Pro only; Team is
// a one-time payment per ESEA season handled in checkout.session.completed.
// The previously hard-coded ids belonged to a Stripe account this project no
// longer uses (verified 2026-09-29), so the map is env-driven only.
const PRICE_TO_PLAN: Record<string, string> = {
  ...(process.env.STRIPE_PRICE_SOLO_MONTHLY ? { [process.env.STRIPE_PRICE_SOLO_MONTHLY]: "basic" } : {}),
  ...(process.env.STRIPE_PRICE_SOLO_YEARLY ? { [process.env.STRIPE_PRICE_SOLO_YEARLY]: "basic" } : {}),
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Fan the normalized event out to the backend: the subscriptions table is
// the entitlement authority (Clerk metadata is display only), and this call
// invalidates the backend's entitlement cache — so no request path ever
// needs a raw Stripe lookup.
async function syncBackend(payload: {
  user_id: string;
  plan: string;
  status: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: number | null;
  season?: number;
  event: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API_URL}/api/billing/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch (err) {
    // Non-fatal: Stripe retries the webhook, and the entitlement cache TTL
    // bounds staleness meanwhile.
    console.error("Backend billing sync failed:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Dynamic import — Stripe module only loads at request time, never at build time
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Awaited<ReturnType<typeof stripe.webhooks.constructEventAsync>>;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const clerk = await clerkClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.clerk_user_id;
      const plan = session.metadata?.plan;
      const season = Number(session.metadata?.season);
      if (userId && plan === "pro" && session.mode === "payment" && Number.isFinite(season)) {
        // One-time Team purchase for an ESEA season. The backend computes the
        // access window (until the next season starts) and reports it back.
        const synced = await syncBackend({
          user_id: userId,
          plan,
          status: "active",
          stripe_customer_id: (session.customer as string) ?? null,
          season,
          event: event.type,
        });
        const existing = (await clerk.users.getUser(userId)).publicMetadata ?? {};
        await clerk.users.updateUserMetadata(userId, {
          publicMetadata: {
            ...existing,
            plan: "pro",
            plan_source: "season",
            plan_season: season,
            plan_expires: (synced?.season_until as string | undefined) ?? null,
            stripeCustomerId: session.customer,
          },
        });
        break;
      }
      if (userId && plan) {
        await clerk.users.updateUserMetadata(userId, {
          publicMetadata: { plan, stripeCustomerId: session.customer },
        });
        await syncBackend({
          user_id: userId,
          plan,
          status: "active",
          stripe_customer_id: (session.customer as string) ?? null,
          stripe_subscription_id: (session.subscription as string) ?? null,
          event: event.type,
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price.id;
      const plan = PRICE_TO_PLAN[priceId] ?? "free";
      const userId = sub.metadata?.clerk_user_id;
      if (userId) {
        await clerk.users.updateUserMetadata(userId, {
          publicMetadata: { plan },
        });
        await syncBackend({
          user_id: userId,
          plan,
          status: sub.status,
          stripe_customer_id: (sub.customer as string) ?? null,
          stripe_subscription_id: sub.id,
          current_period_end: sub.items.data[0]?.current_period_end ?? null,
          event: event.type,
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = sub.metadata?.clerk_user_id;
      if (userId) {
        await clerk.users.updateUserMetadata(userId, {
          publicMetadata: { plan: "free" },
        });
        await syncBackend({
          user_id: userId,
          plan: "free",
          status: "canceled",
          stripe_subscription_id: sub.id,
          current_period_end: sub.items.data[0]?.current_period_end ?? null,
          event: event.type,
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      // Grace period: the backend keeps entitlements until period_end + 7d.
      // Structural cast: the SDK's Invoice type moves these fields between
      // API versions; we only need two optional strings.
      const invoice = event.data.object as unknown as {
        subscription_details?: { metadata?: Record<string, string> };
        parent?: { subscription_details?: { metadata?: Record<string, string> } };
        lines?: { data?: Array<{ pricing?: { price_details?: { price?: string } } }> };
      };
      const userId =
        invoice.subscription_details?.metadata?.clerk_user_id ??
        invoice.parent?.subscription_details?.metadata?.clerk_user_id;
      const priceId = invoice.lines?.data?.[0]?.pricing?.price_details?.price ?? "";
      if (userId) {
        await syncBackend({
          user_id: userId,
          plan: PRICE_TO_PLAN[priceId] ?? "basic",
          status: "past_due",
          event: event.type,
        });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
