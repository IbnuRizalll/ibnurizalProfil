export interface StructuredTextParagraphSegment {
  type: 'paragraph'
  text: string
}

export interface StructuredTextLabelSegment {
  type: 'label'
  text: string
}

export interface StructuredTextListSegment {
  type: 'list'
  ordered: boolean
  items: string[]
}

export type StructuredTextSegment =
  | StructuredTextParagraphSegment
  | StructuredTextLabelSegment
  | StructuredTextListSegment

function normalizeLine(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseStructuredTextSegments(rawText: string): StructuredTextSegment[] {
  const lines = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')

  const segments: StructuredTextSegment[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let currentListOrdered = false

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const text = paragraphLines.map(normalizeLine).filter(Boolean).join(' ')
    paragraphLines = []
    if (!text) return
    segments.push({ type: 'paragraph', text })
  }

  const flushList = () => {
    if (listItems.length === 0) return
    segments.push({
      type: 'list',
      ordered: currentListOrdered,
      items: listItems.map(normalizeLine).filter(Boolean),
    })
    listItems = []
  }

  lines.forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      flushParagraph()
      flushList()
      return
    }

    const orderedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/)
    const unorderedMatch = trimmedLine.match(/^[-*�]\s+(.+)$/)

    if (orderedMatch || unorderedMatch) {
      flushParagraph()
      const ordered = Boolean(orderedMatch)
      const itemText = normalizeLine((orderedMatch || unorderedMatch)?.[1] || '')
      if (!itemText) return

      if (listItems.length > 0 && currentListOrdered !== ordered) {
        flushList()
      }

      currentListOrdered = ordered
      listItems.push(itemText)
      return
    }

    flushList()
    paragraphLines.push(trimmedLine)
  })

  flushParagraph()
  flushList()

  return segments.map((segment, index, allSegments) => {
    if (segment.type !== 'paragraph') return segment

    const nextSegment = allSegments[index + 1]
    const looksLikeLabel = nextSegment?.type === 'list' && !/[.!?:;]$/.test(segment.text) && segment.text.length <= 80

    return looksLikeLabel ? { type: 'label', text: segment.text } : segment
  })
}
