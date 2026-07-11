const displayNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' })

export function displayLanguage(code: string | null): string {
  if (!code) return '尚未检测'
  try {
    return displayNames.of(code) ?? code
  } catch {
    return code
  }
}
