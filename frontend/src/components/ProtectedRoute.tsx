import { Navigate, useLocation } from "react-router-dom";
import { authService } from "@/services/auth";
import { useAuth } from "@/hooks/useAuth";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const isLoading = useAuth((s) => s.isLoading);
  const location = useLocation();

  if (!authService.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (
    user?.mustChangePassword &&
    !location.pathname.startsWith("/change-password")
  ) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
