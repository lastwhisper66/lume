import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

declare global {
  interface Window {
    /** APIs exposed by Lume's context-isolated preload. */
    readonly electron: ElectronAPI
    readonly api: Api
  }
}
