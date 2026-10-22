import { Paragraph } from '@tiptap/extension-paragraph'

export const MarkdownParagraph = Paragraph.extend({
  renderMarkdown: (node, helpers) => {
    const content = node.content ?? []
    return content.length ? helpers.renderChildren(content) : '&nbsp;'
  },
})
