import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AuthGuard } from './components/auth/AuthGuard';
import LoginPage from './pages/auth/LoginPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import PostsPage from './pages/PostsPage';
import CreatePostPage from './pages/posts/CreatePostPage';
import MediaPage from './pages/MediaPage';
import CategoriesPage from './pages/CategoriesPage';
import CommentsPage from './pages/CommentsPage';
import FriendsPage from './pages/FriendsPage';
import SettingsPage from './pages/SettingsPage';
import AIToolsPage from './pages/AIToolsPage';
import { AiTestPage } from './pages/AiTestPage';
import MonitorPage from './pages/MonitorPage';
import FolderPermissionsPage from './pages/media/FolderPermissionsPage';
import AiConfigPage from './pages/ai-config/AiConfigPage';
import { Toaster } from 'sonner';

/**
 * @ref 媒体库深度优化方案 - Phase 5: 权限管理路由 Wrapper
 */
function FolderPermissionsWrapper() {
  const { folderId } = useParams<{ folderId: string }>();
  
  if (!folderId) {
    return <Navigate to="/media" replace />;
  }
  
  return (
    <FolderPermissionsPage 
      folderId={parseInt(folderId)} 
      folderName={`文件夹 ${folderId}`} 
    />
  );
}

function App() {
  // 使用 Vite 注入的 BASE_URL，开发环境为 '/'，生产环境为 '/admin/'
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  
  return (
    <BrowserRouter basename={basename === '/' ? undefined : basename}>
      <Toaster richColors position="top-center" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<AuthGuard><ChangePasswordPage /></AuthGuard>} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <AdminLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="posts" element={<PostsPage />} />
          <Route path="posts/new" element={<CreatePostPage />} />
          <Route path="posts/:id/edit" element={<CreatePostPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="media/folder/:folderId/permissions" element={<FolderPermissionsWrapper />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="comments" element={<CommentsPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="ai-tools" element={<AIToolsPage />} />
          <Route path="ai-test" element={<AiTestPage />} />
          <Route path="ai-config" element={<AiConfigPage />} />
          <Route path="monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
