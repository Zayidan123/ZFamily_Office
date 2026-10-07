"use client";

// ============================================================
// ROOT SPA (single-route) — Z Family Office
// Semua navigasi antar-view via zustand store; TIDAK ada route lain.
// ============================================================
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import AppShell from "@/components/shell/app-shell";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Jangan retry error yang pasti permanen
          if (error instanceof ApiError && [400, 401, 403, 404, 423].includes(error.status)) {
            return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export default function Home() {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
