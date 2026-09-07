import { useEffect } from "react";
import axios from "axios";
import { useAuth } from "@/hooks/useAuth";
import { authService } from "@/services/auth";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuth((s) => s.setUser);
  const setLoading = useAuth((s) => s.setLoading);

  useEffect(() => {
    let active = true;

    if (!authService.isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    authService
      .me()
      .then((user) => {
        if (active) setUser(user);
      })
      .catch((err) => {
        // Only tear down the session when the token is genuinely invalid or
        // expired (401) or the account is disabled/locked (403) — both of
        // which /auth/me returns to stop an unusable session from lingering.
        // A transient network/server error must not force out a user who still
        // holds a valid token; the 401 interceptor handles the redirect case.
        const status = axios.isAxiosError(err)
          ? err.response?.status
          : undefined;
        if (active && (status === 401 || status === 403)) {
          authService.logout();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [setUser, setLoading]);

  return <>{children}</>;
}
