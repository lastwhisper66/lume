// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import { buildPlugins } from '../plugins'
import { ImageView } from './image'

interface ImageEditor {
  view: EditorView
  imageView: ImageView
}

function createImageEditor(source: string): ImageEditor {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  let imageView: ImageView | undefined
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: parse(source), plugins: buildPlugins() }),
    nodeViews: {
      image: (node, editorView, getPos) => {
        imageView = new ImageView(node, editorView, getPos)
        return imageView
      }
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  if (!imageView) throw new Error('Image NodeView was not created')
  return { view, imageView }
}

function openImageSource(view: EditorView): HTMLInputElement {
  const image = view.dom.querySelector<HTMLImageElement>('.lume-image img')
  if (!image) throw new Error('Rendered image not found')
  image.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const input = view.dom.querySelector<HTMLInputElement>('.lume-image-src')
  if (!input) throw new Error('Image source input not found')
  return input
}

function inputSource(input: HTMLInputElement, source: string): void {
  input.value = source
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
}

describe('ImageView integration', () => {
  const views: EditorView[] = []

  afterEach(() => {
    for (const view of views) view.destroy()
    document.body.replaceChildren()
  })

  function createView(source: string): ImageEditor {
    const editor = createImageEditor(source)
    views.push(editor.view)
    return editor
  }

  it('immediately serializes live input without replacing the active field', () => {
    const { view } = createView('![alt](old.png)')
    const input = openImageSource(view)

    inputSource(input, 'new.png')

    expect(serialize(view.state.doc).trimEnd()).toBe('![alt](new.png)')
    expect(view.dom.querySelector('.lume-image-src')).toBe(input)
    expect(document.activeElement).toBe(input)
  })

  it('uses Enter only to exit the single-line URL field', () => {
    const { view } = createView('![alt](old.png)')
    const input = openImageSource(view)
    inputSource(input, 'new.png')

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.lume-image-src')).toBeNull()
    expect(view.dom.querySelector<HTMLImageElement>('.lume-image img')?.src).toContain('/new.png')
    expect(serialize(view.state.doc).trimEnd()).toBe('![alt](new.png)')
    expect(view.state.doc.childCount).toBe(1)
  })

  it('exits and restores the image when the URL field blurs', () => {
    const { view, imageView } = createView('![alt](old.png)')
    const input = openImageSource(view)

    input.dispatchEvent(new FocusEvent('blur'))

    expect(view.dom.querySelector('.lume-image-src')).toBeNull()
    expect(view.dom.querySelector('.lume-image img')).toBeInstanceOf(HTMLImageElement)
    const formerInputEvent = new InputEvent('input')
    Object.defineProperty(formerInputEvent, 'target', { value: input })
    expect(imageView.stopEvent(formerInputEvent)).toBe(false)
  })

  it('keeps the input mounted and synchronizes external source changes while editing', () => {
    const { view } = createView('![alt](old.png)')
    const input = openImageSource(view)
    const pos = 1

    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...view.state.doc.nodeAt(pos)?.attrs,
        src: 'external.png'
      })
    )

    expect(view.dom.querySelector('.lume-image-src')).toBe(input)
    expect(input.value).toBe('external.png')
  })

  it('renders current alt and title attributes after editing, including title removal', () => {
    const { view } = createView('![old alt](old.png "old title")')
    const pos = 1

    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        src: 'next.png',
        alt: 'next alt',
        title: null
      })
    )

    const image = view.dom.querySelector<HTMLImageElement>('.lume-image img')
    expect(image?.getAttribute('src')).toBe('next.png')
    expect(image?.alt).toBe('next alt')
    expect(image?.hasAttribute('title')).toBe(false)
  })

  it('only stops events originating from its active input', () => {
    const { view, imageView } = createView('![alt](old.png)')
    expect(imageView.stopEvent(new MouseEvent('click'))).toBe(false)

    const input = openImageSource(view)
    const inputEvent = new InputEvent('input', { bubbles: true })
    Object.defineProperty(inputEvent, 'target', { value: input })
    const otherInputEvent = new InputEvent('input', { bubbles: true })
    Object.defineProperty(otherInputEvent, 'target', { value: document.createElement('input') })

    expect(imageView.stopEvent(inputEvent)).toBe(true)
    expect(imageView.stopEvent(otherInputEvent)).toBe(false)
  })
})
