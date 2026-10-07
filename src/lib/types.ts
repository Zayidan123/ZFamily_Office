// ============================================================
// Family Office — Mr.Z · TS types untuk seluruh entitas API v1
// Sesuai API CONTRACT (worklog.md) — backend FastAPI :8001
// ============================================================

// ---------- Auth & Users ----------
export type Role = "owner" | "beneficiary" | "advisor" | "executor";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// ---------- System ----------
export interface SystemStatus {
  panicMode: boolean;
  version: string;
  serverTime: string;
}

export interface PriceInfo {
  usd: number;
  change24hPct: number;
}

export interface RateInfo {
  USDIDR: number;
  updatedAt: string;
  prices: Record<string, PriceInfo>;
}

export interface AllocationTarget {
  crypto: number;
  stocks: number;
  forexGold: number;
  property: number;
  cash: number;
}

export interface Settings {
  displayCurrency: "USD" | "IDR";
  allocationTargets: AllocationTarget;
}

// ---------- Assets ----------
export type AssetClass =
  | "crypto"
  | "stocks"
  | "forex_gold"
  | "property"
  | "vehicle"
  | "cash"
  | "business";

export interface Asset {
  id: string;
  name: string;
  assetClass: AssetClass;
  symbol?: string | null;
  entityId: string;
  entityName?: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
  unitPriceUsd: number;
  valueUsd: number;
  valueIdr: number;
  sourceType: string;
  sourceLabel?: string | null;
  notes?: string | null;
  updatedAt: string;
}

export interface AssetClassRow {
  class: AssetClass;
  valueUsd: number;
  pct: number;
  count: number;
  change24hPct: number;
}

// ---------- Transactions ----------
export type TransactionType =
  | "buy"
  | "sell"
  | "transfer_in"
  | "transfer_out"
  | "income"
  | "expense"
  | "valuation_update";

export interface Transaction {
  id: string;
  assetId: string;
  assetName: string;
  type: TransactionType;
  quantity: number;
  priceUsd: number;
  totalUsd: number;
  feeUsd: number;
  note?: string | null;
  at: string;
}

// ---------- Governance ----------
export type EntityType = "personal" | "holding" | "family";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string | null;
  createdAt?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  title: string;
  description?: string | null;
  amountUsd: number;
  status: ApprovalStatus;
  requestedByName: string;
  decidedByName?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

export interface AuditLog {
  id: string;
  userName: string;
  role: Role;
  action: string;
  entityType: string;
  detail?: string | null;
  createdAt: string;
}

// ---------- Risk ----------
export interface RiskAllocationRow {
  class: AssetClass;
  valueUsd: number;
  pct: number;
  targetPct: number;
  driftPct: number;
}

export interface ConcentrationRow {
  type: string;
  label: string;
  pct: number;
  level: "normal" | "warning" | "critical";
}

export interface RiskOverview {
  allocation: RiskAllocationRow[];
  concentration: ConcentrationRow[];
  var95Usd: number;
  var95Pct: number;
  largestPositionPct: number;
}

export interface StressScenario {
  assetClass: AssetClass;
  changePct: number;
}

export interface StressTestResult {
  baselineUsd: number;
  stressedUsd: number;
  impactUsd: number;
  impactPct: number;
  byClass: { class: AssetClass; beforeUsd: number; afterUsd: number; impactUsd: number }[];
}

// ---------- Trading ----------
export type StrategyStatus = "active" | "paused" | "archived";

export interface Strategy {
  id: string;
  name: string;
  platform: string;
  status: StrategyStatus;
  description?: string | null;
  winRatePct: number;
  pnlUsd: number;
  tradeCount: number;
  lastSignalAt?: string | null;
}

export interface Trade {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: "long" | "short" | "buy" | "sell";
  quantity: number;
  entryPrice: number;
  exitPrice?: number | null;
  pnlUsd: number;
  openedAt: string;
  closedAt?: string | null;
}

export interface StrategyPerformance {
  strategyId: string;
  name: string;
  pnlUsd: number;
  tradeCount: number;
  winRatePct: number;
  contributionPct: number;
}

export type AlertLevel = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  source?: string | null;
  level: AlertLevel;
  message: string;
  createdAt: string;
}

// ---------- Research ----------
export type ResearchStatus = "draft" | "active" | "closed";

