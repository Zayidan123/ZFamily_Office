// ============================================================
// Family Office — Mr.Z · Zustand global store (persist)
// auth + activeView (navigasi SPA) + displayCurrency
// ============================================================
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User } from "@/lib/types";
import type { ViewKey } from "@/lib/nav";

interface AppState {
  // auth
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  // navigasi SPA (single-route — TIDAK pakai router)
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
  // preferensi tampilan
  displayCurrency: "USD" | "IDR";
  setDisplayCurrency: (c: "USD" | "IDR") => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
      activeView: "dashboard",
      setActiveView: (activeView) => set({ activeView }),
      displayCurrency: "USD",
      setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
    }),
    {
      name: "zfo-app-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
