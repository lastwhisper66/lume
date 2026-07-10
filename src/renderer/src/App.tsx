import { useCallback } from 'react'
import Editor from './components/Editor'

const SAMPLE = `# Lume

这是一个 **加粗**、*斜体*、\`行内代码\` 的段落。

> 引用块

- 列表项 A
- 列表项 B

1. 有序一
2. 有序二

\`\`\`js
console.log('hello')
\`\`\`
`

function App(): React.JSX.Element {
  const handleChange = useCallback((markdown: string) => {
    // 往返验证：编辑后在控制台观察序列化输出
    console.log('[serialize]\\n' + markdown)
  }, [])

  return (
    <div style={{ height: '100vh' }}>
      <Editor initialMarkdown={SAMPLE} onChange={handleChange} />
    </div>
  )
}

export default App
