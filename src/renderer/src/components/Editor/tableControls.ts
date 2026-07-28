import { TextSelection, Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { TABLE_ACTIONS, type TableAction, type TableActionGroup } from './tableCommands'

// ── 图标（Feather 风格线条，16px）────────────────────────────────────────────
const svg = (inner: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const ICONS: Record<string, string> = {
  'row-before': svg(
    '<rect x="3" y="13" width="18" height="7" rx="1"/><path d="M12 4v5M9.5 6.5h5"/>'
  ),
  'row-after': svg(
    '<rect x="3" y="4" width="18" height="7" rx="1"/><path d="M12 15v5M9.5 17.5h5"/>'
  ),
  'col-before': svg(
    '<rect x="13" y="3" width="7" height="18" rx="1"/><path d="M4 12h5M6.5 9.5v5"/>'
  ),
  'col-after': svg(
    '<rect x="4" y="3" width="7" height="18" rx="1"/><path d="M15 12h5M17.5 9.5v5"/>'
  ),
  'align-left': svg('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  'align-center': svg('<path d="M4 6h16M7 12h10M5 18h14"/>'),
  'align-right': svg('<path d="M4 6h16M10 12h10M7 18h13"/>'),
  'move-row-up': svg('<path d="M12 20V4"/><polyline points="6 10 12 4 18 10"/>'),
  'move-row-down': svg('<path d="M12 4v16"/><polyline points="6 14 12 20 18 14"/>'),
  'move-col-left': svg('<path d="M20 12H4"/><polyline points="10 6 4 12 10 18"/>'),
  'move-col-right': svg('<path d="M4 12h16"/><polyline points="14 6 20 12 14 18"/>'),
  'del-row': svg('<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M9 12h6"/>'),
  'del-col': svg('<rect x="9" y="3" width="6" height="18" rx="1"/><path d="M12 9v6"/>'),
  'del-table': svg('<path d="M4 6h16M8 6V4h8v2M6 6l1 14h10l1-14"/>')
}

const GROUP_ORDER: TableActionGroup[] = ['insert', 'align', 'move', 'delete']

/** 从当前 selection 向上找到所在的 table 节点的 DOM（用于工具栏定位） */
function findSelectedTableDOM(view: EditorView): HTMLElement | null {
  const { $head } = view.state.selection
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === 'table') {
      const dom = view.nodeDOM($head.before(d))
      return dom instanceof HTMLElement ? dom : null
    }
  }
  return null
}

class TableControlsView {
  private readonly container: HTMLElement | null
  private readonly toolbar: HTMLElement
  private readonly actionButtons: { action: TableAction; btn: HTMLButtonElement }[] = []
  private menu: HTMLElement | null = null

  constructor(private view: EditorView) {
    this.container = view.dom.parentElement
    this.toolbar = this.buildToolbar()
    if (this.container) {
      this.container.appendChild(this.toolbar)
      this.container.addEventListener('scroll', this.onScroll)
      this.container.addEventListener('contextmenu', this.onContextMenu)
    }
    this.reposition()
  }

  // ── 工具栏 ────────────────────────────────────────────────────────────────
  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'lume-table-toolbar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', '表格操作')
    let prevGroup: TableActionGroup | null = null
    for (const action of TABLE_ACTIONS) {
      if (prevGroup && action.group !== prevGroup) {
        const sep = document.createElement('span')
        sep.className = 'lume-table-toolbar-sep'
        bar.appendChild(sep)
      }
      prevGroup = action.group
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'lume-table-btn'
      btn.title = action.label
      btn.setAttribute('aria-label', action.label)
      if (action.isActive) btn.setAttribute('aria-pressed', 'false')
      btn.innerHTML = ICONS[action.id] ?? action.label
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', () => this.run(action.command))
      bar.appendChild(btn)
      this.actionButtons.push({ action, btn })
    }
    return bar
  }

  private run(command: TableAction['command']): void {
    command(this.view.state, this.view.dispatch)
    this.view.focus()
    this.closeMenu()
  }

  private reposition(): void {
    const found = findSelectedTableDOM(this.view)
    if (!found || !this.container) {
      this.toolbar.style.display = 'none'
      return
    }
    for (const { action, btn } of this.actionButtons) {
      const active = action.isActive?.(this.view.state) ?? false
      btn.classList.toggle('is-active', active)
      if (action.isActive) btn.setAttribute('aria-pressed', String(active))
      const enabled = action.command(this.view.state)
      btn.disabled = !enabled
    }
    this.toolbar.style.display = 'flex'
    const c = this.container.getBoundingClientRect()
    const t = found.getBoundingClientRect()
    const top = t.top - c.top + this.container.scrollTop
    const left = t.left - c.left + this.container.scrollLeft
    this.toolbar.style.left = `${left}px`
    const above = top - this.toolbar.offsetHeight - 8
    this.toolbar.style.top = `${above < this.container.scrollTop ? top + 6 : above}px`
  }

  // ── 右键菜单 ──────────────────────────────────────────────────────────────
  private readonly onContextMenu = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null
    const cell = target?.closest('td, th')
    if (!cell || !this.view.dom.contains(cell)) return
    e.preventDefault()
    // 先把光标移到点击的单元格，命令才作用在正确的行列上
    const at = this.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (at) {
      const sel = TextSelection.near(this.view.state.doc.resolve(at.pos))
      this.view.dispatch(this.view.state.tr.setSelection(sel))
    }
    this.openMenu(e.clientX, e.clientY)
  }

  private openMenu(x: number, y: number): void {
    this.closeMenu()
    const menu = document.createElement('div')
    menu.className = 'lume-table-menu'
    menu.setAttribute('role', 'menu')
    let first = true
    for (const group of GROUP_ORDER) {
      const actions = TABLE_ACTIONS.filter((a) => a.group === group)
      if (!first) {
        const sep = document.createElement('div')
        sep.className = 'lume-table-menu-sep'
        sep.setAttribute('role', 'separator')
        menu.appendChild(sep)
      }
      first = false
      for (const action of actions) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'lume-table-menu-item'
        item.setAttribute('role', 'menuitem')
        const enabled = action.command(this.view.state)
        item.disabled = !enabled
        if (action.isActive?.(this.view.state)) item.classList.add('is-active')
        const icon = document.createElement('span')
        icon.className = 'lume-table-menu-icon'
        icon.innerHTML = ICONS[action.id] ?? ''
        const label = document.createElement('span')
        label.className = 'lume-table-menu-label'
        label.textContent = action.label
        item.append(icon, label)
        item.addEventListener('click', () => this.run(action.command))
        menu.appendChild(item)
      }
    }
    document.body.appendChild(menu)
    // 视口内收边
    const rect = menu.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top = `${Math.max(8, top)}px`
    this.menu = menu
    document.addEventListener('pointerdown', this.onDocPointerDown, true)
    document.addEventListener('keydown', this.onDocKeyDown, true)
  }

  private readonly onDocPointerDown = (e: PointerEvent): void => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu()
  }

  private readonly onDocKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.closeMenu()
  }

  private closeMenu(): void {
    if (!this.menu) return
    this.menu.remove()
    this.menu = null
    document.removeEventListener('pointerdown', this.onDocPointerDown, true)
    document.removeEventListener('keydown', this.onDocKeyDown, true)
  }

  // ── 滚动 ──────────────────────────────────────────────────────────────────
  private readonly onScroll = (): void => {
    this.reposition()
    this.closeMenu()
  }

  update(): void {
    this.reposition()
  }

  destroy(): void {
    this.closeMenu()
    this.toolbar.remove()
    if (this.container) {
      this.container.removeEventListener('scroll', this.onScroll)
      this.container.removeEventListener('contextmenu', this.onContextMenu)
    }
  }
}

export function tableControlsPlugin(): Plugin {
  return new Plugin({
    view: (editorView) => new TableControlsView(editorView)
  })
}
