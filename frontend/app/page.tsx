import { auth } from "@clerk/nextjs/server";
import { Home } from "@/components/home/Home";
import { Landing } from "@/components/home/Landing";

export const dynamic = "force-dynamic";

/** Signed out: the landing page. Signed in: Home. One URL, one navbar. */
export default async function RootPage() {
  const { userId } = await auth();
  return userId ? <Home /> : <Landing />;
}
