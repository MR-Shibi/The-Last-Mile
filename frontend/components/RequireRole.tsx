"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession, type Role, type Session } from "@/lib/api";
import { useHydrated } from "@/lib/stores";

/** UX-only guard (the API enforces RBAC server-side). Renders children with the session. */
export default function RequireRole({ roles, children }: { roles: Role[]; children: (s: Session) => React.ReactNode }) {
  const hydrated = useHydrated();
  const session = useSession();
  const router = useRouter();
  const allowed = !!session && roles.includes(session.role);

  useEffect(() => {
    if (hydrated && !allowed) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [hydrated, allowed, router]);

  if (!hydrated || !allowed || !session) return <p className="p-6 text-center">…</p>;
  return <>{children(session)}</>;
}
