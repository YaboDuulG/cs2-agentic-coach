import { Debrief } from "@/components/debrief/Debrief";

/** The debrief route: polling, states and layout live in components/debrief. */
export default async function AnalysisPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <Debrief matchId={jobId} />;
}
