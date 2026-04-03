import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@aetherblog/hooks';
import App from './App';
import AdminFontProvider from './components/AdminFontProvider';
import AdminThemeColorProvider from './components/AdminThemeColorProvider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 分钟
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AdminThemeColorProvider>
          <AdminFontProvider>
            <App />
          </AdminFontProvider>
        </AdminThemeColorProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
