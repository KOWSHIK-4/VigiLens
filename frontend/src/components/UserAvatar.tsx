interface UserAvatarProps {
  name: string;
  avatar?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
};

const BG_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return BG_COLORS[hash % BG_COLORS.length];
}

export default function UserAvatar({
  name,
  avatar,
  size = "md",
  className = "",
}: UserAvatarProps) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        referrerPolicy="no-referrer"
        className={`${SIZE_CLASSES[size]} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${SIZE_CLASSES[size]} ${colorFor(
        name,
      )} rounded-full flex items-center justify-center font-semibold flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </div>
  );
}
