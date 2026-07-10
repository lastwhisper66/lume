import {
  EditorView as CMView,
  keymap as cmKeymap,
  drawSelection,
  type ViewUpdate
} from '@codemirror/view'
import { EditorState as CMState, Compartment } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { TextSelection, Selection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export class CodeBlockView {
  dom: HTMLElement
  cm: CMView
  private updating = false
  private langCompartment = new Compartment()

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.cm = new CMView({
      state: CMState.create({
        doc: this.node.textContent,
        extensions: [
          cmKeymap.of([...this.codeMirrorKeymap(), ...defaultKeymap, indentWithTab]),
          drawSelection(),
          syntaxHighlighting(defaultHighlightStyle),
          this.langCompartment.of([]),
          CMView.updateListener.of((u) => this.forwardUpdate(u))
        ]
      })
    })
    this.dom = this.cm.dom
    this.dom.classList.add('cm-code-block')
    void this.loadLanguage(this.node.attrs.params as string)
  }

  private async loadLanguage(info: string): Promise<void> {
    const name = (info || '').trim().split(/\s+/)[0]
    if (!name) return
    const desc = LanguageDescription.matchLanguageName(languages, name, true)
    if (!desc) return
    const support = await desc.load()
    this.cm.dispatch({ effects: this.langCompartment.reconfigure(support) })
  }

  private forwardUpdate(update: ViewUpdate): void {
    if (this.updating || !this.cm.hasFocus) return
    const pos = this.getPos()
    if (pos === undefined) return
    let offset = pos + 1
    const { main } = update.state.selection
    const selFrom = offset + main.from
    const selTo = offset + main.to
    const pmSel = this.view.state.selection
    if (update.docChanged || pmSel.from !== selFrom || pmSel.to !== selTo) {
      const tr = this.view.state.tr
      update.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
        if (text.length)
          tr.replaceWith(offset + fromA, offset + toA, this.view.state.schema.text(text.toString()))
        else tr.delete(offset + fromA, offset + toA)
        offset += toA - fromA // 近似修正
      })
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo))
      this.view.dispatch(tr)
    }
  }

  private codeMirrorKeymap(): Array<{ key: string; run: () => boolean }> {
    const view = this.view
    return [
      { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
      { key: 'ArrowLeft', run: () => this.maybeEscape('char', -1) },
      { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
      { key: 'ArrowRight', run: () => this.maybeEscape('char', 1) },
      {
        key: 'Backspace',
        run: () => {
          const { state } = this.cm
          if (state.doc.length !== 0) return false
          const pos = this.getPos()
          if (pos === undefined) return true
          const tr = view.state.tr.delete(pos, pos + this.node.nodeSize)
          tr.setSelection(Selection.near(tr.doc.resolve(Math.max(0, pos - 1))))
          view.dispatch(tr)
          view.focus()
          return true
        }
      },
      { key: 'Mod-z', run: () => undo(view.state, view.dispatch) || true },
      { key: 'Mod-y', run: () => redo(view.state, view.dispatch) || true },
      { key: 'Shift-Mod-z', run: () => redo(view.state, view.dispatch) || true },
      {
        key: 'Mod-Enter',
        run: () => {
          if (!exitCode(view.state, view.dispatch)) return false
          view.focus()
          return true
        }
      }
    ]
  }

  private maybeEscape(unit: 'line' | 'char', dir: -1 | 1): boolean {
    const { state } = this.cm
    const { main } = state.selection
    if (!main.empty) return false
    if (unit === 'line') {
      const line = state.doc.lineAt(main.head)
      if (dir < 0 ? line.number !== 1 : line.number !== state.doc.lines) return false
    } else {
      if (dir < 0 ? main.head !== 0 : main.head !== state.doc.length) return false
    }
    const pos = this.getPos()
    if (pos === undefined) return true
    const targetPos = pos + (dir < 0 ? 0 : this.node.nodeSize)
    const selection = Selection.near(this.view.state.doc.resolve(targetPos), dir)
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
    return true
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.updating) return true
    const newText = node.textContent
    const curText = this.cm.state.doc.toString()
    if (newText !== curText) {
      this.updating = true
      this.cm.dispatch({ changes: { from: 0, to: curText.length, insert: newText } })
      this.updating = false
    }
    return true
  }

  setSelection(anchor: number, head: number): void {
    this.cm.focus()
    this.updating = true
    this.cm.dispatch({ selection: { anchor, head } })
    this.updating = false
  }

  selectNode(): void {
    this.cm.focus()
  }

  stopEvent(): boolean {
    return true
  }

  destroy(): void {
    this.cm.destroy()
  }
}
