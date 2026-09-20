import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/utils/apiError";

export default function LoginPage() {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = isRegister
        ? await authService.register(name, email, password)
        : await authService.login(email, password);
      navigate(res.user.mustChangePassword ? "/change-password" : "/");
    } catch (err) {
      setError(getApiErrorMessage(err, "Invalid credentials. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">VigiLens</h1>
          <p className="text-gray-500 mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div role="alert" className="p-3 text-sm text-red-800 bg-red-100 rounded-lg">
              {error}
            </div>
          )}

          {isRegister && (
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="register-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                required
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
              minLength={8}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn-primary w-full"
          >
            {loading ? "Loading..." : isRegister ? "Create Account" : "Sign In"}
          </button>

          <p className="text-center text-sm text-gray-500">
            {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className="text-brand-600 hover:underline"
            >
              {isRegister ? "Sign in" : "Register"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
