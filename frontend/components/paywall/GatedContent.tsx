import { PaywalledPreview } from "@/lib/api/client";
import { GatedInsightCard } from "./GatedInsightCard";

/**
 * Wrapper around content the server may have omitted. Children are only ever
 * present when the server actually included the data — the backend redacts
 * paywalled payloads before they reach the client (entitlements.py), so this
 * component never hides real data; it just renders the server's preview stub
 * when that is all there is.
 */
export interface GatedContentProps {
  preview?: PaywalledPreview | null;
  children?: React.ReactNode;
}

export function GatedContent({ preview, children }: GatedContentProps) {
  const hasChildren =
    children != null && (!Array.isArray(children) || children.some((c) => c != null));

  if (preview?.locked) return <GatedInsightCard preview={preview} />;
  if (preview && preview.hidden_insights_count > 0 && !hasChildren) {
    return <GatedInsightCard preview={preview} />;
  }
  if (!hasChildren) return null;
  return <>{children}</>;
}
