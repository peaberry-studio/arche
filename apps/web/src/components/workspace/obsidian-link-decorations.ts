import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  findObsidianLinks,
  getObsidianLinkDisplayLabel,
  getObsidianLinkFullPath,
} from "@/lib/kb-internal-links";

function selectionIntersectsLink(
  selectionFrom: number,
  selectionTo: number,
  linkFrom: number,
  linkTo: number
) {
  if (selectionFrom === selectionTo) {
    return selectionFrom > linkFrom && selectionFrom < linkTo;
  }

  return selectionFrom < linkTo && selectionTo > linkFrom;
}

export const ObsidianLinkDecorations = Extension.create({
  name: "obsidianLinkDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            const { from: selectionFrom, to: selectionTo } = state.selection;

            state.doc.descendants((node, pos) => {
              if (node.type.name === "codeBlock") {
                return false;
              }

              if (!node.isText || !node.text) return;
              if (node.marks.some((mark) => mark.type.name === "code")) return;

              const links = findObsidianLinks(node.text);
              for (const link of links) {
                const linkFrom = pos + link.from;
                const linkTo = pos + link.to;
                if (selectionIntersectsLink(selectionFrom, selectionTo, linkFrom, linkTo)) {
                  continue;
                }

                decorations.push(
                  Decoration.inline(linkFrom, linkTo, {
                    class: "kb-internal-link",
                    "data-link-from": String(linkFrom),
                    "data-link-label": getObsidianLinkDisplayLabel(link.target),
                    "data-link-path": getObsidianLinkFullPath(link.target),
                    "data-link-target": link.target,
                    "data-link-to": String(linkTo),
                  })
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
