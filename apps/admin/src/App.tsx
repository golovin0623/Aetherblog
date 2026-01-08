import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import LoginPage from './pages/auth/LoginPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import { useAuthStore } from './stores';
import DashboardPage from './pages/DashboardPage';
import PostsPage from './pages/PostsPage';
import CreatePostPage from './pages/posts/CreatePostPage';
import MediaPage from './pages/MediaPage';
import CategoriesPage from './pages/CategoriesPage';
import CommentsPage from './pages/CommentsPage';
import FriendsPage from './pages/FriendsPage';
import SettingsPage from './pages/SettingsPage';
import AIToolsPage from './pages/AIToolsPage';
import MonitorPage from './pages/MonitorPage';
import { Toaster } from 'sonner';

function App() {
  // 使用 Vite 注入的 BASE_URL，开发环境为 '/'，生产环境为 '/admin/'
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  
  return (
    <BrowserRouter basename={basename === '/' ? undefined : basename}>
      <Toaster richColors position="top-center" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="posts/new" element={<CreatePostPage />} />
          <Route path="posts/:id/edit" element={<CreatePostPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="comments" element={<CommentsPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="ai-tools" element={<AIToolsPage />} />
          <Route path="monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default App;
