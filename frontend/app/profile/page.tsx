import { redirect } from "next/navigation";

/** The old profile page split into /matches and /settings. */
export default async function ProfileRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
  redirect(q.size ? `/settings?${q.toString()}` : "/settings");
}
