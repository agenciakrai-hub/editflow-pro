import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Landing from '@/pages/Landing';
import ThankYou from '@/pages/ThankYou';
import AppLayout from '@/components/AppLayout';
import Seleccion from '@/pages/Seleccion';
import Subscription from '@/pages/Subscription';
import Admin from '@/pages/Admin';
import LightroomPage from '@/modules/lightroom/LightroomPage';
import Hub from '@/pages/Hub';
import MisProyectos from '@/pages/MisProyectos';
import NuevoProyectoPage from '@/modules/proyectos/NuevoProyectoPage';
import DetalleProyectoPage from '@/modules/proyectos/DetalleProyectoPage';
import AjustesIA from '@/pages/AjustesIA';
import PresetXMP from '@/pages/PresetXMP';
import AIProviders from '@/pages/AIProviders';
import Estilos from '@/pages/Estilos';
import Cerebro from '@/pages/Cerebro';
import HistorialTrabajos from '@/pages/HistorialTrabajos';
import AlbumApp from '@/modules/album/pages/AlbumApp';
import AlbumFileLauncher from '@/modules/album/format/AlbumFileLauncher';
import WorkflowV2Page from '@/modules/workflow-v2/WorkflowV2Page';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-secondary border-t-accent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // For auth_required (private app, no session) we must NOT redirect here:
  // that would reload the page and re-trigger the same error, looping forever
  // and preventing the login/register pages from ever rendering. The Routes
  // below already expose the auth pages publicly, and ProtectedRoute redirects
  // unauthenticated users from protected routes to /login.

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Landing />} />
      <Route path="/ThankYou" element={<ThankYou />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Seleccion />} />
          <Route path="/lightroom" element={<LightroomPage />} />
          <Route path="/herramientas" element={<Hub />} />
          <Route path="/proyectos" element={<MisProyectos />} />
          <Route path="/proyectos/nuevo" element={<NuevoProyectoPage />} />
          <Route path="/proyectos/:id" element={<DetalleProyectoPage />} />
          <Route path="/ajustes-ia" element={<AjustesIA />} />
          <Route path="/preset-xmp" element={<PresetXMP />} />
          <Route path="/proveedores-ia" element={<AIProviders />} />
          <Route path="/estilos" element={<Estilos />} />
          <Route path="/cerebro" element={<Cerebro />} />
          <Route path="/historial" element={<HistorialTrabajos />} />
          <Route path="/album" element={<AlbumApp />} />
          <Route path="/flujo-v2" element={<WorkflowV2Page />} />
          <Route path="/suscripcion" element={<Subscription />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AlbumFileLauncher />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
