import { Suspense, lazy, useEffect } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
  useParams,
} from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AuthGuard } from './components/auth/AuthGuard';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AetherHubKeepAliveHost } from './components/aetherhub/AetherHubKeepAliveHost';
import { useAetherHubPresenceStore } from './stores/aetherHubPresenceStore';
import { FocusModeProvider } from './contexts/FocusModeContext';
import { AetherHubSkeleton } from './pages/aetherhub/AetherHubSkeleton';
import { Toaster } from 'sonner';
import { INTELLIGENCE_ROUTES } from './navigation/intelligenceNavigation';

// 懒加载页面组件
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const CreatePostPage = lazy(() => import('./pages/posts/CreatePostPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const CreateNotePage = lazy(() => import('./pages/notes/CreateNotePage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const MusicPage = lazy(() => import('./pages/MusicPage'));
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
const KnowledgeBasePage = lazy(() => import('./pages/knowledge/KnowledgeBasePage'));
const KnowledgeBaseDetailPage = lazy(() => import('./pages/knowledge/KnowledgeBaseDetailPage'));
const KnowledgeWorkspacePage = lazy(() => import('./pages/intelligence/KnowledgeWorkspacePage'));
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

// 试卷拆题 QA Document Workflow
// ref: docs/features/qa-document-workflow.md §7
const QaDocumentsPage = lazy(() => import('./pages/qa/QaDocumentsPage'));
const QaDocumentDetailPage = lazy(() => import('./pages/qa/QaDocumentDetailPage'));
const QaProofreadPage = lazy(() => import('./pages/qa/QaProofreadPage'));
const QaDiffReviewPage = lazy(() => import('./pages/qa/QaDiffReviewPage'));

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

/**
 * /aetherhub 的路由占位：灵境本体由 AetherHubKeepAliveHost 保活渲染，这里只
 * 保留 AuthGuard 的鉴权与重定向语义，不再挂第二份页面实例。
 *
 * 同时它是保活宿主的**挂载许可**来源：本组件渲染在 AuthGuard 内部，能跑到这
 * 里就意味着 `/auth/me` 已校验通过。宿主不能自己看 authStore 的
 * `isAuthenticated`（persist 的布尔值，令牌过期后在校验返回前仍为 true）。
 */
function AetherHubRouteAnchor() {
  const markAuthorized = useAetherHubPresenceStore((state) => state.markAuthorized);
  const clearAuthorized = useAetherHubPresenceStore((state) => state.clearAuthorized);
  useEffect(() => {
    markAuthorized();
    // 离开路由即撤销：授权必须每次访问重新取得。留着不撤，用户在别的页面待到
    // cookie 过期后再回来，保活树会赶在新一轮 /auth/me 校验返回前直接显形。
    return () => clearAuthorized();
  }, [markAuthorized, clearAuthorized]);
  return null;
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

function AppProviders() {
  const location = useLocation();
  return (
    <>
      <Toaster richColors position="top-center" />
      <FocusModeProvider>
        {/* resetKey=pathname：边界一旦 latch 就再也不渲染子树，Outlet 里的
            AetherHubRouteAnchor 因此发不出许可 —— 从浮岛点回灵境只会停在骨架屏，
            而那张 fixed inset-0 的骨架还盖住了兜底页的「重新加载」。让导航本身
            复位错误态即可自救。 */}
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
        {/* 灵境保活宿主 —— 单实例常驻，路由在 /aetherhub 时铺满视口，离开时收成
            右下角胶囊浮岛。放在 Outlet 之后是为了叠在业务页之上，但**必须在路由
            ErrorBoundary 之外**：目标路由渲染抛错或 lazy chunk 加载失败时，那个
            边界会把它的全部子节点换成兜底 UI —— 连带卸载保活树、掐断在途生成、
            丢掉草稿与选中来源，恰好发生在导航失败、最需要它还在的时候。宿主内部
            自带一层 ErrorBoundary 兜工作台自身的错误。 */}
        <AetherHubKeepAliveHost />
      </FocusModeProvider>
    </>
  );
}

// Data Router is required for route-level blockers. Keep the existing route
// tree and basename semantics while allowing editors to protect dirty drafts
// from links, programmatic navigation, and browser history POP actions.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppProviders />}>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<AuthGuard><ChangePasswordPage /></AuthGuard>} />
      <Route path="/aetherhub" element={<AuthGuard><AetherHubRouteAnchor /></AuthGuard>} />
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
        <Route path="music" element={<MusicPage />} />
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
        <Route path={INTELLIGENCE_ROUTES.workspace.slice(1)} element={<KnowledgeWorkspacePage />} />
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
        {/* 试卷拆题 QA Document Workflow — ref: docs/features/qa-document-workflow.md §7 */}
        <Route path="qa" element={<QaDocumentsPage />} />
        <Route path="qa/:id" element={<QaDocumentDetailPage />} />
        <Route path="qa/:id/proofread" element={<QaProofreadPage />} />
        <Route path="qa/:id/diff/:diffId" element={<QaDiffReviewPage />} />
      </Route>
    </Route>
  ),
  { basename: basename === '/' ? undefined : basename }
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
