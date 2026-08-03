import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { authService } from "@/services/auth";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuth((s) => s.setUser);
  const setLoading = useAuth((s) => s.setLoading);

  useEffect(() => {
    if (!authService.isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    authService
      .me()
      .then((user) => setUser(user))
      .catch(() => {
        authService.logout();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [setUser, setLoading]);

  return <>{children}</>;
}
