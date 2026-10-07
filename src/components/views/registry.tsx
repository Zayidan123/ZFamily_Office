"use client";

// ============================================================
// Registry view — map ViewKey → komponen (SPA single-route).
// SETIAP view punya file sendiri; agent view HANYA mengganti
// file view-nya masing-masing — registry tidak perlu diubah.
// ============================================================
import type { ComponentType } from "react";
import type { ViewKey } from "@/lib/nav";
import DashboardView from "@/components/views/dashboard-view";
import AssetsView from "@/components/views/assets-view";
import TransactionsView from "@/components/views/transactions-view";
import PortfolioView from "@/components/views/portfolio-view";
import TradingView from "@/components/views/trading-view";
import MarketView from "@/components/views/market-view";
import GovernanceView from "@/components/views/governance-view";
import TaxView from "@/components/views/tax-view";
import ResearchView from "@/components/views/research-view";
import SuccessionView from "@/components/views/succession-view";
import SettingsView from "@/components/views/settings-view";

export const VIEW_COMPONENTS: Record<ViewKey, ComponentType> = {
  dashboard: DashboardView,
  assets: AssetsView,
  transactions: TransactionsView,
  portfolio: PortfolioView,
  trading: TradingView,
  market: MarketView,
  governance: GovernanceView,
  tax: TaxView,
  research: ResearchView,
  succession: SuccessionView,
  settings: SettingsView,
};
