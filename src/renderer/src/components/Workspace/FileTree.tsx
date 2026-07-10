import { useWorkspace } from '../../store/workspace'
import type { FileNode } from '../../../../preload/index'

function TreeNode({ node }: { node: FileNode }): React.JSX.Element {
  const openFile = useWorkspace((s) => s.openFile)
  if (node.isDir) {
    return (
      <div className="tree-dir">
        <div className="tree-dir-name">{node.name}</div>
        <div className="tree-children">
          {node.children?.map((c) => <TreeNode key={c.path} node={c} />)}
        </div>
      </div>
    )
  }
  return (
    <div className="tree-file" onClick={() => openFile(node.path)}>
      {node.name}
    </div>
  )
}

export function FileTree(): React.JSX.Element {
  const root = useWorkspace((s) => s.root)
  const tree = useWorkspace((s) => s.tree)
  const openFolder = useWorkspace((s) => s.openFolder)

  return (
    <div className="file-tree">
      <button className="open-folder-btn" onClick={openFolder}>
        打开文件夹
      </button>
      {root && <div className="workspace-root">{root.split(/[\\/]/).pop()}</div>}
      {tree.map((n) => <TreeNode key={n.path} node={n} />)}
    </div>
  )
}

export default FileTree
