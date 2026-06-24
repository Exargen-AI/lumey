import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  darkMode: boolean;
  activeModal: string | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
}

// Default to dark — matches Obsidian's "default dark" identity. Users who
// explicitly toggle to light keep that choice via localStorage.
const getInitialDarkMode = () => {
  const stored = localStorage.getItem('darkMode');
  if (stored !== null) return stored === 'true';
  return true;
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  darkMode: getInitialDarkMode(),
  activeModal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode;
    localStorage.setItem('darkMode', String(next));
    return { darkMode: next };
  }),
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),
}));
