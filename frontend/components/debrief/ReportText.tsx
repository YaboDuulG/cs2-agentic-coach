import { Fragment, type ReactNode } from "react";

/**
 * The legacy markdown reports, rendered without a markdown library: "###"
 * lines become headings, "- " lines bullets, everything else paragraphs.
 */
export function ReportText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-2 list-disc space-y-1 pl-5 text-sm" style={{ color: "var(--color-text-2)" }}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      bullets.push(line.slice(2));
      return;
    }
    flush();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <h4 key={i} className="mt-4 text-sm first:mt-0">
          {inline(heading[2])}
        </h4>,
      );
      return;
    }
    out.push(
      <p key={i} className="my-2 text-sm" style={{ color: "var(--color-text-2)" }}>
        {inline(line)}
      </p>,
    );
  });
  flush();
  return <div>{out}</div>;
}

/** **bold** only; anything else stays literal. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} style={{ color: "var(--color-text)" }}>
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

/** Collapsed by default; the summary line is the only thing visible at rest. */
export function Collapsible({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="surface-2 group" open={defaultOpen}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold marker:text-(--color-text-3)">{summary}</summary>
      <div className="border-t hairline px-4 py-3">{children}</div>
    </details>
  );
}
