/**
 * A release note (GitHub Markdown) as blocks to show: headings, list items, paragraphs and code lines. The note's
 * lines are wrapped by hand: the lines of a paragraph or a list item are joined. Emphasis and code marks are
 * dropped; links stay as their text.
 */
export function noteBlocks(markdown) {
  const blocks = []
  let current = null
  let inCode = false
  const close = () => {
    if (current) blocks.push(current)
    current = null
  }
  const clean = (text) =>
    text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .trim()

  for (const line of String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')) {
    if (line.trim().startsWith('```')) {
      close()
      inCode = !inCode
    } else if (inCode) {
      blocks.push({type: 'code', text: line})
    } else if (!line.trim()) {
      close()
    } else if (/^#{1,6}\s/.test(line)) {
      close()
      blocks.push({type: 'heading', text: clean(line.replace(/^#+\s*/, ''))})
    } else if (/^\s*[-*]\s+/.test(line)) {
      close()
      current = {type: 'item', text: clean(line.replace(/^\s*[-*]\s+/, ''))}
    } else if (current) {
      current.text = `${current.text} ${clean(line)}`
    } else {
      current = {type: 'text', text: clean(line)}
    }
  }
  close()
  return blocks
}
