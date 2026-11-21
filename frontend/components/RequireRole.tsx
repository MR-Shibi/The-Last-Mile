"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Icon from "@/components/Icon";
import { logoutAndGoHome, ROLE_LABEL, useSession, type Role, type Session } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useHydrated } from "@/lib/stores";

/** UX-only guard (the API enforces RBAC server-side). Renders children with the session.
 * - Logged out → go to the login page (and come back here afterwards).
 * - Logged in with a different role → explain and offer Logout; never open a second login inside an active session
 *   (that used to bounce citizens between /helper and /login forever). */
export default function RequireRole({ roles, children }: { roles: Role[]; children: (s: Session) => React.ReactNode }) {
  const hydrated = useHydrated();
  const session = useSession();
  const router = useRouter();
  const { L } = useLang();
  const allowed = !!session && roles.includes(session.role);

  useEffect(() => {
    if (hydrated && !session) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <p className="p-6 text-center">…</p>;
  if (!allowed) {
    const need = roles.map((r) => L(ROLE_LABEL[r][0], ROLE_LABEL[r][1])).join(" / ");
    const mine = L(ROLE_LABEL[session.role][0], ROLE_LABEL[session.role][1]);
    return (
      <div data-testid="role-blocked" role="alert" className="panel-review mx-auto max-w-xl space-y-3 rounded-2xl p-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Icon name="lock" size={26} /> {L("This area is for another role", "یہ حصہ کسی اور کردار کے لیے ہے")}
        </h1>
        <p className="text-lg">
          {L(`This page is for: ${need}. You are logged in as ${mine}. Logout first to switch roles.`,
            `یہ صفحہ ${need} کے لیے ہے۔ آپ ${mine} کے طور پر لاگ ان ہیں۔ کردار بدلنے کے لیے پہلے لاگ آؤٹ کریں۔`)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary">
            <Icon name="home" size={20} /> {L("Go to Home", "ہوم پر جائیں")}
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void logoutAndGoHome()}
          >
            <Icon name="logout" size={20} /> {L("Logout", "لاگ آؤٹ")}
          </button>
        </div>
      </div>
    );
  }
  return <>{children(session)}</>;
}
