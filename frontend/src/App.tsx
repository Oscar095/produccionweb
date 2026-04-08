import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Gantt from './pages/Gantt'
import Planning from './pages/Planning'
import Maintenance from './pages/Maintenance'
import Reports from './pages/Reports'
import Orders from './pages/Orders'
import Usuarios from './pages/Usuarios'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard"   element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/gantt"       element={<ProtectedRoute><Gantt /></ProtectedRoute>} />
          <Route path="/planning"    element={<ProtectedRoute><Planning /></ProtectedRoute>} />
          <Route path="/maintenance" element={<ProtectedRoute><Maintenance /></ProtectedRoute>} />
          <Route path="/reports"     element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/orders"      element={<ProtectedRoute><Orders /></ProtectedRoute>} />
          <Route path="/usuarios"    element={<ProtectedRoute><Usuarios /></ProtectedRoute>} />
          <Route path="*"            element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
