import { describe, expect, it } from 'vitest'
import { schema } from './schema/gfm'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import {
  addHeadingPrefixes,
  documentBodyText,
  headingBodyText,
  headingPrefix,
  headingPrefixLength,
  parseAtxHeading,
  stripHeadingPrefixes
} from './headingSource'

describe('heading source helpers', () => {
  it.each([
    ['# Title', { level: 1, prefixLength: 2, body: 'Title' }],
    ['###### Title #2', { level: 6, prefixLength: 7, body: 'Title #2' }],
    ['#NoSpace', null],
    ['####### Title', null]
  ])('parses %j', (source, expected) => {
    expect(parseAtxHeading(source)).toEqual(expected)
  })

  it('creates clamped prefixes and reads heading bodies', () => {
    expect(headingPrefix(0)).toBe('# ')
    expect(headingPrefix(3)).toBe('### ')
    expect(headingPrefix(7)).toBe('###### ')

    const heading = schema.nodes.heading.create({ level: 3 }, schema.text('### Title'))
    const paragraph = schema.nodes.paragraph.create(null, schema.text('# Paragraph'))
    expect(headingPrefixLength(heading)).toBe(4)
    expect(headingBodyText(heading)).toBe('Title')
    expect(headingPrefixLength(paragraph)).toBe(0)
    expect(headingBodyText(paragraph)).toBe('# Paragraph')
  })

  it('adds and strips prefixes recursively without mutating source documents', () => {
    const markedBody = schema.text('Title', [schema.marks.strong.create()])
    const plainHeading = schema.nodes.heading.create({ level: 2 }, markedBody)
    const plainDoc = schema.node('doc', null, [schema.nodes.blockquote.create(null, plainHeading)])
    const editableDoc = addHeadingPrefixes(plainDoc)
    const cleanDoc = stripHeadingPrefixes(editableDoc)
    const editableHeading = editableDoc.firstChild?.firstChild
    const cleanHeading = cleanDoc.firstChild?.firstChild

    expect(plainDoc.firstChild?.firstChild?.textContent).toBe('Title')
    expect(editableHeading?.textContent).toBe('## Title')
    expect(editableHeading?.firstChild?.marks).toHaveLength(0)
    expect(editableHeading?.lastChild?.marks).toEqual(markedBody.marks)
    expect(cleanHeading?.textContent).toBe('Title')
    expect(cleanHeading?.firstChild?.marks).toEqual(markedBody.marks)
  })

  it('recognizes internal prefixes only when their level matches the heading', () => {
    const bodyStartsWithMarker = schema.nodes.heading.create(
      { level: 2 },
      schema.text('# Existing')
    )
    const cleanDoc = schema.node('doc', null, [bodyStartsWithMarker])
    const editableDoc = addHeadingPrefixes(cleanDoc)
    const matchingPrefix = editableDoc.firstChild

    expect(editableDoc.firstChild?.textContent).toBe('## # Existing')
    expect(headingPrefixLength(bodyStartsWithMarker)).toBe(0)
    expect(headingBodyText(bodyStartsWithMarker)).toBe('# Existing')
    expect(stripHeadingPrefixes(cleanDoc).firstChild?.textContent).toBe('# Existing')
    expect(headingPrefixLength(matchingPrefix!)).toBe(3)
    expect(headingBodyText(matchingPrefix!)).toBe('# Existing')
    expect(stripHeadingPrefixes(editableDoc).firstChild?.textContent).toBe('# Existing')
  })

  it('returns body-only document text', () => {
    const doc = parse('# Heading\n\nParagraph')
    expect(documentBodyText(doc, '\n')).toBe('Heading\nParagraph')
    expect(documentBodyText(undefined, '\n')).toBe('')
  })
})

describe('heading Markdown boundary', () => {
  it.each(['# One', '### Three', '###### Six #2'])('round-trips %j once', (source) => {
    const doc = parse(source)
    expect(doc.firstChild?.textContent).toBe(source)
    expect(serialize(doc).trimEnd()).toBe(source)
  })

  it('preserves a body that starts with a different ATX marker', () => {
    const source = '## # Existing'
    const doc = parse(source)

    expect(doc.firstChild?.textContent).toBe('## # Existing')
    expect(serialize(doc).trimEnd()).toBe(source)
  })
})
