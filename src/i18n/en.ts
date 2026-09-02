/**
 * English — and, because `Messages` is derived from it, the shape every other
 * language has to satisfy.
 *
 * Two conventions make this catalogue carry its own guarantees:
 *
 *  - **Messages that take values are functions**, not templates with `{holes}`.
 *    There is no interpolation engine to write or debug, the compiler checks
 *    that every call site passes the right arguments, and a language whose
 *    grammar wants the number somewhere else can simply put it there.
 *  - **Messages with emphasis inside them return DOM**, not HTML strings.
 *    German and Ukrainian move the stressed word, so `<em>` cannot live in the
 *    markup around the message; and building nodes keeps this file out of
 *    `innerHTML`, which the rest of the app is careful about.
 *
 * `pluralise` deliberately spells out the categories rather than hiding a
 * `n === 1` check, because Ukrainian needs four of them.
 */

import { el, frag } from "../dom.js";
import { intlFor } from "./intl.js";

const f = intlFor("en");

export const en = {
  /* ------------------------------------------------------------- shell --- */

  meta: {
    /** Goes on `<html lang>`; also the locale `Intl` is asked for above. */
    lang: "en",
    title: "jsonapi-lens — follow the pointer",
    description:
      "Read a JSON:API document as the graph it actually is. Every relationship becomes a link you can click. Runs entirely in your browser.",
    documentTitle: (label: string) => `${label} — jsonapi-lens`,
  },

  language: {
    label: "Language",
    /** Titles the switcher; the option labels are each language's own name. */
    title: "Change language",
  },

  topbar: {
    brandTag: "follow the pointer",
    saved: "Saved",
    savedTitle: "Saved documents",
    savedTitleCount: (n: number) => `Saved documents (${f.n(n)})`,
    shortcuts: "Keyboard shortcuts",
    themeLabel: "Theme:",
    // The return type is annotated because a ternary over string literals
    // infers a literal union, which every other catalogue would then have to
    // match word for word.
    themeName: (theme: "auto" | "light" | "dark"): string =>
      theme === "auto" ? "auto" : theme === "light" ? "light" : "dark",
    themeTitle: (name: string) => `Theme: ${name}. Click to change.`,
    newDocument: "New",
    /** Appended on wide viewports, so the button reads "New document". */
    newDocumentRest: "\u00a0document",
    newDocumentTitle: "Start a new document",
  },

  boot: {
    reading: "Reading stored document",
    fetchingShare: "Fetching and decrypting the shared document",
  },

  footer: {
    tagline: "A JSON:API document viewer. Runs in your browser.",
    impressum: "Legal Notice (Impressum)",
    privacy: "Privacy",
    /** Reachable from every view, which is the point of putting it here. */
    sourceLabel: "Source",
  },

  /* -------------------------------------------------------- paste view --- */

  paste: {
    eyebrow: "JSON:API document viewer",
    title: () => frag("Follow the ", el("em", { text: "pointer" }), "."),
    lede: () =>
      frag(
        "JSON:API keeps related resources in a sibling ",
        el("code", { text: "included" }),
        " array, so following a relationship means hunting a UUID through the whole payload. Paste a document and every pointer becomes a link you can click — with real browser history, deep links and find-in-page.",
      ),
    dropLabel: () => frag("Paste a document, or drop a ", el("code", { text: ".json" }), " file"),
    characters: (n: number) => `${f.n(n)} ${f.plural(n, { one: "character", other: "characters" })}`,
    inputLabel: "JSON:API document",
    dropOverlay: "Drop to read",
    read: "Read document",
    openFile: "Open a file",
    readHint: (mod: string) =>
      frag(el("kbd", { text: mod }), " ", el("kbd", { text: "↵" }), " to read"),
    errorWhere: (line: number) => `around line ${f.n(line)}`,
  },

  resume: {
    stillOpen: (label: string) => frag("Still open: ", el("b", { text: label })),
    back: "Back to document",
  },

  samples: {
    label: "Or try",
    articles: "Article feed",
    single: "Single resource",
    dangling: "Missing include",
    errors: "Error response",
    edge: "Awkward ids",
    /** Filenames become the document label, so they are worth translating. */
    articlesFile: "articles.json",
    singleFile: "single-resource.json",
    danglingFile: "missing-include.json",
    errorsFile: "error-response.json",
    edgeFile: "awkward-ids.json",
  },

  legend: {
    resolves: () =>
      frag(
        el("b", { text: "A pointer that resolves" }),
        " is a link. Clicking it scrolls to that resource and adds a history entry, so Back returns you to where you were.",
      ),
    absent: () =>
      frag(
        el("b", { text: "A pointer that resolves to nothing" }),
        " says so. That distinction is usually the thing you are looking for — a missing ",
        el("code", { text: "include" }),
        " parameter, or a server that dropped something.",
      ),
    local: () =>
      frag(
        el("b", { text: "Nothing leaves your browser." }),
        " Parsing, indexing and rendering all happen on this page, and the document is stored in local IndexedDB so a reload keeps your deep links working. There is no server to send it to.",
      ),
    /** The demo chips carry real text, so they need translating too. */
    notInDocument: "not in document",
    localOnlyType: "local",
    localOnlyId: "only",
  },

  /*
   * The questions people arrive with.
   *
   * They are here because they are genuinely the first things anyone asks about
   * a tool you paste a production payload into — and, mirrored as `FAQPage`
   * structured data in `index.html`, they are also what a search engine or an
   * assistant quotes when somebody asks *it* instead of asking the page. The
   * mirror is checked by a test rather than trusted, because a third copy of
   * the same prose is a third place for it to drift.
   *
   * Answers return DOM for the same reason the rest of the catalogue does:
   * `data`, `included` and `include` are code when they appear in a sentence.
   */
  faq: {
    heading: "Questions",
    /** Sits under the heading; says why the answers are worth reading. */
    lede: "What people ask before pasting a payload into somebody else's tool.",
    items: [
      {
        q: "Does anything I paste leave my browser?",
        a: () =>
          frag(
            "No. Parsing, indexing and rendering all happen on this page, and the document is kept in your browser's IndexedDB. There is no upload step and no account. The one exception is opt-in: a share link is encrypted in your browser first, and the key travels in the link itself, so the server only ever stores ciphertext it cannot read.",
          ),
      },
      {
        q: "What is a JSON:API document?",
        a: () =>
          frag(
            "A response shaped by the JSON:API specification: a top-level ",
            el("code", { text: "data" }),
            " key holding resource objects, whose ",
            el("code", { text: "relationships" }),
            " are ",
            el("code", { text: "{type, id}" }),
            " pointers, and a sibling ",
            el("code", { text: "included" }),
            " array holding the resources those pointers name. Following one relationship by hand means searching the whole payload for a UUID.",
          ),
      },
      {
        q: "How do I follow a relationship?",
        a: () =>
          frag(
            "Click it. Every pointer that resolves is a real anchor to that resource on the same page, so Back and Forward, deep links, find-in-page and “copy link address” all behave the way they do everywhere else.",
          ),
      },
      {
        q: "What does “not in document” next to a pointer mean?",
        a: () =>
          frag(
            "The relationship names a resource that is in neither ",
            el("code", { text: "data" }),
            " nor ",
            el("code", { text: "included" }),
            ". Usually that is a missing ",
            el("code", { text: "include" }),
            " parameter in the request, or a server that dropped something — and telling that apart from a resource that is present is normally why you opened the payload.",
          ),
      },
      {
        q: "How large a document can it read?",
        a: () =>
          frag(
            "25.7 MB and 56,821 resources render in about 1.6 seconds in Chrome on Apple Silicon, and scroll smoothly afterwards. The binding constraint is DOM node count rather than payload size, so the practical ceiling is around 100,000 resources.",
          ),
      },
      {
        q: "Is there an API, a server or a sign-up?",
        a: () =>
          frag(
            "None of the three. It is a static page — markup, one JavaScript bundle and self-hosted fonts — with no analytics, no cookies and no third-party requests. The only server-side code in the project stores encrypted share blobs it cannot decrypt.",
          ),
      },
    ],
  },

  /* ------------------------------------------------- document overview --- */

  overview: {
    shape: "Shape",
    resources: "Resources",
    types: "Types",
    included: "Included",
    relationships: "Relationships",
    unresolvedPointers: (n: number) =>
      f.plural(n, { one: "Unresolved pointer", other: "Unresolved pointers" }),
    duplicateIdentities: "Duplicate identities",
    size: "Size",
    indexedIn: "Indexed in",

    shapeNull: "data: null",
    shapeErrors: (n: number) => `errors[${f.n(n)}]`,
    shapeIncludedOnly: "included only",
    shapeMetaOnly: "meta only",
    shapeSingle: "data{1}",
    shapeMany: (n: number) => `data[${f.n(n)}]`,

    nullNote:
      "Primary data is explicitly null. That is a valid response for a to-one relationship that relates to nothing — not an error.",
    emptyNote: "This document carries no resources. Only its top-level members are shown below.",
    lazyNote: (n: number) =>
      `Large document: all ${f.n(n)} resources are on the page and every anchor resolves, but attribute detail is built when you expand a resource. Find-in-page reaches every summary row, including off-screen ones — to search inside attributes, expand the resources first.`,

    shareLink: "Share link",
    shareLinkTitle: "Create an encrypted share link",
    save: "Save",
    saveTitle: "Keep this document in this browser",
    export: "Export",
    exportTitle: "Download the document as a file",
    raw: "Raw",
    rawTitle: "Show the whole document as raw JSON",
    copy: "Copy",
    copyTitle: "Copy the whole document",

    stats: (resources: number, types: number, size: string) =>
      `${f.n(resources)} ${f.plural(resources, { one: "resource", other: "resources" })} · ${f.n(types)} ${f.plural(types, { one: "type", other: "types" })} · ${size}`,
  },

  /** Digit grouping in the active language, for counts built outside a message. */
  num: (value: number) => f.n(value),

  /* ------------------------------------------------------------- rail --- */

  rail: {
    ariaLabel: "Document contents",
    narrow: "Narrow this list",
    narrowLabel: "Narrow the type list",
    inPrimary: "In primary data",
    jumpTo: (type: string) => `Jump to ${type}`,
    only: "only",
    showOnly: (type: string) => `Show only ${type}`,
    showAllTypes: "Show all types",
    types: "Types",
  },

  /* ----------------------------------------------------------- groups --- */

  group: {
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    tooManyRows: (n: number) => `${f.n(n)} ${f.plural(n, { one: "row", other: "rows" })}`,
    tooManyRowsTitle: "Too many rows to expand at once",
  },

  /* --------------------------------------------------- dangling / errors -- */

  dangling: {
    title: "Unresolved pointers",
    distinct: (n: number) =>
      `${f.n(n)} distinct ${f.plural(n, { one: "pointer resolves", other: "pointers resolve" })} to nothing in this document`,
    total: (n: number) => `${f.n(n)} total`,
    note: "These are referenced by relationships but were not sent in data or included. Usually that means the request was missing an include parameter — or the server dropped something it should have sent.",
  },

  errors: {
    title: "Errors",
    fallbackTitle: (position: number) => `Error ${f.n(position)}`,
    pointer: "pointer",
    parameter: "parameter",
  },

  topLevel: {
    summary: "Top-level members",
  },

  primary: {
    title: "Primary data",
    more: (n: number) => `+ ${f.n(n)} more in the sections below`,
  },

  /* -------------------------------------------------------- resources --- */

  resource: {
    primaryTag: "primary",
    primaryTagTitle: "Part of the document's primary data",
    relTag: (n: number) => `${f.n(n)} rel`,
    relTagTitle: (n: number) =>
      `${f.n(n)} ${f.plural(n, { one: "relationship", other: "relationships" })}`,
    unresolvedTag: (n: number) => `${f.n(n)} unresolved`,
    unresolvedTagTitle: (n: number) =>
      `${f.n(n)} ${f.plural(n, { one: "pointer", other: "pointers" })} on this resource resolve to nothing in this document`,
    duplicatedTag: "duplicated",
    duplicatedTagTitle:
      "This type/id appeared more than once in the document; the occurrences were merged",
    noSummaryAttribute: "no summary attribute",
    noAttributes: "no attributes",
    notInDocument: "not in document",
    absentChipTitle: (type: string, id: string) =>
      `No resource with type "${type}" and id "${id}" appears in this document`,
    showMore: (n: number) => `Show ${f.n(n)} more`,
  },

  relationships: {
    title: "Relationships",
    empty: "No relationships.",
    toOne: "to-one",
    toMany: (n: number) => `to-many · ${f.n(n)}`,
    toOneNull: "to-one · null",
    noLinkage: "no linkage",
    nullNote: "Linkage is explicitly null — related to nothing.",
    noLinkageNote:
      "No linkage data. The server did not say what this relates to; fetch the related link to find out.",
  },

  referencedBy: {
    title: "Referenced by",
    tooMany: "This document has too many pointers to index in reverse.",
    none: "Nothing in this document points at this resource.",
    inbound: (n: number) => `${f.n(n)} inbound`,
  },

  /* ------------------------------------------------------------ values --- */

  value: {
    emptyArray: "empty array",
    emptyObject: "empty object",
    items: (n: number) => `${f.n(n)} ${f.plural(n, { one: "item", other: "items" })}`,
    keys: (n: number) => `${f.n(n)} ${f.plural(n, { one: "key", other: "keys" })}`,
    copyPointerTitle: "Copy JSON Pointer to this value",
    copyPointerLabel: "path",
    copyValueTitle: "Copy this value",
    copyValueLabel: "value",
    pointerTitle: "JSON Pointer to this block",
  },

  /**
   * Block headings, each with the sentence shown when the block is empty.
   * They travel together because "No attributes." cannot be built from
   * "Attributes" in a language with cases.
   */
  block: {
    attributes: { title: "Attributes", empty: "No attributes." },
    meta: { title: "Meta", empty: "No meta." },
    links: { title: "Links", empty: "No links." },
    jsonapi: { title: "jsonapi", empty: "No jsonapi members." },
  },

  /* ------------------------------------------------------------ panels --- */

  raw: {
    copyJson: "Copy JSON",
    download: "Download",
    wholeDocument: "whole document",
  },

  library: {
    title: "Saved documents",
    countInBrowser: (n: number) => `${f.n(n)} in this browser`,
    storedLocally: "Stored locally in this browser",
    emptyTitle: "Nothing saved yet.",
    emptyHint:
      "Open a document and choose Save to keep it here. Saved documents stay in this browser — they are never uploaded.",
    open: (label: string) => `Open ${label}`,
    rename: "rename",
    renameTitle: "Rename",
    renameLabel: (label: string) => `Rename ${label}`,
    renamePrompt: "New name for this document",
    renamed: (label: string) => `Renamed to ${label}`,
    renameFailed: "Could not rename that document.",
    delete: "delete",
    deleteTitle: "Delete",
    deleteLabel: (label: string) => `Delete ${label}`,
    deleteConfirm: (label: string) => `Delete "${label}" from your saved documents?`,
    deleted: (label: string) => `Deleted ${label}`,
    deleteFailed: "Could not delete that document.",
    resources: (n: number) => `${f.n(n)} ${f.plural(n, { one: "resource", other: "resources" })}`,
    types: (n: number) => `${f.n(n)} ${f.plural(n, { one: "type", other: "types" })}`,
    justNow: "just now",
    minutesAgo: (n: number) => `${f.n(n)} min ago`,
    hoursAgo: (n: number) => `${f.n(n)} h ago`,
    daysAgo: (n: number) => `${f.n(n)} d ago`,
    savedOn: (epochMs: number) => f.date(epochMs),
  },

  save: {
    title: "Save this document",
    subtitle: "Kept in this browser only",
    nameLabel: "Name",
    save: "Save",
    hint: "Saved documents live in this browser's IndexedDB. Clearing site data removes them.",
    done: (label: string) => `Saved "${label}" to this browser`,
    failed: "Could not save to this browser's storage.",
  },

  shortcuts: {
    title: "Keyboard shortcuts",
    or: "or",
    showList: "Show this list",
    find: "Find a resource by type or id",
    saveDocument: "Save the document to this browser",
    rawDocument: "Show the whole document as raw JSON",
    exportDocument: "Export the document to a file",
    openLibrary: "Open saved documents",
    leaveDocument: "Leave the document and go back to the paste view",
    closeDialog: "Close a dialog",
    readPasted: "Read the pasted document",

    /*
     * The second section of the dialog: the browser's own history keys. Their
     * spelling comes from `platform.ts` — ⌘ and Alt are symbols, not words —
     * but everything said *about* them is copy, so it lives here.
     */
    inThisApp: "In this app",
    fromBrowser: (apple: boolean): string =>
      apple ? "From your browser — Mac keys" : "From your browser",
    browserBack: "Back — to the resource you came from",
    browserForward: "Forward — back down the chain you retraced",
    browserNewTab: "Open a relationship in a new tab",
    historyNote:
      "This app pushes a real history entry for every relationship you follow, so Back and Forward move through the document itself — returning you to the exact resource and scroll position you left. They are your browser's keys, not this app's.",
    pointerNote: (apple: boolean): string =>
      apple
        ? "A two-finger swipe left or right on the trackpad does the same thing, as do your mouse's side buttons."
        : "Your mouse's side buttons do the same thing, as does swiping left or right on a trackpad.",
    otherPlatformNote: (apple: boolean): string =>
      apple
        ? "On Windows and Linux the same two are Alt + ← and Alt + →."
        : "On a Mac the same two are ⌘ + [ and ⌘ + ] (or ⌘ + ← and ⌘ + →).",
  },

  jump: {
    title: "Go to a resource",
    subtitle: (n: number) =>
      `${f.n(n)} ${f.plural(n, { one: "resource", other: "resources" })} in this document`,
    placeholder: "type or id — e.g. people 0098, or art-8f21",
    label: "Find a resource by type or id",
    noMatch: "No resource matches that.",
    capped: (max: number) => `First ${f.n(max)} matches — keep typing to narrow`,
    matches: (n: number) => `${f.n(n)} ${f.plural(n, { one: "match", other: "matches" })}`,
  },

  modal: {
    close: "Close",
  },

  /* ------------------------------------------------------------- share --- */

  share: {
    title: "Share this document",
    unsupported:
      "This browser cannot encrypt a share link (needs WebCrypto and CompressionStream).",
    lede: "The document is gzipped and encrypted in this tab. The key is generated here and lives only in the link — the server stores an opaque blob it cannot read. Creating and opening a link each take a moment, because the short key is deliberately expensive to derive.",
    lifetimeLabel: "Link lifetime",
    note: "Anyone with the link can read the document, so treat it like the payload itself. The key sits in the URL path, so it reaches browser history and anything else that handles the link — send it the way you would send the payload.",
    create: "Create link",
    deriving: "Deriving the key and encrypting…",
    uploading: (size: string) => `Uploading ${size}…`,
    linkLabel: "Link",
    linkFieldLabel: "Share link",
    copyLink: "Copy link",
    neverExpires: "This link does not expire. It stays until you ask for it to go.",
    expiresOn: (epochMs: number) => `This link stops working on ${f.dateTime(epochMs)}.`,
    sizes: (encrypted: string, original: string) =>
      `Encrypted size ${encrypted}, from ${original} of JSON.`,
    lifetimes: {
      "15m": "15 minutes",
      "6h": "6 hours",
      "1d": "1 day",
      "1w": "1 week",
      "1m": "1 month",
      forever: "No expiry",
    },
    opened: "Opened a shared document. It is now stored in this browser.",
  },

  /* ------------------------------------------------------------ toasts --- */

  toast: {
    copied: (what: string, preview: string) => `Copied ${what}: ${preview}`,
    copiedLarge: (what: string, chars: number) => `Copied ${what} (${f.n(chars)} characters)`,
    copyFailed: (what: string) => `Could not copy ${what}. Your browser blocked clipboard access.`,
    downloading: (filename: string) => `Downloading ${filename}`,
    noResource: (type: string, id: string) => `No ${type} with id ${id} in this document.`,
    filterCleared: (type: string) => `Showing all types so ${type} could be reached.`,
    pointerGone: (pointer: string) => `Nothing resolves at ${pointer} any more.`,
    notStored: "This document could not be stored, so a reload will lose it.",
    noPage: (pathname: string) => `No page at ${pathname}.`,
    noDocument: "No document is loaded. Paste one to get started.",
  },

  /** What the clipboard toasts call the thing being copied. */
  copyKinds: {
    json: "JSON",
    document: "document",
    value: "value",
    pointer: "JSON Pointer",
    deepLink: "deep link",
    shareLink: "share link",
    resource: (type: string, id: string) => `${type} ${id}`,
  },

  /* ------------------------------------------------------- parse errors --- */

  parseErrors: {
    empty: {
      headline: "Nothing to parse.",
      hint: "Paste a JSON:API document into the box above.",
    },
    nothingYet: {
      headline: "Nothing to read yet.",
      hint: "Paste a JSON:API document, or drop a file.",
    },
    pythonDict: {
      headline: "That looks like a Python dict, not JSON.",
      hint: "Single-quoted keys and `None`/`True` are not valid JSON. Re-dump it with `json.dumps(...)`.",
    },
    notJsonStart: {
      headline: "That does not start like JSON.",
      hint: "A JSON:API document starts with `{`. If you copied a log line, trim the prefix before the first `{`.",
    },
    invalidJson: {
      headline: "That is not valid JSON.",
      hint: (detail: string) => `The parser stopped here: ${detail}`,
    },
    bareArray: {
      headline: "This is a bare JSON array, not a JSON:API document.",
      hint: 'A JSON:API document is an object with a top-level `data` key. Wrap the array: `{ "data": [...] }`.',
    },
    doubleEncoded: {
      headline: "This is a JSON string containing JSON.",
      hint: "The payload has been encoded twice. Unwrap the outer string, then paste the inner document.",
    },
    wrongType: {
      headline: (what: string) => `This is a JSON ${what}, not a JSON:API document.`,
      hint: "Paste the whole response body — an object with a top-level `data`, `errors` or `meta` key.",
    },
    notJsonApi: {
      headline: "This is valid JSON, but not a JSON:API document.",
      hintKeys: (preview: string, more: boolean) =>
        `It has no \`data\`, \`errors\` or \`meta\` at the top level — only ${preview}${more ? ", …" : ""}. If the document is nested inside one of those, paste that part.`,
      hintEmpty:
        "The object is empty. A JSON:API document needs at least one of `data`, `errors` or `meta`.",
    },
    dataAndErrors: {
      headline: "This document has both `data` and `errors`.",
      hint: "The spec forbids that combination. Showing it anyway would misrepresent the response — check which one the server actually meant to send.",
    },
    unknown: {
      headline: "Something went wrong reading that document.",
    },
    fileUnreadable: {
      headline: "That file could not be read.",
      hint: "Try opening it and pasting the contents.",
    },
  },

  /* ------------------------------------------------------- share errors --- */

  shareErrors: {
    createFailed: {
      headline: "The share could not be created.",
      serverStatus: (status: number) => `The server returned ${status}.`,
    },
    fetchFailed: {
      headline: "That shared document could not be fetched.",
      network: "The network request failed. Check your connection and try again.",
    },
    gone: {
      headline: "That shared document no longer exists.",
      hint: "It was either never created, or it has already been deleted.",
    },
    expired: {
      headline: "That share link has expired.",
      hint: "Share links are deleted when their lifetime runs out. Ask for a fresh link.",
    },
    corruptShort: {
      headline: "That shared document is corrupt.",
      hint: "The stored data is too short to be a valid document.",
    },
    wrongVersion: {
      headline: "That share link was made by a different version.",
      hint: (found: number, expected: number) =>
        `It uses format version ${f.n(found)}, and this build reads version ${f.n(expected)}. Ask for a fresh link.`,
    },
    undecryptable: {
      headline: "That share link could not be decrypted.",
      hint: "The key does not match this document. If the link was shortened, wrapped by a chat client, or retyped, the key is probably wrong.",
    },
    corruptDeflate: {
      headline: "That shared document is corrupt.",
      hint: "It decrypted, but the contents could not be decompressed.",
    },
    corruptPayload: {
      headline: "That shared document is corrupt.",
      hint: "It decrypted, but does not contain a document.",
    },
  },

  /*
   * ------------------------------------------------------------ bundle ---
   * Everything T5 adds, under one new top-level key. `secretLength` is not
   * only about bundles — it fires from plain single-document sealing too,
   * whenever a caller (T7's MCP server, say) supplies a secret outside
   * `[MIN_SECRET_CHARS, MAX_SECRET_CHARS]` — but it lives here anyway so this
   * diff cannot collide with T1's own new top-level keys in this same file.
   */

  bundle: {
    errors: {
      secretLength: {
        headline: "That secret is not a usable length.",
        hint: (length: number, min: number, max: number) =>
          `It is ${f.n(length)} characters. A share secret must be between ${f.n(min)} and ${f.n(max)} characters.`,
      },
      empty: {
        headline: "A bundle needs at least one document.",
        hint: "Select at least one document to share.",
      },
      emptyDocument: {
        headline: "An empty document cannot be shared.",
        hint: (label: string) => `"${label}" has no content.`,
      },
      tooLarge: {
        headline: "This bundle is too large to share.",
        hint: (limit: string, overBy: string, offenders: string) =>
          `Encrypted, it is ${overBy} over the ${limit} limit. Largest: ${offenders}. Remove one and try again.`,
      },
      corrupt: {
        headline: "That shared bundle is corrupt.",
        hint: "It decrypted, but does not contain a bundle.",
      },
      unavailable: {
        headline: "This share link contains several documents.",
        hint: "This version of jsonapi-lens has no bundle view yet, so nothing here can display it. Ask for a single-document link instead, or try again later.",
      },
    },
  },

  /* ------------------------------------------------------------ labels --- */

  labels: {
    pastedDocument: "pasted document",
    storedDocument: "stored document",
    sharedDocument: (id: number) => `shared document ${f.n(id)}`,
  },
};

/**
 * The contract for every other language.
 *
 * Derived from `en` without `as const`, so each entry widens to `string` or to
 * its function signature rather than to a literal — which is what lets `de` and
 * `uk` be assigned to it. A missing key, a renamed key or a function that takes
 * the wrong arguments is a compile error, so a locale cannot silently fall out
 * of date with the app.
 */
export type Messages = typeof en;
