import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { PLAN_LIMITS } from "@/lib/flags";

export async function POST(req: NextRequest) {
  // Lazy-init Stripe so it's never evaluated at build time
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // --- Auth ---
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan } = await req.json();
  const planConfig = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];
  if (!planConfig || !planConfig.stripePriceId) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://cs2-agentic-coach.vercel.app";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: planConfig.stripePriceId, quantity: 1 }],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing`,
    client_reference_id: userId,
    metadata: { clerk_user_id: userId, plan },
    subscription_data: {
      metadata: { clerk_user_id: userId, plan },
    },
  });

  return NextResponse.json({ url: session.url });
}
