// What an item is, in one place. The board, Home, the reader and the server's
// board covers all read kinds through this module, so the kind on a card, the
// legend's count and the kinds line under a board on Home can never disagree.
//
// kind   = the stored content kind (html, url, markdown, pdf, image, video, audio,
//          note, text, file), "board" for an item that owns a child board, and
//          "idea" for an item with no content yet.
// family = the material the theme draws for it: page, doc, pic, plain or board.
//          CSS reads both as data-kind and data-family on the element; the
//          family's side colour comes from --kind-<family>-side / -edge / -text.
//
// No DOM here (the server imports it too).

export const FAMILY = Object.freeze({
  html: "page", url: "page", app: "page",
  markdown: "doc", pdf: "doc", file: "doc",
  image: "pic", video: "pic", audio: "pic",
  note: "plain", text: "plain", idea: "plain",
  board: "board",
});
/** Legend and kinds-line order. */
export const FAMILIES = Object.freeze(["page", "doc", "pic", "plain", "board"]);
export const FAMILY_NAMES = Object.freeze({
  page: ["page", "pages"], doc: ["document", "documents"], pic: ["picture", "pictures"],
  plain: ["note", "notes"], board: ["board", "boards"],
});

/** The kind of a stored item. An item that owns a child board is a board, whatever else it holds. */
export function kindOf(item) {
  if (!item) return "idea";
  if (item.childBoardId) return "board";
  const kind = item.content?.kind;
  return typeof kind === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(kind) ? kind : "idea";
}
/** Unknown kinds draw as plain material rather than as nothing. */
export const familyOf = kind => FAMILY[kind] || "plain";

/** data-kind and data-family as markup, for template-built elements. Values are safe as written. */
export function kindAttributes(item) {
  const kind = kindOf(item);
  return `data-kind="${kind}" data-family="${familyOf(kind)}"`;
}
/** Sets (or, for null, clears) data-kind and data-family on a live element. */
export function markKind(element, item) {
  if (!element) return;
  if (item === null) { delete element.dataset.kind; delete element.dataset.family; return; }
  const kind = kindOf(item), family = familyOf(kind);
  if (element.dataset.kind !== kind) element.dataset.kind = kind;
  if (element.dataset.family !== family) element.dataset.family = family;
}

/** Per-family counts from a {kind: count} map or a list of kinds. */
export function familyCounts(kinds) {
  const counts = {};
  const add = (kind, n) => { const family = familyOf(kind); counts[family] = (counts[family] || 0) + n; };
  if (Array.isArray(kinds)) for (const kind of kinds) add(kind, 1);
  else for (const [kind, n] of Object.entries(kinds || {})) if (Number(n) > 0) add(kind, Number(n));
  return counts;
}
/** "1 page", "3 pictures". */
export const familyLabel = (family, n) => `${n} ${FAMILY_NAMES[family]?.[n === 1 ? 0 : 1] ?? "items"}`;
/** "Pages", the legend's name for a family. */
export const familyTitle = family => { const name = FAMILY_NAMES[family]?.[1] || family; return name[0].toUpperCase() + name.slice(1); };

/** The kinds line under a board on Home: one entry per family present, in legend order. */
export function kindsLine(kinds) {
  const counts = familyCounts(kinds);
  const parts = FAMILIES.filter(family => counts[family]).map(family =>
    `<span class="kinds-line-entry" data-family="${family}"><span class="kind-swatch" aria-hidden="true"></span>${familyLabel(family, counts[family])}</span>`);
  return parts.length ? `<span class="kinds-line">${parts.join("")}</span>` : "";
}
