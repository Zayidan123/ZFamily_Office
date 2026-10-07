// ============================================================
// Family Office — Mr.Z · API client wrapper
// - Path relatif /api/v1/... + query XTransformPort=8001 (gateway Caddy)
// - Auto header Authorization dari zustand store
// - Unwrap envelope {ok, data} → data | throw ApiError(status, message)
// - 401 → reset auth store
// ============================================================
import { useAppStore } from "@/lib/store";

const API_BASE = "/api/v1";
const BACKEND_PORT = "8001";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function buildUrl(path: string, params?: ApiFetchOptions["params"]): string {
  const qs = new URLSearchParams();
  qs.set("XTransformPort", BACKEND_PORT);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }
  return `${API_BASE}${path}?${qs.toString()}`;
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", body, params }: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = useAppStore.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    // jaringan / backend down
    throw new ApiError(0, "Backend belum terjangkau — mencoba lagi");
  }

  const json = (await res.json().catch(() => null)) as Envelope<T> | null;

  if (res.status === 401) {
    useAppStore.getState().clearAuth();
    throw new ApiError(401, json?.error ?? "Sesi berakhir — silakan login kembali");
  }

  if (!res.ok || !json || json.ok === false) {
    throw new ApiError(
      res.status,
      json?.error ?? `Permintaan gagal (HTTP ${res.status})`,
    );
  }

  return json.data as T;
}

/** Endpoint API v1 yang sering dipakai */
export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: import("@/lib/types").User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),
  me: () => apiFetch<import("@/lib/types").User>("/auth/me"),
  systemStatus: () => apiFetch<import("@/lib/types").SystemStatus>("/system/status"),
  rates: () => apiFetch<import("@/lib/types").RateInfo>("/rates"),
  dashboardSummary: () => apiFetch<import("@/lib/types").DashboardSummary>("/dashboard/summary"),
  dashboardHistory: (months = 18) =>
    apiFetch<import("@/lib/types").HistoryPoint[]>("/dashboard/history", {
      params: { months },
    }),
  snapshot: () => apiFetch<unknown>("/dashboard/snapshot", { method: "POST" }),
};
