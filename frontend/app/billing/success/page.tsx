import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <main className="flex min-h-[calc(100vh-56px)] items-center justify-center bg-[#080E1A] px-6">
      <div className="max-w-md text-center">
        <div className="mb-6 text-6xl">🏆</div>
        <h1 className="font-cinzel text-4xl font-bold text-white">
          You&apos;re upgraded!
        </h1>
        <p className="mt-4 text-lg text-slate-400">
          Your plan has been activated. Start uploading demos and dominate.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-xl bg-[#2D7DD2] px-8 py-3 font-bold text-white transition-all hover:bg-[#2D7DD2]/80"
          >
            Upload a Demo
          </Link>
          <Link
            href="/profile"
            className="rounded-xl border border-white/10 px-8 py-3 font-semibold text-slate-300 transition-all hover:bg-white/5"
          >
            My Analyses
          </Link>
        </div>
      </div>
    </main>
  );
}
