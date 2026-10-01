/** Team identity: the uploaded logo, else initials on a hashed hue. */
export function TeamMark({ name, logoUrl, size = 40 }: { name: string; logoUrl?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-(--radius-md) object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-(--radius-md) font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `oklch(0.32 0.06 ${hue})`,
        color: `oklch(0.92 0.05 ${hue})`,
        fontFamily: "var(--font-heading)",
      }}
    >
      {initials || "?"}
    </span>
  );
}