export interface ResearchNote {
  id: string;
  title: string;
  assetId?: string | null;
  assetName?: string | null;
  thesis: string;
  targetPriceUsd?: number | null;
  exitPlan?: string | null;
  status: ResearchStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Succession & Planning ----------
export interface SuccessionRule {
  id: string;
  beneficiaryName: string;
  relation: string;
  entityName?: string | null;
  assetScope: string;
  conditions: string;
  trigger: string;
  status: string;
}

export interface EmergencyInstruction {
  id: string;
  title: string;
  content: string | null;
  sealed: boolean;
}

export interface Goal {
  id: string;
  name: string;
  targetUsd: number;
  currentUsd: number;
  progressPct: number;
  deadline: string;
}

export interface Capsule {
  id: string;
  title: string;
  unlockCondition: string;
  unlockDate?: string | null;
  unlocked: boolean;
  content: string | null;
}

// ---------- PnL FIFO per aset (v1.4.0 — Task U-a/U-b) ----------
export interface AssetPnlLot {
  at: string;
  type: string; // "buy" | "sell" | …
  qty: number;
  priceUsd: number;
  remainingQty: number;
}

export interface AssetPnl {
  assetId: number | string; // backend kirim numeric id
  assetName: string;
  symbol?: string | null;
  currency: string;
  realizedPnlUsd: number;
  /** null jika aset tanpa riwayat buy (basis biaya belum terbentuk) */
  avgCostUsd: number | null;
  remainingQty: number;
  costBasisUsd: number;
  /** null jika tanpa lot */
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  lots: AssetPnlLot[];
}

// ---------- Laporan Kinerja Bulanan (v1.4.0 — Task U-a/U-b) ----------
export interface MonthlyReportRow {
  month: string; // "2026-01"
  startUsd: number;
  endUsd: number;
  changeUsd: number;
  changePct: number;
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  txCount: number;
}

export interface ReportBestWorstMonth {
  month: string;
  changeUsd: number;
}

export interface MonthlyReportSummary {
  totalChangeUsd: number;
  totalChangePct: number;
  bestMonth: ReportBestWorstMonth | null;
  worstMonth: ReportBestWorstMonth | null;
  avgMonthlyChangeUsd: number;
  totalInflowUsd: number;
  totalOutflowUsd: number;
}

export interface MonthlyReport {
  months: MonthlyReportRow[];
  summary: MonthlyReportSummary;
}

// ---------- Perbandingan benchmark (v1.5.0 — Task V-a/V-final) ----------
/** Titik seri terindeks: 100 = awal periode. */
export interface BenchmarkPoint {
  month: string;
  value: number;
}

export interface BenchmarkSeries {
  key: "portfolio" | "btc_hold" | "gold_hold" | "balanced" | string;
  label: string;
  points: BenchmarkPoint[];
}

export interface BenchmarkSummary {
  portfolioPct: number;
  best: { key: string; label: string; pct: number };
  winningMonths: number;
  totalMonths: number;
}

export interface BenchmarkReport {
  months: number;
  series: BenchmarkSeries[];
  summary: BenchmarkSummary;
}

// ---------- Notifikasi: status dibaca (v1.4.0 — Task U-a/U-b) ----------
/** AlertItem + status dibaca (opsional agar backward-compatible dengan shape lama). */
export interface AlertItemWithRead extends AlertItem {
  isRead?: boolean;
}

/** Baris GET /trading/alerts (v1.4.0 — punya isRead: boolean). */
export type TradingAlertRow = AlertItemWithRead;

/** Respons GET /trading/alerts/unread-count. */
export interface UnreadCount {
  unread: number;
}

// ---------- Dashboard ----------
export interface DashboardByClassRow {
  class: AssetClass;
  valueUsd: number;
  pct: number;
  change24hPct: number;
}

export interface DashboardCounts {
  assets: number;
  entities: number;
  strategies: number;
  pendingApprovals: number;
}

export interface TopHolding {
  id?: string;
  name: string;
  assetClass: AssetClass;
  valueUsd: number;
  pct: number;
}

export interface DashboardSummary {
  netWorthUsd: number;
  netWorthIdr: number;
  change24hPct: number;
  byClass: DashboardByClassRow[];
  counts: DashboardCounts;
  recentTransactions: Transaction[];
  alerts: AlertItem[];
  topHoldings: TopHolding[];
}

export interface HistoryPoint {
  date: string;
  valueUsd: number;
}

// ============================================================
// Paper Trading (kontrak backend v1.4 — /trading/paper/*)
// Dipakai Quick Trade (Pasar) + Paper Trading panel (Trading).
// ============================================================

/** Posisi paper trading — turunan dari replay paper_trades di backend */
export interface PaperPosition {
  symbol: string;
  qty: number;
  avgPriceUsd: number;
  currentPriceUsd: number;
  valueUsd: number;
  unrealizedPnlUsd: number;
}

/** GET /trading/paper/account — juga response dari POST /orders & /reset */
export interface PaperAccount {
  cashUsd: number;
  realizedPnlUsd: number;
  equityUsd: number;
  positions: PaperPosition[];
}

/** GET /trading/paper/trades — satu trade virtual */
export interface PaperTrade {
  id: string | number;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  priceUsd: number;
  realizedPnlUsd: number | null;
  at: string;
}
