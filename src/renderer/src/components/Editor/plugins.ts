import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { columnResizing, tableEditing } from 'prosemirror-tables'
import type { Plugin } from 'prosemirror-state'
import { keymapBindings } from './commands'
import { buildInputRules } from './inputrules'
import { syntaxRevealPlugin, linkClickPlugin, linkNavPlugin } from './syntaxReveal'
import { headingRevealPlugin } from './nodeviews/headingSource'
import { horizontalRuleRevealPlugin } from './nodeviews/horizontalRuleSource'

export function buildPlugins(): Plugin[] {
  return [
    buildInputRules(),
    keymap(keymapBindings),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    columnResizing(),
    tableEditing(),
    history(),
    syntaxRevealPlugin,
    linkClickPlugin,
    linkNavPlugin(),
    headingRevealPlugin(),
    horizontalRuleRevealPlugin()
  ]
}
