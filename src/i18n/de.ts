/**
 * Deutsch.
 *
 * Typed as `Messages`, so a key that `en` has and this file does not — or a
 * function whose arguments have drifted — is a compile error rather than an
 * `undefined` on the page.
 *
 * Zwei Übersetzungsentscheidungen, die bewusst so sind: JSON:API-Begriffe
 * (`data`, `included`, `to-one`, Pointer) bleiben englisch, weil sie in der
 * Spezifikation und im Payload genau so heißen und eine Eindeutschung die
 * Suche danach kaputtmachen würde. Die Oberfläche drumherum ist Deutsch.
 */

import { el, frag } from "../dom.js";
import { intlFor } from "./intl.js";
import type { Messages } from "./en.js";

const f = intlFor("de");

export const de: Messages = {
  meta: {
    lang: "de",
    title: "jsonapi-lens — dem Pointer folgen",
    description:
      "Ein JSON:API-Dokument als den Graphen lesen, der es ist. Jede Beziehung wird zu einem Link, den Sie anklicken können. Läuft vollständig in Ihrem Browser.",
    documentTitle: (label) => `${label} — jsonapi-lens`,
  },

  language: {
    label: "Sprache",
    title: "Sprache wechseln",
  },

  topbar: {
    brandTag: "dem Pointer folgen",
    saved: "Gespeichert",
    savedTitle: "Gespeicherte Dokumente",
    savedTitleCount: (n) => `Gespeicherte Dokumente (${f.n(n)})`,
    shortcuts: "Tastaturkürzel",
    themeLabel: "Design:",
    themeName: (theme) =>
      theme === "auto" ? "automatisch" : theme === "light" ? "hell" : "dunkel",
    themeTitle: (name) => `Design: ${name}. Zum Wechseln klicken.`,
    newDocument: "Neues",
    newDocumentRest: " Dokument",
    newDocumentTitle: "Ein neues Dokument beginnen",
  },

  boot: {
    reading: "Gespeichertes Dokument wird gelesen",
    fetchingShare: "Geteiltes Dokument wird geladen und entschlüsselt",
  },

  footer: {
    tagline: "Ein Viewer für JSON:API-Dokumente. Läuft in Ihrem Browser.",
    impressum: "Impressum",
    privacy: "Datenschutz",
    sourceLabel: "Quellcode",
  },

  paste: {
    eyebrow: "Viewer für JSON:API-Dokumente",
    title: () => frag("Dem ", el("em", { text: "Pointer" }), " folgen."),
    lede: () =>
      frag(
        "JSON:API legt verwandte Ressourcen in ein benachbartes ",
        el("code", { text: "included" }),
        "-Array. Einer Beziehung zu folgen heißt deshalb, eine UUID im ganzen Payload zu suchen. Fügen Sie ein Dokument ein, und jeder Pointer wird zu einem Link — mit echter Browser-Historie, Deep Links und Seitensuche.",
      ),
    dropLabel: () =>
      frag("Dokument einfügen oder eine ", el("code", { text: ".json" }), "-Datei ablegen"),
    characters: (n) => `${f.n(n)} ${f.plural(n, { one: "Zeichen", other: "Zeichen" })}`,
    inputLabel: "JSON:API-Dokument",
    dropOverlay: "Zum Lesen ablegen",
    read: "Dokument lesen",
    openFile: "Datei öffnen",
    readHint: (mod) => frag(el("kbd", { text: mod }), " ", el("kbd", { text: "↵" }), " zum Lesen"),
    errorWhere: (line) => `etwa in Zeile ${f.n(line)}`,
  },

  resume: {
    stillOpen: (label) => frag("Noch geöffnet: ", el("b", { text: label })),
    back: "Zurück zum Dokument",
  },

  samples: {
    label: "Oder ausprobieren",
    articles: "Artikel-Feed",
    single: "Einzelne Ressource",
    dangling: "Fehlendes include",
    errors: "Fehlerantwort",
    edge: "Sperrige IDs",
    articlesFile: "artikel.json",
    singleFile: "einzelne-ressource.json",
    danglingFile: "fehlendes-include.json",
    errorsFile: "fehlerantwort.json",
    edgeFile: "sperrige-ids.json",
  },

  legend: {
    resolves: () =>
      frag(
        el("b", { text: "Ein Pointer, der aufgeht," }),
        " ist ein Link. Ein Klick springt zu dieser Ressource und legt einen Historieneintrag an — „Zurück“ bringt Sie also dorthin, wo Sie waren.",
      ),
    absent: () =>
      frag(
        el("b", { text: "Ein Pointer, der ins Leere zeigt," }),
        " sagt das auch. Genau dieser Unterschied ist meist das, was Sie suchen — ein fehlender ",
        el("code", { text: "include" }),
        "-Parameter oder ein Server, der etwas weggelassen hat.",
      ),
    local: () =>
      frag(
        el("b", { text: "Nichts verlässt Ihren Browser." }),
        " Lesen, Indizieren und Darstellen passieren auf dieser Seite, und das Dokument liegt in der lokalen IndexedDB — ein Neuladen erhält also Ihre Deep Links. Es gibt keinen Server, an den es gehen könnte.",
      ),
    notInDocument: "nicht im Dokument",
    localOnlyType: "nur",
    localOnlyId: "lokal",
  },

  faq: {
    heading: "Fragen",
    lede: "Was man fragt, bevor man einen Payload in das Werkzeug eines anderen einfügt.",
    items: [
      {
        q: "Verlässt etwas, das ich einfüge, meinen Browser?",
        a: () =>
          frag(
            "Nein. Lesen, Indizieren und Darstellen passieren auf dieser Seite, und das Dokument liegt in der IndexedDB Ihres Browsers. Es gibt keinen Upload und kein Konto. Die einzige Ausnahme geschieht nur auf Ihren Wunsch: Ein Share-Link wird zuerst in Ihrem Browser verschlüsselt, und der Schlüssel steckt im Link selbst — der Server speichert also nur Chiffrat, das er nicht lesen kann.",
          ),
      },
      {
        q: "Was ist ein JSON:API-Dokument?",
        a: () =>
          frag(
            "Eine Antwort in der Form, die die JSON:API-Spezifikation vorgibt: ein ",
            el("code", { text: "data" }),
            "-Schlüssel auf oberster Ebene mit Ressourcenobjekten, deren ",
            el("code", { text: "relationships" }),
            " ",
            el("code", { text: "{type, id}" }),
            "-Pointer sind, und ein benachbartes ",
            el("code", { text: "included" }),
            "-Array mit den Ressourcen, die diese Pointer benennen. Einer Beziehung von Hand zu folgen heißt, eine UUID im ganzen Payload zu suchen.",
          ),
      },
      {
        q: "Wie folge ich einer Beziehung?",
        a: () =>
          frag(
            "Anklicken. Jeder Pointer, der aufgeht, ist ein echter Anker auf dieselbe Seite — „Zurück“ und „Vorwärts“, Deep Links, Seitensuche und „Linkadresse kopieren“ verhalten sich also wie überall sonst.",
          ),
      },
      {
        q: "Was bedeutet „nicht im Dokument“ neben einem Pointer?",
        a: () =>
          frag(
            "Die Beziehung benennt eine Ressource, die weder in ",
            el("code", { text: "data" }),
            " noch in ",
            el("code", { text: "included" }),
            " steht. Meist fehlt ein ",
            el("code", { text: "include" }),
            "-Parameter in der Anfrage, oder ein Server hat etwas weggelassen — und genau diesen Unterschied zu sehen ist normalerweise der Grund, aus dem Sie den Payload geöffnet haben.",
          ),
      },
      {
        q: "Wie groß darf ein Dokument sein?",
        a: () =>
          frag(
            "25,7 MB mit 56.821 Ressourcen sind in etwa 1,6 Sekunden dargestellt (Chrome, Apple Silicon) und lassen sich danach flüssig scrollen. Die Grenze ist die Zahl der DOM-Knoten, nicht die Größe des Payloads — praktisch liegt sie bei rund 100.000 Ressourcen.",
          ),
      },
      {
        q: "Gibt es eine API, einen Server oder eine Anmeldung?",
        a: () =>
          frag(
            "Nichts davon. Es ist eine statische Seite — Markup, ein JavaScript-Bundle und selbst gehostete Schriften — ohne Analytics, ohne Cookies, ohne Anfragen an Dritte. Der einzige serverseitige Code im Projekt speichert verschlüsselte Share-Blobs, die er nicht entschlüsseln kann.",
          ),
      },
    ],
  },

  overview: {
    shape: "Form",
    resources: "Ressourcen",
    types: "Typen",
    included: "Included",
    relationships: "Beziehungen",
    unresolvedPointers: (n) =>
      f.plural(n, { one: "Offener Pointer", other: "Offene Pointer" }),
    duplicateIdentities: "Doppelte Identitäten",
    size: "Größe",
    indexedIn: "Indiziert in",

    shapeNull: "data: null",
    shapeErrors: (n) => `errors[${f.n(n)}]`,
    shapeIncludedOnly: "nur included",
    shapeMetaOnly: "nur meta",
    shapeSingle: "data{1}",
    shapeMany: (n) => `data[${f.n(n)}]`,

    nullNote:
      "Die Primärdaten sind ausdrücklich null. Das ist eine gültige Antwort für eine to-one-Beziehung, die auf nichts verweist — kein Fehler.",
    emptyNote:
      "Dieses Dokument enthält keine Ressourcen. Unten stehen nur seine Top-Level-Member.",
    lazyNote: (n) =>
      `Großes Dokument: Alle ${f.n(n)} Ressourcen stehen auf der Seite und jeder Anker geht auf, die Attributdetails werden aber erst beim Aufklappen gebaut. Die Seitensuche erreicht jede Übersichtszeile, auch außerhalb des sichtbaren Bereichs — um in Attributen zu suchen, klappen Sie die Ressourcen vorher auf.`,

    shareLink: "Share-Link",
    shareLinkTitle: "Einen verschlüsselten Share-Link erstellen",
    save: "Speichern",
    saveTitle: "Dieses Dokument in diesem Browser behalten",
    export: "Exportieren",
    exportTitle: "Das Dokument als Datei herunterladen",
    raw: "Roh",
    rawTitle: "Das ganze Dokument als rohes JSON zeigen",
    copy: "Kopieren",
    copyTitle: "Das ganze Dokument kopieren",

    stats: (resources, types, size) =>
      `${f.n(resources)} ${f.plural(resources, { one: "Ressource", other: "Ressourcen" })} · ${f.n(types)} ${f.plural(types, { one: "Typ", other: "Typen" })} · ${size}`,
  },

  num: (value) => f.n(value),

  shape: {
    name: (value) => {
      switch (value) {
        case "jsonapi":
          return "JSON:API";
        case "hal":
          return "HAL";
        case "odata":
          return "OData";
        case "jsonrpc":
          return "JSON-RPC";
        case "envelope":
          return "Envelope";
        case "collection":
          return "Sammlung";
        case "ndjson":
          return "JSON Lines";
        case "plain":
          return "Reines JSON";
      }
    },
    evidence: (value) => {
      switch (value.kind) {
        case "jsonapi-member":
          return "Dieses Dokument hat ein Top-Level-Member `data`, `errors` oder `meta`.";
        case "hal-links":
          return "Als HAL erkannt: Das Dokument hat ein Top-Level-Member `_links`.";
        case "hal-embedded":
          return "Als HAL erkannt: Das Dokument hat ein Top-Level-Member `_embedded`.";
        case "odata-context":
          return "Als OData erkannt: Das Dokument hat ein Member `@odata.context`.";
        case "jsonrpc-member":
          return "Als JSON-RPC erkannt: Das Dokument hat ein Member `jsonrpc`.";
        case "envelope-shape":
          return "Dieses Dokument hat ein `data`-Member, dessen Wert aber nicht wie JSON:API-Ressourcendaten geformt ist.";
        case "envelope-conflict":
          return "Dieses Dokument hat sowohl `data` als auch `errors`, was JSON:API zusammen verbietet.";
        case "collection-array":
          return `Das Dokument ist ein nacktes Array mit ${f.n(value.length)} ${f.plural(value.length, { one: "Eintrag", other: "Einträgen" })}.`;
        case "ndjson-lines":
          return value.malformedLine === null
            ? `Gelesen als ${f.n(value.records)} JSON-Lines-${f.plural(value.records, { one: "Datensatz", other: "Datensätze" })}.`
            : `Gelesen als ${f.n(value.records)} JSON-Lines-${f.plural(value.records, { one: "Datensatz", other: "Datensätze" })}; Zeile ${f.n(value.malformedLine)} ließ sich nicht parsen und wurde übersprungen.`;
        case "plain-empty-object":
          return "Das Dokument ist ein leeres Objekt.";
        case "plain-scalar":
          return "Das Dokument ist ein einzelner Wert, kein Objekt und kein Array.";
        case "plain-object":
          return "Das Dokument ist ein einfaches JSON-Objekt ohne erkannte Form.";
        case "plain-unparseable":
          return "Der Text ließ sich weder als JSON noch als JSON Lines lesen.";
      }
    },
    offerHeadline: (shapeName) => `Das sieht aus wie ${shapeName}, nicht wie JSON:API.`,
    readAsPlain: "Als reines JSON lesen",
    readAsJsonApi: "Trotzdem als JSON:API lesen",
    stats: (items, collections, size) =>
      `${f.n(items)} ${f.plural(items, { one: "Eintrag", other: "Einträge" })} · ${f.n(collections)} ${f.plural(collections, { one: "Sammlung", other: "Sammlungen" })} · ${size}`,
    itemsStat: "Einträge",
    collectionsStat: "Sammlungen",
    ambiguousStat: "Mehrdeutige Identitäten",
    emptyNote: "Dieses Dokument enthält keine Sammlungen oder Identitäten. Unten steht nur seine Struktur.",
    identitySkippedNote:
      "Dieses Dokument ist groß genug, dass die Identitätserkennung übersprungen wurde — Werte werden angezeigt, aber wiederholte Kennungen sind nicht verlinkt.",
    rootCollectionLabel: "Einträge",
    tooManyMembers: (n) => `${f.n(n)} weitere ${f.plural(n, { one: "Eintrag", other: "Einträge" })} nicht angezeigt`,
    topLevelMembers: { title: "Weitere Top-Level-Member", empty: "Keine weiteren Top-Level-Member." },
  },

  rail: {
    ariaLabel: "Inhalt des Dokuments",
    narrow: "Liste eingrenzen",
    narrowLabel: "Typenliste eingrenzen",
    inPrimary: "In den Primärdaten",
    jumpTo: (type) => `Zu ${type} springen`,
    only: "nur",
    showOnly: (type) => `Nur ${type} zeigen`,
    showAllTypes: "Alle Typen zeigen",
    types: "Typen",
  },

  group: {
    expandAll: "Alle aufklappen",
    collapseAll: "Alle zuklappen",
    tooManyRows: (n) => `${f.n(n)} ${f.plural(n, { one: "Zeile", other: "Zeilen" })}`,
    tooManyRowsTitle: "Zu viele Zeilen, um sie auf einmal aufzuklappen",
  },

  dangling: {
    title: "Offene Pointer",
    distinct: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "eindeutiger Pointer zeigt", other: "eindeutige Pointer zeigen" })} in diesem Dokument ins Leere`,
    total: (n) => `${f.n(n)} insgesamt`,
    note: "Auf diese wird über Beziehungen verwiesen, sie wurden aber weder in data noch in included mitgeschickt. Meist fehlte dem Request ein include-Parameter — oder der Server hat etwas weggelassen, das er hätte senden sollen.",
  },

  errors: {
    title: "Fehler",
    fallbackTitle: (position) => `Fehler ${f.n(position)}`,
    pointer: "pointer",
    parameter: "parameter",
  },

  topLevel: {
    summary: "Top-Level-Member",
  },

  primary: {
    title: "Primärdaten",
    more: (n) => `+ ${f.n(n)} weitere in den Abschnitten unten`,
  },

  resource: {
    primaryTag: "primär",
    primaryTagTitle: "Teil der Primärdaten des Dokuments",
    relTag: (n) => `${f.n(n)} Bez.`,
    relTagTitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "Beziehung", other: "Beziehungen" })}`,
    unresolvedTag: (n) => `${f.n(n)} offen`,
    unresolvedTagTitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "Pointer dieser Ressource zeigt", other: "Pointer dieser Ressource zeigen" })} in diesem Dokument ins Leere`,
    duplicatedTag: "doppelt",
    duplicatedTagTitle:
      "Diese Kombination aus type und id kam im Dokument mehrfach vor; die Vorkommen wurden zusammengeführt",
    noSummaryAttribute: "kein Attribut für die Übersicht",
    noAttributes: "keine Attribute",
    notInDocument: "nicht im Dokument",
    absentChipTitle: (type, id) =>
      `Im Dokument gibt es keine Ressource mit type „${type}“ und id „${id}“`,
    showMore: (n) => `${f.n(n)} weitere zeigen`,
  },

  relationships: {
    title: "Beziehungen",
    empty: "Keine Beziehungen.",
    toOne: "to-one",
    toMany: (n) => `to-many · ${f.n(n)}`,
    toOneNull: "to-one · null",
    noLinkage: "keine Linkage",
    nullNote: "Linkage ist ausdrücklich null — verweist auf nichts.",
    noLinkageNote:
      "Keine Linkage-Daten. Der Server hat nicht gesagt, worauf sich das bezieht; rufen Sie den related-Link ab, um es herauszufinden.",
  },

  referencedBy: {
    title: "Verwiesen von",
    tooMany: "Dieses Dokument hat zu viele Pointer, um sie rückwärts zu indizieren.",
    none: "Nichts in diesem Dokument verweist auf diese Ressource.",
    inbound: (n) => `${f.n(n)} eingehend`,
  },

  value: {
    emptyArray: "leeres Array",
    emptyObject: "leeres Objekt",
    items: (n) => `${f.n(n)} ${f.plural(n, { one: "Element", other: "Elemente" })}`,
    keys: (n) => `${f.n(n)} ${f.plural(n, { one: "Schlüssel", other: "Schlüssel" })}`,
    copyPointerTitle: "JSON Pointer auf diesen Wert kopieren",
    copyPointerLabel: "Pfad",
    copyValueTitle: "Diesen Wert kopieren",
    copyValueLabel: "Wert",
    pointerTitle: "JSON Pointer auf diesen Block",
  },

  identity: {
    seeCollection: (label, count) =>
      `${f.n(count)} ${f.plural(count, { one: "Eintrag", other: "Einträge" })} im Abschnitt „${label}“`,
    ambiguousTitle: (count) =>
      `${f.n(count)} mögliche ${f.plural(count, { one: "Definition", other: "Definitionen" })} für diesen Wert — nicht verlinkt, weil unklar ist, welche gemeint ist`,
    danglingTitle: "Für diesen Wert wurde keine Definition im Dokument gefunden",
    unrenderedTitle:
      "Für diesen Wert gibt es eine Definition im Dokument, aber die Sammlung ist zu groß, um sie hier anzuzeigen",
    global: "Kennung",
  },

  block: {
    attributes: { title: "Attribute", empty: "Keine Attribute." },
    meta: { title: "Meta", empty: "Kein meta." },
    links: { title: "Links", empty: "Keine Links." },
    jsonapi: { title: "jsonapi", empty: "Keine jsonapi-Member." },
  },

  raw: {
    copyJson: "JSON kopieren",
    download: "Herunterladen",
    wholeDocument: "ganzes Dokument",
  },

  library: {
    title: "Gespeicherte Dokumente",
    countInBrowser: (n) => `${f.n(n)} in diesem Browser`,
    storedLocally: "Lokal in diesem Browser gespeichert",
    emptyTitle: "Noch nichts gespeichert.",
    emptyHint:
      "Öffnen Sie ein Dokument und wählen Sie „Speichern“, um es hier zu behalten. Gespeicherte Dokumente bleiben in diesem Browser — sie werden nie hochgeladen.",
    open: (label) => `${label} öffnen`,
    rename: "umbenennen",
    renameTitle: "Umbenennen",
    renameLabel: (label) => `${label} umbenennen`,
    renamePrompt: "Neuer Name für dieses Dokument",
    renamed: (label) => `Umbenannt in ${label}`,
    renameFailed: "Dieses Dokument konnte nicht umbenannt werden.",
    delete: "löschen",
    deleteTitle: "Löschen",
    deleteLabel: (label) => `${label} löschen`,
    deleteConfirm: (label) => `„${label}“ aus Ihren gespeicherten Dokumenten löschen?`,
    deleted: (label) => `${label} gelöscht`,
    deleteFailed: "Dieses Dokument konnte nicht gelöscht werden.",
    resources: (n) => `${f.n(n)} ${f.plural(n, { one: "Ressource", other: "Ressourcen" })}`,
    types: (n) => `${f.n(n)} ${f.plural(n, { one: "Typ", other: "Typen" })}`,
    justNow: "gerade eben",
    minutesAgo: (n) => `vor ${f.n(n)} Min.`,
    hoursAgo: (n) => `vor ${f.n(n)} Std.`,
    daysAgo: (n) => `vor ${f.n(n)} T.`,
    savedOn: (epochMs) => f.date(epochMs),
  },

  save: {
    title: "Dieses Dokument speichern",
    subtitle: "Bleibt nur in diesem Browser",
    nameLabel: "Name",
    save: "Speichern",
    hint: "Gespeicherte Dokumente liegen in der IndexedDB dieses Browsers. Wenn Sie die Websitedaten löschen, sind sie weg.",
    done: (label) => `„${label}“ in diesem Browser gespeichert`,
    failed: "Speichern im Browser-Speicher nicht möglich.",
  },

  shortcuts: {
    title: "Tastaturkürzel",
    or: "oder",
    showList: "Diese Liste zeigen",
    find: "Ressource nach type oder id finden",
    saveDocument: "Das Dokument in diesem Browser speichern",
    rawDocument: "Das ganze Dokument als rohes JSON zeigen",
    exportDocument: "Das Dokument in eine Datei exportieren",
    openLibrary: "Gespeicherte Dokumente öffnen",
    leaveDocument: "Das Dokument verlassen und zurück zur Einfügeansicht",
    closeDialog: "Einen Dialog schließen",
    readPasted: "Das eingefügte Dokument lesen",

    inThisApp: "In dieser Anwendung",
    fromBrowser: (apple) => (apple ? "Vom Browser — Mac-Tasten" : "Vom Browser"),
    browserBack: "Zurück — zu der Ressource, aus der Sie kamen",
    browserForward: "Vorwärts — die Kette wieder hinunter, die Sie zurückgegangen sind",
    browserNewTab: "Eine Beziehung in einem neuen Tab öffnen",
    historyNote:
      "Diese Anwendung legt für jede Beziehung, der Sie folgen, einen echten Historieneintrag an. Zurück und Vorwärts bewegen Sie damit durch das Dokument selbst und bringen Sie genau zu der Ressource und der Scrollposition zurück, die Sie verlassen haben. Es sind die Tasten Ihres Browsers, nicht die dieser Anwendung.",
    pointerNote: (apple) =>
      apple
        ? "Ein Zwei-Finger-Wisch nach links oder rechts auf dem Trackpad tut dasselbe, ebenso die Seitentasten Ihrer Maus."
        : "Die Seitentasten Ihrer Maus tun dasselbe, ebenso ein Wisch nach links oder rechts auf dem Trackpad.",
    otherPlatformNote: (apple) =>
      apple
        ? "Unter Windows und Linux sind dieselben beiden Alt + ← und Alt + →."
        : "Auf dem Mac sind dieselben beiden ⌘ + [ und ⌘ + ] (oder ⌘ + ← und ⌘ + →).",
  },

  jump: {
    title: "Zu einer Ressource springen",
    subtitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "Ressource", other: "Ressourcen" })} in diesem Dokument`,
    placeholder: "type oder id — z. B. people 0098 oder art-8f21",
    label: "Ressource nach type oder id finden",
    noMatch: "Keine Ressource passt dazu.",
    capped: (max) => `Die ersten ${f.n(max)} Treffer — tippen Sie weiter, um einzugrenzen`,
    matches: (n) => `${f.n(n)} ${f.plural(n, { one: "Treffer", other: "Treffer" })}`,
  },

  modal: {
    close: "Schließen",
  },

  share: {
    title: "Dieses Dokument teilen",
    unsupported:
      "Dieser Browser kann keinen Share-Link verschlüsseln (benötigt WebCrypto und CompressionStream).",
    lede: "Das Dokument wird in diesem Tab gzip-komprimiert und verschlüsselt. Der Schlüssel entsteht hier und steht nur im Link — der Server speichert einen undurchsichtigen Datensatz, den er nicht lesen kann. Erstellen und Öffnen dauern jeweils einen Moment, weil der kurze Schlüssel absichtlich aufwendig abzuleiten ist.",
    lifetimeLabel: "Gültigkeitsdauer",
    note: "Wer den Link hat, kann das Dokument lesen — behandeln Sie ihn also wie den Payload selbst. Der Schlüssel steht im URL-Pfad und landet damit in der Browser-Historie und überall sonst, wo der Link verarbeitet wird. Verschicken Sie ihn so, wie Sie den Payload verschicken würden.",
    create: "Link erstellen",
    deriving: "Schlüssel wird abgeleitet und verschlüsselt …",
    uploading: (size) => `${size} werden hochgeladen …`,
    linkLabel: "Link",
    linkFieldLabel: "Share-Link",
    copyLink: "Link kopieren",
    neverExpires: "Dieser Link läuft nicht ab. Er bleibt, bis Sie ihn entfernen lassen.",
    expiresOn: (epochMs) => `Dieser Link funktioniert bis ${f.dateTime(epochMs)}.`,
    sizes: (encrypted, original) =>
      `Verschlüsselt ${encrypted}, aus ${original} JSON.`,
    lifetimes: {
      "15m": "15 Minuten",
      "6h": "6 Stunden",
      "1d": "1 Tag",
      "1w": "1 Woche",
      "1m": "1 Monat",
      forever: "Kein Ablauf",
    },
    opened: "Ein geteiltes Dokument wurde geöffnet. Es liegt jetzt in diesem Browser.",
  },

  toast: {
    copied: (what, preview) => `${what} kopiert: ${preview}`,
    copiedLarge: (what, chars) => `${what} kopiert (${f.n(chars)} Zeichen)`,
    copyFailed: (what) =>
      `${what} konnte nicht kopiert werden. Ihr Browser hat den Zugriff auf die Zwischenablage blockiert.`,
    downloading: (filename) => `${filename} wird heruntergeladen`,
    noResource: (type, id) => `Kein ${type} mit der id ${id} in diesem Dokument.`,
    filterCleared: (type) => `Alle Typen werden gezeigt, damit ${type} erreichbar ist.`,
    pointerGone: (pointer) => `Bei ${pointer} geht nichts mehr auf.`,
    notStored:
      "Dieses Dokument konnte nicht gespeichert werden; ein Neuladen verliert es also.",
    noPage: (pathname) => `Unter ${pathname} gibt es keine Seite.`,
    noDocument: "Es ist kein Dokument geladen. Fügen Sie eines ein, um loszulegen.",
  },

  copyKinds: {
    json: "JSON",
    document: "Dokument",
    value: "Wert",
    pointer: "JSON Pointer",
    deepLink: "Deep Link",
    shareLink: "Share-Link",
    resource: (type, id) => `${type} ${id}`,
  },

  parseErrors: {
    empty: {
      headline: "Nichts zu lesen.",
      hint: "Fügen Sie oben ein JSON:API-Dokument ein.",
    },
    nothingYet: {
      headline: "Noch nichts zu lesen.",
      hint: "Fügen Sie ein JSON:API-Dokument ein oder legen Sie eine Datei ab.",
    },
    pythonDict: {
      headline: "Das sieht nach einem Python-dict aus, nicht nach JSON.",
      hint: "Schlüssel in einfachen Anführungszeichen sowie `None`/`True` sind kein gültiges JSON. Geben Sie es mit `json.dumps(...)` neu aus.",
    },
    notJsonStart: {
      headline: "Das beginnt nicht wie JSON.",
      hint: "Ein JSON:API-Dokument beginnt mit `{`. Wenn Sie eine Logzeile kopiert haben, schneiden Sie alles vor der ersten `{` ab.",
    },
    invalidJson: {
      headline: "Das ist kein gültiges JSON.",
      hint: (detail) => `Der Parser ist hier stehen geblieben: ${detail}`,
    },
    bareArray: {
      headline: "Das ist ein blankes JSON-Array, kein JSON:API-Dokument.",
      hint: 'Ein JSON:API-Dokument ist ein Objekt mit einem `data`-Schlüssel auf oberster Ebene. Verpacken Sie das Array: `{ "data": [...] }`.',
    },
    doubleEncoded: {
      headline: "Das ist ein JSON-String, der JSON enthält.",
      hint: "Der Payload wurde zweimal kodiert. Packen Sie den äußeren String aus und fügen Sie dann das innere Dokument ein.",
    },
    wrongType: {
      headline: (what) => `Das ist ein JSON-${what}, kein JSON:API-Dokument.`,
      hint: "Fügen Sie den ganzen Response-Body ein — ein Objekt mit `data`, `errors` oder `meta` auf oberster Ebene.",
    },
    notJsonApi: {
      headline: "Das ist gültiges JSON, aber kein JSON:API-Dokument.",
      hintKeys: (preview, more) =>
        `Auf oberster Ebene gibt es weder \`data\` noch \`errors\` oder \`meta\` — nur ${preview}${more ? ", …" : ""}. Wenn das Dokument in einem davon steckt, fügen Sie diesen Teil ein.`,
      hintEmpty:
        "Das Objekt ist leer. Ein JSON:API-Dokument braucht mindestens eines von `data`, `errors` oder `meta`.",
    },
    dataAndErrors: {
      headline: "Dieses Dokument hat sowohl `data` als auch `errors`.",
      hint: "Die Spezifikation verbietet diese Kombination. Es trotzdem anzuzeigen würde die Antwort falsch darstellen — prüfen Sie, was der Server eigentlich senden wollte.",
    },
    unknown: {
      headline: "Beim Lesen dieses Dokuments ist etwas schiefgegangen.",
    },
    fileUnreadable: {
      headline: "Diese Datei konnte nicht gelesen werden.",
      hint: "Öffnen Sie sie und fügen Sie den Inhalt ein.",
    },
  },

  shareErrors: {
    createFailed: {
      headline: "Der Share-Link konnte nicht erstellt werden.",
      serverStatus: (status) => `Der Server hat ${f.n(status)} zurückgegeben.`,
    },
    fetchFailed: {
      headline: "Das geteilte Dokument konnte nicht geladen werden.",
      network:
        "Die Netzwerkanfrage ist fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
    },
    gone: {
      headline: "Dieses geteilte Dokument gibt es nicht mehr.",
      hint: "Es wurde entweder nie erstellt oder inzwischen gelöscht.",
    },
    expired: {
      headline: "Dieser Share-Link ist abgelaufen.",
      hint: "Share-Links werden gelöscht, sobald ihre Gültigkeitsdauer endet. Bitten Sie um einen frischen Link.",
    },
    corruptShort: {
      headline: "Dieses geteilte Dokument ist beschädigt.",
      hint: "Die gespeicherten Daten sind zu kurz für ein gültiges Dokument.",
    },
    wrongVersion: {
      headline: "Dieser Share-Link stammt aus einer anderen Version.",
      hint: (found, expected) =>
        `Er nutzt Formatversion ${f.n(found)}, dieser Build liest Version ${f.n(expected)}. Bitten Sie um einen frischen Link.`,
    },
    undecryptable: {
      headline: "Dieser Share-Link konnte nicht entschlüsselt werden.",
      hint: "Der Schlüssel passt nicht zu diesem Dokument. Wenn der Link gekürzt, von einem Chat-Client umgebaut oder abgetippt wurde, ist der Schlüssel vermutlich falsch.",
    },
    corruptDeflate: {
      headline: "Dieses geteilte Dokument ist beschädigt.",
      hint: "Es ließ sich entschlüsseln, der Inhalt aber nicht dekomprimieren.",
    },
    corruptPayload: {
      headline: "Dieses geteilte Dokument ist beschädigt.",
      hint: "Es ließ sich entschlüsseln, enthält aber kein Dokument.",
    },
  },

  labels: {
    pastedDocument: "eingefügtes Dokument",
    storedDocument: "gespeichertes Dokument",
    sharedDocument: (id) => `geteiltes Dokument ${f.n(id)}`,
  },
};
