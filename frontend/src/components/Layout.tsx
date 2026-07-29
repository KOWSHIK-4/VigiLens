import { Outlet, Link, useLocation } from "react-router-dom";
import { authService } from "@/services/auth";

const navItems = [
  { path: "/", label: "Dashboard" },
  { path: "/cameras", label: "Cameras" },
  { path: "/detections", label: "Detections" },
  { path: "/analytics", label: "Analytics" },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="flex h-screen">
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-2xl font-bold tracking-tight">VigiLens</h1>
          <p className="text-sm text-gray-400 mt-1">Security Monitoring</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? "bg-brand-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <button
            onClick={() => authService.logout()}
            className="w-full px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
