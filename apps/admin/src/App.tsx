import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import DashboardPage from './pages/DashboardPage';
import PostsPage from './pages/PostsPage';
import MediaPage from './pages/MediaPage';
import CategoriesPage from './pages/CategoriesPage';
import CommentsPage from './pages/CommentsPage';
import FriendsPage from './pages/FriendsPage';
import SettingsPage from './pages/SettingsPage';
import AIToolsPage from './pages/AIToolsPage';
import MonitorPage from './pages/MonitorPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="posts" element={<PostsPage />} />
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

export default App;
