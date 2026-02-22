import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface EditorStore {
    enableSelectionAi: boolean;
    enableSlashAi: boolean;

    setEnableSelectionAi: (enable: boolean) => void;
    setEnableSlashAi: (enable: boolean) => void;
}

export const useEditorStore = create<EditorStore>()(
    persist(
        (set) => ({
            enableSelectionAi: true,
            enableSlashAi: true,

            setEnableSelectionAi: (enableSelectionAi) => set({ enableSelectionAi }),
            setEnableSlashAi: (enableSlashAi) => set({ enableSlashAi }),
        }),
        {
            name: 'aetherblog-editor-preferences',
        }
    )
);
