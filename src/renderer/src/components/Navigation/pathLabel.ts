/** 从文件/文件夹的绝对路径中取出用于展示的末段名称。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
