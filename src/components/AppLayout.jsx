import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Menu, Bell, X, Home, CreditCard, Users, LogOut, Sparkles, Plug, LayoutGrid, Wand2, FileImage, KeyRound } from "lucide-react";
import { base44 } from "@/api/base44Client";

const navItems = [
  { to: "/herramientas", label: "Herramientas", icon: LayoutGrid },
  { to: "/preset-xmp", label: "Preset XMP", icon: FileImage },
  { to: "/lightroom", label: "Lightroom", icon: Plug },
  { to: "/suscripcion", label: "Suscripción", icon: CreditCard },
  { to: "/admin", label: "Administración", icon: Users },
  { to: "/proveedores-ia", label: "Proveedores IA", icon: KeyRound },
];

function Logo() {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="14" height="26" viewBox="0 0 14 26" className="shrink-0">
        <path d="M14 0 A13 13 0 0 0 14 26 Z" fill="hsl(24 100% 50%)" />
      </svg>
      <span className="text-lg font-bold tracking-tight">EditKR</span>
    </div>
  );
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isFull = pathname === "/dashboard" || pathname === "/ajustes-ia" || pathname === "/preset-xmp";

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const initials = user?.full_name
    ? user.full_name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "U";

  const planLabel = user?.plan && user.plan !== "none" ? user.plan.toUpperCase() : "FREE";

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between h-16 px-4 max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <Logo />
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-1.5 hover:bg-secondary rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">8</span>
            </button>
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-semibold">
              {initials}
            </div>
          </div>
        </div>
      </header>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="relative w-72 max-w-[80vw] bg-card h-full shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <Logo />
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-secondary rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map(item => (
                <NavLink key={item.to} to={item.to} onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-accent text-white" : "hover:bg-secondary"}`}>
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-border space-y-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-xs font-semibold">Plan {planLabel}</span>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary w-full">
                <LogOut className="w-4 h-4" /> Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      <main className={isFull ? "w-full px-4 py-4 sm:px-6 sm:py-6" : "max-w-3xl mx-auto px-4 py-6"}>
        <Outlet />
      </main>
    </div>
  );
}