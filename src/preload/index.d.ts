import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

declare global {
  interface Window {
    readonly electron: ElectronAPI
    readonly api: Api
  }
}
