import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsStore {
  siteName: string;
  siteDescription: string;
  siteUrl: string;

  setSiteName: (name: string) => void;
  setSiteDescription: (desc: string) => void;
  setSiteUrl: (url: string) => void;
  updateSettings: (settings: Partial<SettingsStore>) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      siteName: 'AetherBlog',
      siteDescription: '智能博客系统',
      siteUrl: '',

      setSiteName: (siteName) => set({ siteName }),
      setSiteDescription: (siteDescription) => set({ siteDescription }),
      setSiteUrl: (siteUrl) => set({ siteUrl }),
      updateSettings: (settings) => set(settings),
    }),
    {
      name: 'aetherblog-settings',
    }
  )
);
