"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
    const json = (await res.json()) as { ok: boolean; error?: { message: string } };
    setBusy(false);
    if (json.ok) router.push("/"); else setError(json.error?.message ?? "Sign in failed");
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-semibold">Sign in to NetWatch</h1>
        <input name="email" type="email" required placeholder="Email" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        <input name="password" type="password" required placeholder="Password" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
