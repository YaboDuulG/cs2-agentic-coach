import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { PLAN_LIMITS } from "@/lib/flags";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getAnalyses(userId: string) {
  try {
    const res = await fetch(`${API_URL}/api/analyses?user_id=${userId}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    done: { label: "Done", color: "text-green-400 bg-green-400/10 border-green-400/20" },
    complete: { label: "Done", color: "text-green-400 bg-green-400/10 border-green-400/20" },
    processing: { label: "Processing", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
    queued: { label: "Queued", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
    failed: { label: "Failed", color: "text-red-400 bg-red-400/10 border-red-400/20" },
  };
  const s = map[status] ?? { label: status, color: "text-slate-400 bg-white/5 border-white/10" };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.color}`}>
      {s.label}
    </span>
  );
}

export default async function DashboardPage() {
  const { userId } = await auth();
  const user = await currentUser();
  const plan = (user?.publicMetadata?.plan as string) ?? "free";
  const planLimits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  const uploadsThisMonth = (user?.publicMetadata?.uploadsThisMonth as number) ?? 0;
  const limit = planLimits.uploadsPerMonth;
  const limitDisplay = limit === Infinity ? "∞" : limit;
  const usagePct = limit === Infinity ? 0 : Math.min((uploadsThisMonth / limit) * 100, 100);

  const analyses = userId ? await getAnalyses(userId) : [];

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#080E1A] px-6 py-12">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <h1 className="font-cinzel text-3xl font-bold text-white">My Analyses</h1>
            <p className="mt-1 text-slate-400">
              Welcome back,{" "}
              <span className="text-white">{user?.firstName ?? "Khan"}</span>
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl bg-[#2D7DD2] px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#2D7DD2]/80"
          >
            + Upload Demo
          </Link>
        </div>

        {/* Usage meter */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-400">Monthly Usage</p>
              <p className="mt-1 font-mono text-2xl font-bold text-white">
                {uploadsThisMonth}
                <span className="text-slate-500"> / {limitDisplay} demos</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold capitalize text-slate-400">
                Plan: <span className={plan === "pro" ? "text-[#FFE135]" : plan === "basic" ? "text-blue-400" : "text-slate-300"}>
                  {plan}
                </span>
              </p>
              {plan !== "pro" && (
                <Link href="/billing" className="mt-1 block text-xs text-[#2D7DD2] hover:underline">
                  Upgrade for more →
                </Link>
              )}
            </div>
          </div>
          {limit !== Infinity && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#2D7DD2] transition-all"
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>

        {/* Analyses list */}
        {analyses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-20 text-center">
            <p className="text-4xl">📁</p>
            <p className="mt-4 font-cinzel text-xl text-white">No analyses yet</p>
            <p className="mt-2 text-slate-400">Upload your first .dem file to get started</p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-xl bg-[#2D7DD2] px-6 py-3 font-bold text-white hover:bg-[#2D7DD2]/80"
            >
              Upload Demo
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {analyses.map((a: { match_id: string; map?: string; status: string; created_at?: string }) => (
              <Link
                key={a.match_id}
                href={`/analysis/${a.match_id}`}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-[#2D7DD2]/40 hover:bg-white/5"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2D7DD2]/10 text-lg">
                    🗺️
                  </div>
                  <div>
                    <p className="font-semibold text-white">{a.map ?? "Unknown Map"}</p>
                    <p className="font-mono text-xs text-slate-500">
                      {a.match_id.slice(0, 8)}… ·{" "}
                      {a.created_at
                        ? new Date(a.created_at).toLocaleDateString()
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(a.status)}
                  <span className="text-slate-500">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
