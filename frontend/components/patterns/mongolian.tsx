// Soyombo symbol — Mongolian national symbol used as DemoSage logo mark
// Represents fire (top), sun, moon, earth, and water

export function SoyomboIcon({ size = 32, color = "#C9A227", className = "" }: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Flame */}
      <path d="M50 5 C46 15, 38 18, 42 28 C44 33, 50 35, 50 35 C50 35, 56 33, 58 28 C62 18, 54 15, 50 5Z" fill={color} />
      {/* Sun */}
      <circle cx="50" cy="45" r="8" fill={color} />
      <circle cx="50" cy="45" r="12" fill="none" stroke={color} strokeWidth="2.5" />
      {/* Moon */}
      <path d="M35 62 Q50 54 65 62" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Horizontal bars */}
      <rect x="22" y="72" width="56" height="5" rx="2" fill={color} />
      <rect x="22" y="82" width="56" height="5" rx="2" fill={color} />
      {/* Vertical side bars */}
      <rect x="18" y="72" width="4" height="40" rx="2" fill={color} />
      <rect x="78" y="72" width="4" height="40" rx="2" fill={color} />
      {/* Bottom bars */}
      <rect x="22" y="107" width="56" height="5" rx="2" fill={color} />
    </svg>
  );
}

// Ulzii border — decorative horizontal divider
export function UlziiBorder({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full h-px relative overflow-hidden ${className}`}>
      <svg width="100%" height="8" preserveAspectRatio="none" viewBox="0 0 400 8" xmlns="http://www.w3.org/2000/svg">
        <pattern id="ulzii-line" x="0" y="0" width="40" height="8" patternUnits="userSpaceOnUse">
          <rect x="0" y="3" width="12" height="2" fill="#1E3A5F" />
          <rect x="14" y="3" width="4" height="2" fill="#2D7DD2" />
          <rect x="20" y="3" width="12" height="2" fill="#1E3A5F" />
          <rect x="34" y="3" width="4" height="2" fill="#2D7DD2" />
        </pattern>
        <rect width="400" height="8" fill="url(#ulzii-line)" />
      </svg>
    </div>
  );
}

// Cloud motif — Mongolian хэрэм хээ background pattern
export function CloudMotifBg({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='120' height='60' viewBox='0 0 120 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 40 Q15 20 30 40 Q45 55 60 40 Q75 20 90 40 Q105 55 120 40' fill='none' stroke='%23F0F4FF' stroke-width='1' opacity='0.04'/%3E%3Cpath d='M0 55 Q15 35 30 55 Q45 70 60 55 Q75 35 90 55 Q105 70 120 55' fill='none' stroke='%23F0F4FF' stroke-width='0.8' opacity='0.03'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        backgroundSize: "120px 60px",
      }}
    />
  );
}
