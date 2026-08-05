import {
  AlertOctagon,
  Brain,
  Car,
  ClipboardCheck,
  Cpu,
  Eye,
  Flame,
  HardHat,
  Package,
  PersonStanding,
  ShieldAlert,
  Siren,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  person: PersonStanding,
  fire: Flame,
  smoking: UserX,
  helmet: HardHat,
  "face-mask": Cpu,
  vehicle: Car,
  intrusion: ShieldAlert,
  drowsiness: AlertOctagon,
  weapon: Siren,
  package: Package,
  "hard-hat": HardHat,
  users: Users,
  "alert-octagon": AlertOctagon,
  car: Car,
};

export default function DetectorIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const Icon = iconMap[icon] ?? Brain;
  return <Icon className={className} />;
}

export function DetectorCategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const map: Record<string, LucideIcon> = {
    Person: PersonStanding,
    Fire: Flame,
    Behavior: ClipboardCheck,
    Safety: HardHat,
    Vehicle: Car,
    Security: ShieldAlert,
  };
  const Icon = map[category] ?? Eye;
  return <Icon className={className} />;
}
