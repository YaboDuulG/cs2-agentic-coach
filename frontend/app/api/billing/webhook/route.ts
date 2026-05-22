import { clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Plan mapping from Stripe price IDs
const PRICE_TO_PLAN: Record<string, string> = {
  price_1TZdccK81lqFuAqaUpBtDmvt: "basic",
  price_1TZdcdK81lqFuAqa5aXKj8F6: "pro",
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const clerk = await clerkClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
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
      const sub = event.data.object as Stripe.Subscription;
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
      const sub = event.data.object as Stripe.Subscription;
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


