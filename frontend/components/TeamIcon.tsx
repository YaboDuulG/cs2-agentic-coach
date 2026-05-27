import React from "react";

export interface DevilFruit {
  name: string;
  emoji: string;
  color: string;
  type: string;
  description: string;
}

export const DEVIL_FRUITS: DevilFruit[] = [
  { 
    name: "Gomu Gomu no Mi", 
    emoji: "🍇", 
    color: "#8B5CF6", 
    type: "Paramecia",
    description: "Grants the body the properties of rubber, making the user a Rubber Human."
  },
  { 
    name: "Mera Mera no Mi", 
    emoji: "🔥", 
    color: "#F97316", 
    type: "Logia",
    description: "Allows the user to create, control, and transform into fire at will."
  },
  { 
    name: "Ope Ope no Mi", 
    emoji: "❤️", 
    color: "#06B6D4", 
    type: "Paramecia",
    description: "Allows the user to create a spherical space where they can manipulate anything."
  },
  { 
    name: "Goro Goro no Mi", 
    emoji: "⚡", 
    color: "#EAB308", 
    type: "Logia",
    description: "Allows the user to create, control, and transform into electricity at will."
  },
  { 
    name: "Yami Yami no Mi", 
    emoji: "🌀", 
    color: "#3B82F6", 
    type: "Logia",
    description: "Allows the user to create and control darkness, absorbing anything like a black hole."
  },
  { 
    name: "Gura Gura no Mi", 
    emoji: "🪐", 
    color: "#64748B", 
    type: "Paramecia",
    description: "Allows the user to create powerful shockwaves, making them a Tremor Human."
  },
  { 
    name: "Hito Hito no Mi", 
    emoji: "🍄", 
    color: "#EF4444", 
    type: "Zoan",
    description: "Grants the user the intelligence and physical traits of a human."
  },
  { 
    name: "Tori Tori no Mi, Model: Phoenix", 
    emoji: "🐦", 
    color: "#14B8A6", 
    type: "Zoan",
    description: "Allows the user to transform into a phoenix, granting blue flames of regeneration."
  },
];

export function getDevilFruit(teamId: string): DevilFruit {
  let hash = 0;
  for (let i = 0; i < teamId.length; i++) {
    hash = teamId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % DEVIL_FRUITS.length;
  return DEVIL_FRUITS[index];
}

interface TeamIconProps {
  teamId: string;
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}

export function TeamIcon({ teamId, name, logoUrl, size = "md" }: TeamIconProps) {
  const sizes = {
    sm: "w-8 h-8 text-[11px] rounded-lg",
    md: "w-11 h-11 text-[13px] rounded-xl",
    lg: "w-16 h-16 text-lg rounded-2xl",
    xl: "w-24 h-24 text-2xl rounded-3xl",
  };

  if (logoUrl) {
    // If it is a relative path (e.g. /logos/...), we prepend API URL if needed, but since Next.js proxies `/logos/...` to `/api/logos/...` or directly, wait!
    // In local mode, the backend mounts `/logos` at `http://localhost:8000/logos`.
    // Wait, does the frontend proxy serve `/logos`?
    // Let's check: if the logo URL starts with `/logos/`, we should probably load it from the backend URL!
    // Wait! Let's check `process.env.NEXT_PUBLIC_API_URL`. If local, it is `http://localhost:8000`.
    // If we just use the relative URL `/logos/...`, the frontend Next.js server might try to serve it from its public directory.
    // So we should construct the full URL if it is a relative path!
    // Let's do that!
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const src = logoUrl.startsWith("/") ? `${API_URL}${logoUrl}` : logoUrl;

    return (
      <img
        src={src}
        alt={name}
        className={`${sizes[size]} object-cover border border-[#1E3A5F] shadow-md`}
        onError={(e) => {
          // If the image fails to load (e.g. 404 or bad URL), clear the image and fall back to Devil Fruit!
          (e.target as HTMLElement).style.display = "none";
        }}
      />
    );
  }

  const fruit = getDevilFruit(teamId);
  const initials = name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const emojiSizes = {
    sm: "text-[10px] p-0.5",
    md: "text-xs p-0.5",
    lg: "text-lg p-1",
    xl: "text-2xl p-2",
  };

  return (
    <div
      className={`${sizes[size]} flex flex-col items-center justify-center font-bold text-white relative overflow-hidden group select-none border shadow-md`}
      style={{
        background: `linear-gradient(135deg, ${fruit.color}99 0%, #080E1A 100%)`,
        borderColor: `${fruit.color}44`,
      }}
    >
      {/* Background swirl pattern to look like Devil Fruit skin */}
      <div 
        className="absolute inset-0 opacity-[0.12] mix-blend-overlay pointer-events-none group-hover:scale-110 transition-transform duration-500"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='30' height='30' viewBox='0 0 30 30' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M15 0 C6.7 0 0 6.7 0 15 C0 23.3 6.7 30 15 30 Q22.5 15 15 0' fill='none' stroke='%23ffffff' stroke-width='1.5'/%3E%3C/svg%3E")`,
          backgroundSize: "20px 20px"
        }}
      />
      
      <span className="relative z-10 transition-transform group-hover:scale-95 duration-300 font-mono tracking-tight">
        {initials}
      </span>
      <span className={`absolute bottom-0 right-0 ${emojiSizes[size]} opacity-70 leading-none pointer-events-none z-10 filter drop-shadow`}>
        {fruit.emoji}
      </span>
    </div>
  );
}
