import { Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ThemeManager } from './theme'

/** 依据当前主题状态构建并设置应用菜单（勾选态即时反映） */
export async function buildAppMenu(tm: ThemeManager): Promise<void> {
  const themes = await tm.listThemes()
  const state = tm.getState()

  const themeRadios: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.themeMode === 'manual' && state.manualTheme === name,
    click: () => {
      void tm.select(name)
    }
  }))

  const daySubmenu: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.dayTheme === name,
    click: () => {
      void tm.setMode({ dayTheme: name })
    }
  }))

  const nightSubmenu: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.nightTheme === name,
    click: () => {
      void tm.setMode({ nightTheme: name })
    }
  }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('menu:openFile')
          }
        },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('menu:openFolder')
          }
        }
      ]
    },
    {
      label: '主题',
      submenu: [
        {
          label: '跟随系统',
          type: 'checkbox',
          checked: state.themeMode === 'system',
          click: () => {
            void tm.setMode({ themeMode: state.themeMode === 'system' ? 'manual' : 'system' })
          }
        },
        { type: 'separator' },
        ...themeRadios,
        { type: 'separator' },
        { label: '日间主题', submenu: daySubmenu },
        { label: '夜间主题', submenu: nightSubmenu },
        { type: 'separator' },
        {
          label: '打开主题文件夹',
          click: () => {
            tm.openFolder()
          }
        },
        {
          label: '重新扫描主题',
          click: () => {
            tm.rescan()
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
