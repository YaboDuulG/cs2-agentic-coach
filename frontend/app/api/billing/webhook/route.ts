import { clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// Force dynamic — no static prerendering or module-level Stripe init
export const dynamic = "force-dynamic";

// Plan mapping from Stripe price IDs
const PRICE_TO_PLAN: Record<string, string> = {
  price_1TZdccK81lqFuAqaUpBtDmvt: "basic",
  price_1TZdcdK81lqFuAqa5aXKj8F6: "pro",
};

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
      if (userId && plan) {
        await clerk.users.updateUserMetadata(userId, {
          publicMetadata: { plan, stripeCustomerId: session.customer },
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
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
