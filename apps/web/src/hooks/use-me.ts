"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";

export interface Me { id: string; email: string; name: string | null; role: "ADMIN" | "VIEWER" }
/** Role for hiding admin-only controls. The server enforces permissions regardless. */
export function useMe() {
  const q = useQuery({ queryKey: ["me"], queryFn: async () => (await api<Me>("/auth/me")).data, staleTime: 60_000 });
  return { me: q.data ?? null, isAdmin: q.data?.role === "ADMIN" };
}
