import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// NOTE: /billing is deliberately public — it's the pricing page; prospects
// must see tiers before signing up. Checkout itself still requires a session.
const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/profile(.*)",
  "/analysis(.*)",
  "/teams(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
