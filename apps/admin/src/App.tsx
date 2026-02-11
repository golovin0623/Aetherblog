import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AuthGuard } from './components/auth/AuthGuard';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { Toaster } from 'sonner';

// Lazy load pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const CreatePostPage = lazy(() => import('./pages/posts/CreatePostPage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const CommentsPage = lazy(() => import('./pages/CommentsPage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AIToolsPage = lazy(() => import('./pages/AIToolsPage'));
const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const FolderPermissionsPage = lazy(() => import('./pages/media/FolderPermissionsPage'));
const AiConfigPage = lazy(() => import('./pages/ai-config/AiConfigPage'));
const ActivitiesPage = lazy(() => import('./pages/activities/ActivitiesPage'));
const AnalyticsPage = lazy(() => import('./pages/analytics/AnalyticsPage'));

// Named exports need special handling
const AiTestPage = lazy(() => import('./pages/AiTestPage').then(module => ({ default: module.AiTestPage })));
const AiWritingWorkspacePage = lazy(() => import('./pages/posts/AiWritingWorkspacePage').then(module => ({ default: module.AiWritingWorkspacePage })));

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
      <Suspense fallback={
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }>
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
            <Route path="posts/ai-writing/new" element={<AiWritingWorkspacePage />} />
            <Route path="posts/ai-writing/:id" element={<AiWritingWorkspacePage />} />
            <Route path="media" element={<MediaPage />} />
            <Route path="media/folder/:folderId/permissions" element={<FolderPermissionsWrapper />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="comments" element={<CommentsPage />} />
            <Route path="friends" element={<FriendsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ai-tools" element={<AIToolsPage />} />
            <Route path="ai-test" element={<AiTestPage />} />
            <Route path="ai-config" element={<AiConfigPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="monitor" element={<MonitorPage />} />
            <Route path="activities" element={<ActivitiesPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
