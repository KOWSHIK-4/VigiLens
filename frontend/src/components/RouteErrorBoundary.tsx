import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { getApiErrorMessage } from "@/utils/apiError";

export default function RouteErrorBoundary() {
  const error = useRouteError();

  useEffect(() => {
    console.error("Unhandled route error:", error);
  }, [error]);

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : getApiErrorMessage(error, "An unexpected error occurred.");

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="card max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
        <p className="text-sm text-gray-500 break-words">{message}</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => window.location.reload()}
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <Link to="/" className="btn-primary inline-flex items-center gap-1.5">
            <Home className="w-4 h-4" />
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}