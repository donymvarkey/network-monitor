"use client";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/use-me";

export function SecuritySettings() {
  const router = useRouter();
  const { me } = useMe();
  async function signOutAll() {
    if (!confirm("Sign out of NetWatch on every browser and device, including this one?")) return;
    await fetch("/api/v1/auth/logout?all=1", { method: "POST" });
    router.push("/login");
  }
  return (
    <section>
      <h2 className="mb-1 text-sm font-medium">Account and sessions</h2>
      <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
        <div className="flex-1">{me ? <>{me.email} <span className="font-mono text-xs text-muted-foreground">{me.role}</span></> : "…"}
          <div className="text-xs text-muted-foreground">Sessions end after the configured idle time or maximum age, or when you sign out everywhere.</div></div>
        <button onClick={signOutAll} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Sign out everywhere</button>
      </div>
    </section>
  );
}
