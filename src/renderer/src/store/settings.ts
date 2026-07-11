import { create } from 'zustand'
import type { SettingsSnapshot, SpellcheckMode } from '../../../preload/index'

interface RendererSettingsStore {
  snapshot: SettingsSnapshot | null
  hydrated: boolean
  hydrate: () => Promise<void>
  setSidebarVisible: (visible: boolean) => Promise<void>
  setSpellcheckMode: (mode: SpellcheckMode, language?: string) => Promise<void>
  submitDetectedLanguage: (baseLanguage: string) => Promise<void>
}

let hydratePromise: Promise<void> | null = null
let disposeSettingsListener: (() => void) | null = null

export const useAppSettings = create<RendererSettingsStore>((set) => ({
  snapshot: null,
  hydrated: false,

  hydrate: () => {
    if (hydratePromise) return hydratePromise
    hydratePromise = window.api.settings
      .current()
      .then((snapshot) => {
        set({ snapshot, hydrated: true })
        if (!disposeSettingsListener) {
          disposeSettingsListener = window.api.settings.onChanged((next) => {
            set({ snapshot: next, hydrated: true })
          })
        }
      })
      .catch(() => {
        set({ hydrated: true })
        hydratePromise = null
      })
    return hydratePromise
  },

  setSidebarVisible: async (visible) => {
    const snapshot = await window.api.settings.setSidebarVisible(visible)
    set({ snapshot, hydrated: true })
  },

  setSpellcheckMode: async (mode, language) => {
    const snapshot = await window.api.settings.setSpellcheckMode(mode, language)
    set({ snapshot, hydrated: true })
  },

  submitDetectedLanguage: async (baseLanguage) => {
    const snapshot = await window.api.settings.submitDetectedLanguage(baseLanguage)
    set({ snapshot, hydrated: true })
  }
}))
