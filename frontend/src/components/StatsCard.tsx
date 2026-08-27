type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

const TONE_STYLES: Record<Tone, { iconBg: string; iconText: string; value: string }> = {
  neutral: { iconBg: "bg-gray-100", iconText: "text-gray-500", value: "text-gray-900" },
  blue: { iconBg: "bg-blue-50", iconText: "text-blue-600", value: "text-gray-900" },
  green: { iconBg: "bg-green-50", iconText: "text-green-600", value: "text-green-600" },
  amber: { iconBg: "bg-amber-50", iconText: "text-amber-600", value: "text-amber-600" },
  red: { iconBg: "bg-red-50", iconText: "text-red-600", value: "text-red-600" },
  violet: { iconBg: "bg-violet-50", iconText: "text-violet-600", value: "text-gray-900" },
};

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon?: React.ReactNode;
  tone?: Tone;
}

export default function StatsCard({
  title,
  value,
  change,
  icon,
  tone = "neutral",
}: StatsCardProps) {
  const style = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  return (
    <div className="card flex flex-col gap-3 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-500 leading-snug">{title}</p>
        {icon && (
          <span
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${style.iconBg} ${style.iconText}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className={`text-3xl font-bold leading-none truncate ${style.value}`}>
        {value}
      </p>
      {change && <p className="text-sm text-gray-500">{change}</p>}
    </div>
  );
}