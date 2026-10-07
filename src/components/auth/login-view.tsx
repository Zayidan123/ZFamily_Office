"use client";

// ============================================================
// Login — split screen: panel brand (kiri) + form & akses demo (kanan)
// ============================================================
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import { Monogram } from "@/components/shared/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck,
  TrendingUp,
  HeartHandshake,
  Loader2,
  LogIn,
  Crown,
  Users,
  Briefcase,
  KeyRound,
} from "lucide-react";

const DEMO_ACCOUNTS = [
  {
    role: "Owner",
    name: "Mr.Z",
    email: "owner@zfamily.id",
    password: "owner123",
    icon: Crown,
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
  },
  {
    role: "Beneficiary",
    name: "Aisyah",
    email: "aisyah@zfamily.id",
    password: "family123",
    icon: Users,
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
  },
  {
    role: "Advisor",
    name: "Budi",
    email: "budi@partner.id",
    password: "advisor123",
    icon: Briefcase,
    className:
      "border-teal-500/40 bg-teal-500/10 text-teal-700 hover:bg-teal-500/20 dark:text-teal-400",
  },
  {
    role: "Executor",
    name: "Raka",
    email: "raka@zfamily.id",
    password: "executor123",
    icon: KeyRound,
    className:
      "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 hover:bg-zinc-500/20 dark:text-zinc-300",
  },
] as const;

const VALUE_POINTS = [
  {
    icon: ShieldCheck,
    title: "Keamanan Berlapis",
    desc: "RBAC 4 peran, audit log append-only, dan panic mode kill-switch.",
  },
  {
    icon: TrendingUp,
    title: "Kekayaan Multi-Aset",
    desc: "Kripto, saham, forex/emas, hingga aset fisik dalam satu layar.",
  },
  {
    icon: HeartHandshake,
    title: "Warisan Lintas Generasi",
    desc: "Aturan suksesi, tujuan keuangan, dan time capsule keluarga.",
  },
] as const;

export default function LoginView() {
  const setAuth = useAppStore((s) => s.setAuth);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pendingDemo, setPendingDemo] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (creds: { email: string; password: string; role?: string }) => {
      setPendingDemo(creds.role ?? "form");
      return api.login(creds.email, creds.password);
    },
    onSuccess: (res, vars) => {
      setAuth(res.token, res.user);
      setActiveView("dashboard");
      toast.success(`Selamat datang, ${res.user.name}`, {
        description: `Masuk sebagai ${res.user.role}.`,
      });
      setPendingDemo(null);
      setPassword("");
      void vars;
    },
    onError: (err) => {
      const message =
        err instanceof ApiError
          ? err.message
          : "Backend belum terjangkau — mencoba lagi";
      toast.error("Gagal masuk", { description: message });
      setPendingDemo(null);
    },
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Lengkapi email dan password");
      return;
    }
    mutation.mutate({ email: email.trim(), password });
  };

  const busy = mutation.isPending;

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* ================= Panel kiri — brand ================= */}
      <aside
        className="relative hidden overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between p-10 xl:p-14"
        aria-label="Tentang Z Family Office"
      >
        {/* glow dekoratif */}
        <div
          className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <Monogram size={44} />
          <div>
            <p className="font-semibold tracking-tight text-zinc-100">Z Family Office</p>
            <p className="text-xs text-zinc-400">Internal Wealth Platform</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-6">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-zinc-50">
            Pusat kendali kekayaan{" "}
            <span className="bg-gradient-to-r from-amber-400 to-emerald-400 bg-clip-text text-transparent">
              lintas generasi
            </span>
          </h1>
          <ul className="space-y-5">
            {VALUE_POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-4">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  aria-hidden="true"
                >
                  <p.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-medium text-zinc-100">{p.title}</p>
                  <p className="text-sm text-zinc-400">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-zinc-500">
          © {new Date().getFullYear()} Z Family Office — Internal Use Only
        </p>
      </aside>

      {/* ================= Panel kanan — form ================= */}
      <main className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-emerald-50/60 via-zinc-50 to-zinc-100 px-4 py-10 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 sm:px-6">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <Monogram size={44} />
          <div>
            <p className="font-semibold tracking-tight">Z Family Office</p>
            <p className="text-xs text-muted-foreground">Pusat kendali kekayaan lintas generasi</p>
          </div>
        </div>

        <Card className="w-full max-w-md rounded-xl border-border/70 p-6 shadow-sm sm:p-8">
          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight">Masuk ke platform</h2>
            <p className="text-sm text-muted-foreground">
              Gunakan akun keluarga Anda untuk mengakses dasbor kekayaan.
            </p>
          </div>

          <form onSubmit={submitForm} className="mt-6 space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nama@zfamily.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                disabled={busy}
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy}
            >
              {busy && pendingDemo === "form" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              {busy && pendingDemo === "form" ? "Memproses…" : "Masuk"}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">atau</span>
            <Separator className="flex-1" />
          </div>

          {/* Akses Demo Cepat */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-sm font-semibold">Akses Demo Cepat</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Masuk instan dengan salah satu peran demo (kredensial uji).
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => {
                const loading = busy && pendingDemo === acc.role;
                return (
                  <Button
                    key={acc.role}
                    type="button"
                    variant="outline"
                    className={`h-11 flex-col items-center justify-center gap-0.5 ${acc.className}`}
                    disabled={busy}
                    onClick={() => mutation.mutate({ email: acc.email, password: acc.password, role: acc.role })}
                    aria-label={`Masuk sebagai ${acc.role} (${acc.name})`}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <acc.icon className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="text-xs font-semibold leading-none">{acc.role}</span>
                    <span className="text-[10px] leading-none opacity-70">{acc.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Platform pribadi keluarga — akses tanpa izin dilarang.
          <br />
          © {new Date().getFullYear()} Z Family Office · Internal Use Only
        </p>
      </main>
    </div>
  );
}
