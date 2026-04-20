import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import {
  LayoutDashboard, GitBranch, ClipboardList,
  Wrench, FileText, LogOut, Users, PackageSearch,
  Menu, X, ChevronUp, ChevronDown, Settings,
} from 'lucide-react'
import PlanningLogo from './PlanningLogo'

const NAV = [
  { to: '/dashboard',      label: 'Dashboard',               Icon: LayoutDashboard, modulo: 'dashboard' },
  { to: '/gantt',          label: 'Gantt',                   Icon: GitBranch,       modulo: 'gantt' },
  { to: '/orders',         label: 'Registros de Producción', Icon: PackageSearch,   modulo: 'ordenes' },
  { to: '/maintenance',    label: 'Mantenimiento',           Icon: Wrench,          modulo: 'mantenimiento' },
  { to: '/planning',       label: 'Planeación',              Icon: PlanningLogo,    modulo: 'planeacion' },
  { to: '/reports',        label: 'Reportes',                Icon: FileText,        modulo: 'reportes' },
  { to: '/usuarios',       label: 'Usuarios',                Icon: Users,           modulo: 'usuarios' },
  { to: '/configuracion',  label: 'Configuración',           Icon: Settings,        modulo: 'configuracion' },
]

function getInitialBanner(): boolean {
  try {
    return localStorage.getItem('kos-banner-visible') !== '0'
  } catch {
    return true
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [bannerVisible, setBannerVisible] = useState<boolean>(getInitialBanner)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const toggleBanner = () => {
    setBannerVisible(prev => {
      const next = !prev
      try {
        localStorage.setItem('kos-banner-visible', next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  const handleNavClick = () => {
    setMobileOpen(false)
  }

  const sidebarContent = (
    <aside className="w-56 bg-blue-900 text-white flex flex-col h-full">
      {/* Banner + toggle */}
      <div className="border-b border-blue-800">
        {bannerVisible && (
          <div className="px-5 pt-6 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-blue-200">
                <PlanningLogo size={20} />
              </div>
              <h1 className="text-lg font-bold leading-tight">Planeación KOS</h1>
            </div>
            <p className="text-xs text-blue-300 mt-0.5">Planeación de Producción</p>
          </div>
        )}
        <button
          onClick={toggleBanner}
          className="w-full flex items-center justify-center py-1.5 text-blue-400 hover:text-white hover:bg-blue-800 transition"
          aria-label={bannerVisible ? 'Ocultar banner' : 'Mostrar banner'}
        >
          {bannerVisible
            ? <ChevronUp size={14} />
            : <ChevronDown size={14} />
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.filter(({ modulo }) => user?.permisos?.[modulo]?.ver ?? false).map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition
              ${isActive
                ? 'bg-blue-700 text-white'
                : 'text-blue-200 hover:bg-blue-800 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-blue-800 shrink-0">
        <p className="text-xs text-blue-300 truncate">{user?.nombre}</p>
        <p className="text-xs text-blue-400 capitalize">{user?.rol}</p>
        <button
          onClick={handleLogout}
          className="mt-3 flex items-center gap-2 text-xs text-blue-300 hover:text-white transition"
        >
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — always visible on md+ */}
      <div className="hidden md:flex shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div className="relative z-50 flex">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Right side: mobile top-bar + main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top-bar — only visible below md */}
        <header className="flex md:hidden items-center justify-between px-4 py-3 bg-blue-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-blue-200">
              <PlanningLogo size={18} />
            </div>
            <span className="text-sm font-bold">Planeación KOS</span>
          </div>
          <button
            onClick={() => setMobileOpen(prev => !prev)}
            className="p-1.5 rounded-lg hover:bg-blue-800 transition"
            aria-label="Abrir menú"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  )
}
