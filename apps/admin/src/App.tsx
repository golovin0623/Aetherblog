import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AuthGuard } from './components/auth/AuthGuard';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { FocusModeProvider } from './contexts/FocusModeContext';
import { AetherHubSkeleton } from './pages/aetherhub/AetherHubSkeleton';
import { Toaster } from 'sonner';

// 懒加载页面组件
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const CreatePostPage = lazy(() => import('./pages/posts/CreatePostPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const CreateNotePage = lazy(() => import('./pages/notes/CreateNotePage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const CommentsPage = lazy(() => import('./pages/CommentsPage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AIToolsPage = lazy(() => import('./pages/AIToolsPage'));
const AgentWorkflowsPage = lazy(() => import('./pages/agent-workflows/AgentWorkflowsPage'));
const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const SystemSecurityPage = lazy(() => import('./pages/security/SystemSecurityPage'));
const FolderPermissionsPage = lazy(() => import('./pages/media/FolderPermissionsPage'));
const AiConfigPage = lazy(() => import('./pages/ai-config/AiConfigPage'));
const GlobalPricingPage = lazy(() => import('./pages/global-pricing/GlobalPricingPage'));
const ActivitiesPage = lazy(() => import('./pages/activities/ActivitiesPage'));
const AccessControlPage = lazy(() => import('./pages/access/AccessControlPage'));
const SearchConfigPage = lazy(() => import('./pages/SearchConfigPage'));
const AnalyticsPage = lazy(() => import('./pages/analytics/AnalyticsPage'));
const CloudExplorerPage = lazy(() => import('./pages/storage/CloudExplorerPage'));
const AetherHubWorkspacePage = lazy(() => import('./pages/aetherhub/AetherHubWorkspacePage'));
const KnowledgeBasePage = lazy(() => import('./pages/knowledge/KnowledgeBasePage'));
const KnowledgeBaseDetailPage = lazy(() => import('./pages/knowledge/KnowledgeBaseDetailPage'));
const AtlasLayout = lazy(() => import('./pages/atlas/AtlasLayout'));
const AtlasPage = lazy(() => import('./pages/atlas/AtlasPage'));
const AtlasReadingsPage = lazy(() => import('./pages/atlas/ReadingsPage'));
const AtlasKnowledgePointsPage = lazy(() => import('./pages/atlas/KnowledgePointsPage'));
const AtlasMarkdownReaderPage = lazy(() => import('./pages/atlas/MarkdownReaderPage'));
const AtlasPDFReaderPage = lazy(() => import('./pages/atlas/PDFReaderPage'));
const AtlasWebReaderPage = lazy(() => import('./pages/atlas/WebReaderPage'));
const AtlasBlogPostReaderPage = lazy(() => import('./pages/atlas/BlogPostReaderPage'));
const AtlasTranscriptReaderPage = lazy(() => import('./pages/atlas/TranscriptReaderPage'));
const AtlasImageReaderPage = lazy(() => import('./pages/atlas/ImageReaderPage'));
const AtlasKnowledgePointPage = lazy(() => import('./pages/atlas/KnowledgePointPage'));
const AtlasGraphPage = lazy(() => import('./pages/atlas/AtlasGraphPage'));
const AtlasSuggestionsPage = lazy(() => import('./pages/atlas/SuggestionsPage'));
const AtlasSearchPage = lazy(() => import('./pages/atlas/AtlasSearchPage'));

// 命名导出需要特殊处理
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

function RouteSuspenseFallback() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/aetherhub') {
    return <AetherHubSkeleton />;
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

function App() {
  // 使用 Vite 注入的 BASE_URL，开发环境为 '/'，生产环境为 '/admin/'
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  
  return (
    <BrowserRouter basename={basename === '/' ? undefined : basename}>
      <Toaster richColors position="top-center" />
      <FocusModeProvider>
      <ErrorBoundary>
        <Suspense fallback={<RouteSuspenseFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={<AuthGuard><ChangePasswordPage /></AuthGuard>} />
            <Route path="/aetherhub" element={<AuthGuard><AetherHubWorkspacePage /></AuthGuard>} />
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
              <Route path="notes" element={<NotesPage />} />
              <Route path="notes/new" element={<CreateNotePage />} />
              <Route path="notes/:id/edit" element={<CreateNotePage />} />
              <Route path="posts/ai-writing/new" element={<AiWritingWorkspacePage />} />
              <Route path="posts/ai-writing/:id" element={<AiWritingWorkspacePage />} />
              <Route path="media" element={<MediaPage />} />
              <Route path="media/folder/:folderId/permissions" element={<FolderPermissionsWrapper />} />
              <Route path="storage/explorer" element={<CloudExplorerPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="comments" element={<CommentsPage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="ai-tools" element={<AIToolsPage />} />
              <Route path="agent-workflows" element={<AgentWorkflowsPage />} />
              <Route path="ai-test" element={<AiTestPage />} />
              <Route path="ai-config" element={<AiConfigPage />} />
              <Route path="ai-config/pricing" element={<GlobalPricingPage />} />
              <Route path="search-config" element={<SearchConfigPage />} />
              <Route path="intelligence/knowledge" element={<KnowledgeBasePage />} />
              <Route path="intelligence/knowledge/:slug" element={<KnowledgeBaseDetailPage />} />
              {/* 知识图集工作台：单一入口 + 内部 Tab（概览/读物/知识点/图谱/建议/搜索）。
                  ref: docs/pm/atlas-redesign.md §3.2 —— 收敛原本 5 个并列侧边栏项。 */}
              <Route path="atlas" element={<AtlasLayout />}>
                <Route index element={<AtlasPage />} />
                <Route path="readings" element={<AtlasReadingsPage />} />
                <Route path="kps" element={<AtlasKnowledgePointsPage />} />
                <Route path="graph" element={<AtlasGraphPage />} />
                <Route path="suggestions" element={<AtlasSuggestionsPage />} />
                <Route path="search" element={<AtlasSearchPage />} />
              </Route>
              {/* 沉浸式深页不挂 Tab 壳：Reader 与 KP 详情。 */}
              <Route path="atlas/reader/note/:noteId" element={<AtlasMarkdownReaderPage />} />
              <Route path="atlas/reader/pdf/:carrierId" element={<AtlasPDFReaderPage />} />
              <Route path="atlas/reader/web/:carrierId" element={<AtlasWebReaderPage />} />
              <Route path="atlas/reader/blog-post/:carrierId" element={<AtlasBlogPostReaderPage />} />
              <Route path="atlas/reader/transcript/:carrierId" element={<AtlasTranscriptReaderPage />} />
              <Route path="atlas/reader/image/:carrierId" element={<AtlasImageReaderPage />} />
              <Route path="atlas/kp/:id" element={<AtlasKnowledgePointPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="monitor" element={<MonitorPage />} />
              <Route path="activities" element={<ActivitiesPage />} />
              <Route path="access" element={<AccessControlPage />} />
              <Route path="security" element={<SystemSecurityPage />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
      </FocusModeProvider>
    </BrowserRouter>
  );
}

export default App;
