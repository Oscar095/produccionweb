import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import {
  LayoutDashboard, GitBranch, ClipboardList,
  Wrench, FileText, LogOut, Users, PackageSearch,
} from 'lucide-react'

const NAV = [
  { to: '/dashboard',   label: 'Dashboard',    Icon: LayoutDashboard, roles: null },
  { to: '/orders',      label: 'Órdenes',       Icon: PackageSearch,   roles: null },
  { to: '/gantt',       label: 'Gantt',         Icon: GitBranch,       roles: null },
  { to: '/planning',    label: 'Planeación',    Icon: ClipboardList,   roles: null },
  { to: '/maintenance', label: 'Mantenimiento', Icon: Wrench,          roles: null },
  { to: '/reports',     label: 'Reportes',      Icon: FileText,        roles: null },
  { to: '/usuarios',    label: 'Usuarios',      Icon: Users,           roles: ['admin'] },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-blue-900 text-white flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-blue-800">
          <h1 className="text-lg font-bold leading-tight">KOS Xpress</h1>
          <p className="text-xs text-blue-300 mt-0.5">Planeación de Producción</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.filter(({ roles }) => !roles || roles.includes(user?.rol ?? '')).map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
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
        <div className="px-5 py-4 border-t border-blue-800">
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

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
