import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

const KEY = "elitelineup_ref";

/**
 * Remembers ?ref=CODE from the URL, then applies it once the visitor is signed in.
 * Renders nothing. Storage failures are ignored on purpose (private browsing etc.).
 */
export function ReferralCapture() {
  const { user } = useAuth();

  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref");
      if (code && /^[A-Za-z0-9]{6,12}$/.test(code)) localStorage.setItem(KEY, code.toUpperCase());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!code) return;
    fetch("/api/referral/redeem", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .catch(() => undefined)
      .finally(() => {
        try {
          localStorage.removeItem(KEY);
        } catch {
          // ignore
        }
      });
  }, [user]);

  return null;
}
