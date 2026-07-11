/**
 * 主题注入器：把主进程推来的主题 CSS 注入到 <style id="lume-theme">。
 * 该 <style> 在源顺序上晚于 fallback/structure/editor，故能覆盖兜底变量。
 */
export function initTheme(): void {
  let styleEl = document.getElementById('lume-theme') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'lume-theme'
    document.head.appendChild(styleEl)
  }
  const apply = (p: { name: string; css: string }): void => {
    styleEl!.textContent = p.css
    requestAnimationFrame(() => {
      const styles = getComputedStyle(document.documentElement)
      const color =
        styles.getPropertyValue('--lume-bg-sidebar').trim() ||
        styles.getPropertyValue('--lume-bg').trim()
      const symbolColor = styles.getPropertyValue('--lume-text').trim()
      if (color && symbolColor) window.api.window.setTitleBarOverlay({ color, symbolColor })
    })
  }
  void window.api.theme.current().then(apply)
  window.api.theme.onApply(apply)
}
