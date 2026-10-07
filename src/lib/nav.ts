// ============================================================
// Family Office — Mr.Z · Navigasi SPA (single-route, state-based)
// ============================================================
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  PieChart,
  TrendingUp,
  Landmark,
  FlaskConical,
  Users,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ViewKey =
  | "dashboard"
  | "assets"
  | "transactions"
  | "portfolio"
  | "trading"
  | "governance"
  | "research"
  | "succession"
  | "settings";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "assets", label: "Aset", icon: Wallet },
  { key: "transactions", label: "Transaksi", icon: ArrowLeftRight },
  { key: "portfolio", label: "Portofolio", icon: PieChart },
  { key: "trading", label: "Trading", icon: TrendingUp },
  { key: "governance", label: "Governance", icon: Landmark },
  { key: "research", label: "Riset", icon: FlaskConical },
  { key: "succession", label: "Suksesi", icon: Users },
  { key: "settings", label: "Pengaturan", icon: Settings },
];

export const VIEW_TITLES: Record<ViewKey, string> = Object.fromEntries(
  NAV_ITEMS.map((n) => [n.key, n.label]),
) as Record<ViewKey, string>;
