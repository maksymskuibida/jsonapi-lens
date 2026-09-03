/**
 * Українська.
 *
 * Typed as `Messages`, so a missing or drifted key is a compile error.
 *
 * Українська має чотири форми множини, і саме тут вони мають значення:
 * 1 ресурс, 2 ресурси, 5 ресурсів, 21 ресурс. Категорію обирає
 * `Intl.PluralRules`, тому кожен лічильник нижче подає `one`, `few` і `many`
 * окремо — умови на кшталт `n === 1` тут просто не працюють.
 *
 * Терміни JSON:API (`data`, `included`, `to-one`, pointer) лишаються
 * англійськими: так вони записані у специфікації та в самому payload, і саме
 * за ними їх шукають.
 */

import { el, frag } from "../dom.js";
import { intlFor } from "./intl.js";
import type { Messages } from "./en.js";

const f = intlFor("uk");

export const uk: Messages = {
  meta: {
    lang: "uk",
    title: "jsonapi-lens — за вказівником",
    description:
      "Читайте документ JSON:API як граф, яким він і є. Кожен зв’язок стає посиланням, яке можна натиснути. Працює повністю у вашому браузері.",
    documentTitle: (label) => `${label} — jsonapi-lens`,
  },

  language: {
    label: "Мова",
    title: "Змінити мову",
  },

  topbar: {
    brandTag: "за вказівником",
    saved: "Збережені",
    savedTitle: "Збережені документи",
    savedTitleCount: (n) => `Збережені документи (${f.n(n)})`,
    shortcuts: "Клавіатурні скорочення",
    themeLabel: "Тема:",
    themeName: (theme) => (theme === "auto" ? "авто" : theme === "light" ? "світла" : "темна"),
    themeTitle: (name) => `Тема: ${name}. Натисніть, щоб змінити.`,
    newDocument: "Новий",
    newDocumentRest: " документ",
    newDocumentTitle: "Почати новий документ",
  },

  boot: {
    reading: "Читаємо збережений документ",
    fetchingShare: "Завантажуємо та розшифровуємо спільний документ",
  },

  footer: {
    tagline: "Переглядач документів JSON:API. Працює у вашому браузері.",
    impressum: "Вихідні дані (Impressum)",
    privacy: "Конфіденційність",
    sourceLabel: "Код",
  },

  paste: {
    eyebrow: "Переглядач документів JSON:API",
    title: () => frag("Прямуйте за ", el("em", { text: "вказівником" }), "."),
    lede: () =>
      frag(
        "JSON:API тримає пов’язані ресурси в сусідньому масиві ",
        el("code", { text: "included" }),
        ", тому пройти за зв’язком означає шукати UUID по всьому payload. Вставте документ — і кожен вказівник стане посиланням, яке можна натиснути, зі справжньою історією браузера, глибокими посиланнями та пошуком по сторінці.",
      ),
    dropLabel: () =>
      frag("Вставте документ або перетягніть файл ", el("code", { text: ".json" })),
    characters: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "символ", few: "символи", many: "символів", other: "символу" })}`,
    inputLabel: "Документ JSON:API",
    dropOverlay: "Відпустіть, щоб прочитати",
    read: "Прочитати документ",
    openFile: "Відкрити файл",
    readHint: (mod) =>
      frag(el("kbd", { text: mod }), " ", el("kbd", { text: "↵" }), " — прочитати"),
    errorWhere: (line) => `приблизно в рядку ${f.n(line)}`,
  },

  resume: {
    stillOpen: (label) => frag("Ще відкрито: ", el("b", { text: label })),
    back: "Назад до документа",
  },

  samples: {
    label: "Або спробуйте",
    articles: "Стрічка статей",
    single: "Один ресурс",
    dangling: "Відсутній include",
    errors: "Відповідь з помилками",
    edge: "Незручні id",
    articlesFile: "статті.json",
    singleFile: "один-ресурс.json",
    danglingFile: "відсутній-include.json",
    errorsFile: "відповідь-з-помилками.json",
    edgeFile: "незручні-id.json",
  },

  legend: {
    resolves: () =>
      frag(
        el("b", { text: "Вказівник, який знаходить ціль," }),
        " є посиланням. Натискання прокручує до цього ресурсу й додає запис в історію, тож «Назад» поверне вас туди, де ви були.",
      ),
    absent: () =>
      frag(
        el("b", { text: "Вказівник, який нічого не знаходить," }),
        " так і каже. Саме ця різниця зазвичай і є тим, що ви шукаєте: пропущений параметр ",
        el("code", { text: "include" }),
        " або сервер, який щось не надіслав.",
      ),
    local: () =>
      frag(
        el("b", { text: "Ніщо не залишає ваш браузер." }),
        " Розбір, індексування та відображення відбуваються на цій сторінці, а документ зберігається в локальній IndexedDB, тож після перезавантаження ваші глибокі посилання й далі працюють. Немає сервера, куди його надсилати.",
      ),
    notInDocument: "немає в документі",
    localOnlyType: "лише",
    localOnlyId: "локально",
  },

  faq: {
    heading: "Питання",
    lede: "Те, що запитують, перш ніж вставити payload у чужий інструмент.",
    items: [
      {
        q: "Чи покидає щось, що я вставляю, мій браузер?",
        a: () =>
          frag(
            "Ні. Читання, індексування та відображення відбуваються на цій сторінці, а документ лежить в IndexedDB вашого браузера. Немає ні надсилання на сервер, ні акаунта. Єдиний виняток — лише за вашим вибором: посилання для обміну шифрується у вашому браузері, а ключ подорожує в самому посиланні, тож сервер зберігає лише шифротекст, який не може прочитати.",
          ),
      },
      {
        q: "Що таке документ JSON:API?",
        a: () =>
          frag(
            "Відповідь у формі, яку задає специфікація JSON:API: ключ ",
            el("code", { text: "data" }),
            " на верхньому рівні з об’єктами ресурсів, чиї ",
            el("code", { text: "relationships" }),
            " — це вказівники ",
            el("code", { text: "{type, id}" }),
            ", і сусідній масив ",
            el("code", { text: "included" }),
            " з ресурсами, які ці вказівники називають. Пройти за одним зв’язком вручну означає шукати UUID по всьому payload.",
          ),
      },
      {
        q: "Як пройти за зв’язком?",
        a: () =>
          frag(
            "Натиснути на нього. Кожен вказівник, який знаходить ціль, є справжнім якорем на ту саму сторінку, тож «Назад» і «Вперед», глибокі посилання, пошук по сторінці та «копіювати адресу посилання» працюють так само, як усюди.",
          ),
      },
      {
        q: "Що означає «немає в документі» біля вказівника?",
        a: () =>
          frag(
            "Зв’язок називає ресурс, якого немає ні в ",
            el("code", { text: "data" }),
            ", ні в ",
            el("code", { text: "included" }),
            ". Зазвичай це пропущений параметр ",
            el("code", { text: "include" }),
            " у запиті або сервер, який щось не надіслав, — і побачити саму цю різницю здебільшого і є причиною, з якої ви відкрили payload.",
          ),
      },
      {
        q: "Наскільки великий документ він прочитає?",
        a: () =>
          frag(
            "25,7 МБ і 56 821 ресурс відображаються приблизно за 1,6 секунди (Chrome, Apple Silicon) і далі гортаються плавно. Обмежує кількість вузлів DOM, а не розмір payload, тож практична межа — близько 100 000 ресурсів.",
          ),
      },
      {
        q: "Чи є API, сервер або реєстрація?",
        a: () =>
          frag(
            "Нічого з цього. Це статична сторінка — розмітка, один JavaScript-бандл і власно розміщені шрифти — без аналітики, без cookie, без запитів до третіх сторін. Єдиний серверний код у проєкті зберігає зашифровані блоби для обміну, які він не може розшифрувати.",
          ),
      },
    ],
  },

  overview: {
    shape: "Форма",
    resources: "Ресурси",
    types: "Типи",
    included: "Included",
    relationships: "Зв’язки",
    unresolvedPointers: (n) =>
      f.plural(n, {
        one: "Незнайдений вказівник",
        few: "Незнайдені вказівники",
        many: "Незнайдених вказівників",
        other: "Незнайдених вказівників",
      }),
    duplicateIdentities: "Дублікати ідентичностей",
    size: "Розмір",
    indexedIn: "Проіндексовано за",

    shapeNull: "data: null",
    shapeErrors: (n) => `errors[${f.n(n)}]`,
    shapeIncludedOnly: "лише included",
    shapeMetaOnly: "лише meta",
    shapeSingle: "data{1}",
    shapeMany: (n) => `data[${f.n(n)}]`,

    nullNote:
      "Первинні дані явно дорівнюють null. Це коректна відповідь для зв’язку to-one, який ні на що не вказує, а не помилка.",
    emptyNote:
      "Цей документ не містить ресурсів. Нижче показано лише його члени верхнього рівня.",
    lazyNote: (n) =>
      `Великий документ: усі ${f.n(n)} ресурсів є на сторінці й кожен якір працює, але деталі атрибутів будуються тоді, коли ви розгортаєте ресурс. Пошук по сторінці бачить кожен підсумковий рядок, зокрема поза екраном; щоб шукати всередині атрибутів, спершу розгорніть ресурси.`,

    shareLink: "Спільне посилання",
    shareLinkTitle: "Створити зашифроване спільне посилання",
    save: "Зберегти",
    saveTitle: "Залишити цей документ у цьому браузері",
    export: "Експорт",
    exportTitle: "Завантажити документ як файл",
    raw: "Сирий",
    rawTitle: "Показати весь документ як сирий JSON",
    copy: "Копіювати",
    copyTitle: "Скопіювати весь документ",

    stats: (resources, types, size) =>
      `${f.n(resources)} ${f.plural(resources, { one: "ресурс", few: "ресурси", many: "ресурсів", other: "ресурсу" })} · ${f.n(types)} ${f.plural(types, { one: "тип", few: "типи", many: "типів", other: "типу" })} · ${size}`,
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
          return "Конверт";
        case "collection":
          return "Колекція";
        case "ndjson":
          return "JSON Lines";
        case "plain":
          return "Звичайний JSON";
      }
    },
    evidence: (value) => {
      switch (value.kind) {
        case "jsonapi-member":
          return "Цей документ має член верхнього рівня `data`, `errors` або `meta`.";
        case "hal-links":
          return "Визначено як HAL: документ має член верхнього рівня `_links`.";
        case "hal-embedded":
          return "Визначено як HAL: документ має член верхнього рівня `_embedded`.";
        case "odata-context":
          return "Визначено як OData: документ має член `@odata.context`.";
        case "jsonrpc-member":
          return "Визначено як JSON-RPC: документ має член `jsonrpc`.";
        case "envelope-shape":
          return "Цей документ має член `data`, але його значення не має форми ресурсних даних JSON:API.";
        case "envelope-conflict":
          return "Цей документ має водночас `data` і `errors`, а JSON:API забороняє поєднувати їх.";
        case "collection-array":
          return `Документ — це голий масив, ${f.n(value.length)} ${f.plural(value.length, { one: "елемент", few: "елементи", many: "елементів", other: "елемента" })}.`;
        case "ndjson-lines": {
          const base = `Прочитано як ${f.n(value.records)} ${f.plural(value.records, { one: "запис", few: "записи", many: "записів", other: "запису" })} JSON Lines`;
          if (value.skipped === 0) return `${base}.`;
          if (value.skipped === 1) {
            return `${base}; рядок ${f.n(value.malformedLine!)} не розібрався і був пропущений.`;
          }
          const lines = f.plural(value.skipped, { one: "рядок", few: "рядки", many: "рядків", other: "рядка" });
          return `${base}; ${f.n(value.skipped)} ${lines} не розібралися і були пропущені, перший — рядок ${f.n(value.malformedLine!)}.`;
        }
        case "plain-empty-object":
          return "Документ — це порожній об’єкт.";
        case "plain-scalar":
          return "Документ — це одне значення, не об’єкт і не масив.";
        case "plain-object":
          return "Документ — це звичайний об’єкт JSON без розпізнаної форми.";
        case "plain-unparseable":
          return "Текст не вдалося прочитати ні як JSON, ні як JSON Lines.";
      }
    },
    offerHeadline: (shapeName) => `Це схоже на ${shapeName}, а не на JSON:API.`,
    readAsPlain: "Прочитати як звичайний JSON",
    readAsJsonApi: "Усе одно прочитати як JSON:API",
    stats: (items, collections, size) =>
      `${f.n(items)} ${f.plural(items, { one: "елемент", few: "елементи", many: "елементів", other: "елемента" })} · ${f.n(collections)} ${f.plural(collections, { one: "колекція", few: "колекції", many: "колекцій", other: "колекції" })} · ${size}`,
    itemsStat: "Елементи",
    collectionsStat: "Колекції",
    ambiguousStat: "Неоднозначні ідентичності",
    emptyNote: "Цей документ не містить колекцій або ідентичностей. Нижче показано лише його структуру.",
    identitySkippedNote:
      "Цей документ достатньо великий, тому визначення ідентичностей було пропущено — значення показано, але повторювані ідентифікатори не перетворено на посилання.",
    rootCollectionLabel: "елементи",
    tooManyMembers: (n) =>
      `${f.n(n)} ще ${f.plural(n, { one: "елемент", few: "елементи", many: "елементів", other: "елемента" })} не показано`,
    topLevelMembers: { title: "Інші члени верхнього рівня", empty: "Немає інших членів верхнього рівня." },
  },

  rail: {
    ariaLabel: "Зміст документа",
    narrow: "Звузити список",
    narrowLabel: "Звузити список типів",
    inPrimary: "У первинних даних",
    jumpTo: (type) => `Перейти до ${type}`,
    only: "лише",
    showOnly: (type) => `Показати лише ${type}`,
    showAllTypes: "Показати всі типи",
    types: "Типи",
  },

  group: {
    expandAll: "Розгорнути все",
    collapseAll: "Згорнути все",
    tooManyRows: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "рядок", few: "рядки", many: "рядків", other: "рядка" })}`,
    tooManyRowsTitle: "Забагато рядків, щоб розгорнути їх водночас",
  },

  dangling: {
    title: "Незнайдені вказівники",
    distinct: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "унікальний вказівник нічого не знаходить", few: "унікальні вказівники нічого не знаходять", many: "унікальних вказівників нічого не знаходять", other: "унікального вказівника нічого не знаходять" })} у цьому документі`,
    total: (n) => `${f.n(n)} загалом`,
    note: "На них посилаються зв’язки, але їх не надіслано ані в data, ані в included. Зазвичай це означає, що в запиті бракувало параметра include — або що сервер не надіслав те, що мав.",
  },

  errors: {
    title: "Помилки",
    fallbackTitle: (position) => `Помилка ${f.n(position)}`,
    pointer: "pointer",
    parameter: "parameter",
  },

  topLevel: {
    summary: "Члени верхнього рівня",
  },

  primary: {
    title: "Первинні дані",
    more: (n) => `+ ще ${f.n(n)} у розділах нижче`,
  },

  resource: {
    primaryTag: "первинний",
    primaryTagTitle: "Частина первинних даних документа",
    relTag: (n) => `${f.n(n)} зв.`,
    relTagTitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "зв’язок", few: "зв’язки", many: "зв’язків", other: "зв’язку" })}`,
    unresolvedTag: (n) => `${f.n(n)} незнайдено`,
    unresolvedTagTitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "вказівник цього ресурсу нічого не знаходить", few: "вказівники цього ресурсу нічого не знаходять", many: "вказівників цього ресурсу нічого не знаходять", other: "вказівника цього ресурсу нічого не знаходять" })} у цьому документі`,
    duplicatedTag: "дубльовано",
    duplicatedTagTitle:
      "Ця пара type/id траплялася в документі більше ніж раз; випадки було об’єднано",
    noSummaryAttribute: "немає атрибута для підсумку",
    noAttributes: "немає атрибутів",
    notInDocument: "немає в документі",
    absentChipTitle: (type, id) =>
      `У цьому документі немає ресурсу з type «${type}» та id «${id}»`,
    showMore: (n) => `Показати ще ${f.n(n)}`,
  },

  relationships: {
    title: "Зв’язки",
    empty: "Немає зв’язків.",
    toOne: "to-one",
    toMany: (n) => `to-many · ${f.n(n)}`,
    toOneNull: "to-one · null",
    noLinkage: "без linkage",
    nullNote: "Linkage явно дорівнює null — не пов’язано ні з чим.",
    noLinkageNote:
      "Даних linkage немає. Сервер не сказав, із чим це пов’язано; щоб дізнатися, зверніться за посиланням related.",
  },

  referencedBy: {
    title: "Посилаються на нього",
    tooMany: "У цьому документі забагато вказівників, щоб індексувати їх у зворотному напрямку.",
    none: "Ніщо в цьому документі не вказує на цей ресурс.",
    inbound: (n) => `${f.n(n)} вхідних`,
  },

  value: {
    emptyArray: "порожній масив",
    emptyObject: "порожній об’єкт",
    items: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "елемент", few: "елементи", many: "елементів", other: "елемента" })}`,
    keys: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "ключ", few: "ключі", many: "ключів", other: "ключа" })}`,
    copyPointerTitle: "Скопіювати JSON Pointer на це значення",
    copyPointerLabel: "шлях",
    copyValueTitle: "Скопіювати це значення",
    copyValueLabel: "значення",
    pointerTitle: "JSON Pointer на цей блок",
  },

  identity: {
    seeCollection: (label, count) =>
      `${f.n(count)} ${f.plural(count, { one: "елемент", few: "елементи", many: "елементів", other: "елемента" })} у розділі «${label}»`,
    ambiguousTitle: (count) =>
      `${f.n(count)} можливих ${f.plural(count, { one: "визначення", few: "визначення", many: "визначень", other: "визначення" })} для цього значення — не пов’язано посиланням, бо незрозуміло, яке саме малося на увазі`,
    danglingTitle: "Для цього значення не знайдено визначення в документі",
    unrenderedTitle:
      "Для цього значення є визначення в документі, але колекція занадто велика, щоб показати його тут",
    global: "ідентифікатор",
  },

  block: {
    attributes: { title: "Атрибути", empty: "Немає атрибутів." },
    meta: { title: "Meta", empty: "Немає meta." },
    links: { title: "Links", empty: "Немає links." },
    jsonapi: { title: "jsonapi", empty: "Немає членів jsonapi." },
  },

  raw: {
    copyJson: "Скопіювати JSON",
    download: "Завантажити",
    wholeDocument: "весь документ",
  },

  library: {
    title: "Збережені документи",
    countInBrowser: (n) => `${f.n(n)} у цьому браузері`,
    storedLocally: "Збережено локально в цьому браузері",
    emptyTitle: "Поки нічого не збережено.",
    emptyHint:
      "Відкрийте документ і натисніть «Зберегти», щоб залишити його тут. Збережені документи лишаються в цьому браузері — їх ніколи не завантажують на сервер.",
    open: (label) => `Відкрити ${label}`,
    rename: "перейменувати",
    renameTitle: "Перейменувати",
    renameLabel: (label) => `Перейменувати ${label}`,
    renamePrompt: "Нова назва цього документа",
    renamed: (label) => `Перейменовано на ${label}`,
    renameFailed: "Не вдалося перейменувати цей документ.",
    delete: "видалити",
    deleteTitle: "Видалити",
    deleteLabel: (label) => `Видалити ${label}`,
    deleteConfirm: (label) => `Видалити «${label}» зі збережених документів?`,
    deleted: (label) => `Видалено ${label}`,
    deleteFailed: "Не вдалося видалити цей документ.",
    resources: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "ресурс", few: "ресурси", many: "ресурсів", other: "ресурсу" })}`,
    types: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "тип", few: "типи", many: "типів", other: "типу" })}`,
    justNow: "щойно",
    minutesAgo: (n) => `${f.n(n)} хв тому`,
    hoursAgo: (n) => `${f.n(n)} год тому`,
    daysAgo: (n) => `${f.n(n)} дн тому`,
    savedOn: (epochMs) => f.date(epochMs),
  },

  save: {
    title: "Зберегти цей документ",
    subtitle: "Лишається лише в цьому браузері",
    nameLabel: "Назва",
    save: "Зберегти",
    hint: "Збережені документи живуть в IndexedDB цього браузера. Очищення даних сайту видаляє їх.",
    done: (label) => `«${label}» збережено в цьому браузері`,
    failed: "Не вдалося зберегти у сховищі цього браузера.",
  },

  shortcuts: {
    title: "Клавіатурні скорочення",
    or: "або",
    showList: "Показати цей список",
    find: "Знайти ресурс за type або id",
    saveDocument: "Зберегти документ у цьому браузері",
    rawDocument: "Показати весь документ як сирий JSON",
    exportDocument: "Експортувати документ у файл",
    openLibrary: "Відкрити збережені документи",
    leaveDocument: "Залишити документ і повернутися до вставляння",
    closeDialog: "Закрити діалог",
    readPasted: "Прочитати вставлений документ",

    inThisApp: "У цьому застосунку",
    fromBrowser: (apple) => (apple ? "Від браузера — клавіші Mac" : "Від браузера"),
    browserBack: "Назад — до ресурсу, з якого ви прийшли",
    browserForward: "Вперед — знову вниз ланцюжком, який ви пройшли назад",
    browserNewTab: "Відкрити зв’язок у новій вкладці",
    historyNote:
      "Застосунок додає справжній запис в історію для кожного зв’язку, за яким ви йдете, тож «Назад» і «Вперед» рухають вас самим документом і повертають точно до того ресурсу й місця прокручування, які ви залишили. Це клавіші вашого браузера, а не цього застосунку.",
    pointerNote: (apple) =>
      apple
        ? "Те саме робить змах двома пальцями ліворуч або праворуч на трекпаді, а також бічні кнопки миші."
        : "Те саме роблять бічні кнопки миші, а також змах ліворуч або праворуч на трекпаді.",
    otherPlatformNote: (apple) =>
      apple
        ? "У Windows і Linux ті самі дві — Alt + ← та Alt + →."
        : "На Mac ті самі дві — ⌘ + [ і ⌘ + ] (або ⌘ + ← і ⌘ + →).",
  },

  jump: {
    title: "Перейти до ресурсу",
    subtitle: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "ресурс", few: "ресурси", many: "ресурсів", other: "ресурсу" })} у цьому документі`,
    placeholder: "type або id — напр. people 0098 чи art-8f21",
    label: "Знайти ресурс за type або id",
    noMatch: "Жоден ресурс не підходить.",
    capped: (max) => `Перші ${f.n(max)} збігів — продовжуйте вводити, щоб звузити`,
    matches: (n) =>
      `${f.n(n)} ${f.plural(n, { one: "збіг", few: "збіги", many: "збігів", other: "збігу" })}`,
  },

  modal: {
    close: "Закрити",
  },

  share: {
    title: "Поділитися цим документом",
    unsupported:
      "Цей браузер не може зашифрувати спільне посилання (потрібні WebCrypto та CompressionStream).",
    lede: "Документ стискається gzip і шифрується просто в цій вкладці. Ключ створюється тут і живе лише в посиланні — сервер зберігає непрозорі дані, які не може прочитати. Створення й відкриття посилання займають мить, бо короткий ключ навмисно дорого виводити.",
    lifetimeLabel: "Строк дії посилання",
    note: "Будь-хто з посиланням може прочитати документ, тож поводьтеся з ним, як із самим payload. Ключ міститься у шляху URL, тому потрапляє в історію браузера та всюди, де посилання обробляється — надсилайте його так само, як надсилали б payload.",
    create: "Створити посилання",
    deriving: "Виводимо ключ і шифруємо…",
    uploading: (size) => `Вивантажуємо ${size}…`,
    linkLabel: "Посилання",
    linkFieldLabel: "Спільне посилання",
    copyLink: "Скопіювати посилання",
    neverExpires: "Це посилання не має строку дії. Воно лишається, доки ви не попросите його прибрати.",
    expiresOn: (epochMs) => `Це посилання перестане працювати ${f.dateTime(epochMs)}.`,
    sizes: (encrypted, original) => `Зашифрований розмір ${encrypted}, з ${original} JSON.`,
    lifetimes: {
      "15m": "15 хвилин",
      "6h": "6 годин",
      "1d": "1 день",
      "1w": "1 тиждень",
      "1m": "1 місяць",
      forever: "Без строку",
    },
    opened: "Спільний документ відкрито. Тепер він збережений у цьому браузері.",
  },

  toast: {
    copied: (what, preview) => `Скопійовано ${what}: ${preview}`,
    copiedLarge: (what, chars) => `Скопійовано ${what} (${f.n(chars)} символів)`,
    copyFailed: (what) => `Не вдалося скопіювати ${what}. Браузер заблокував доступ до буфера обміну.`,
    downloading: (filename) => `Завантажуємо ${filename}`,
    noResource: (type, id) => `У цьому документі немає ${type} з id ${id}.`,
    filterCleared: (type) => `Показано всі типи, щоб дістатися до ${type}.`,
    pointerGone: (pointer) => `За ${pointer} більше нічого немає.`,
    notStored: "Цей документ не вдалося зберегти, тож перезавантаження його втратить.",
    noPage: (pathname) => `За адресою ${pathname} сторінки немає.`,
    noDocument: "Жодного документа не завантажено. Вставте документ, щоб почати.",
  },

  copyKinds: {
    json: "JSON",
    document: "документ",
    value: "значення",
    pointer: "JSON Pointer",
    deepLink: "глибоке посилання",
    shareLink: "спільне посилання",
    resource: (type, id) => `${type} ${id}`,
  },

  parseErrors: {
    empty: {
      headline: "Нема чого розбирати.",
      hint: "Вставте документ JSON:API у поле вище.",
    },
    nothingYet: {
      headline: "Поки нема чого читати.",
      hint: "Вставте документ JSON:API або перетягніть файл.",
    },
    pythonDict: {
      headline: "Це схоже на Python-dict, а не на JSON.",
      hint: "Ключі в одинарних лапках і `None`/`True` не є коректним JSON. Виведіть його заново через `json.dumps(...)`.",
    },
    notJsonStart: {
      headline: "Це починається не як JSON.",
      hint: "Документ JSON:API починається з `{`. Якщо ви скопіювали рядок логу, приберіть усе до першої `{`.",
    },
    invalidJson: {
      headline: "Це некоректний JSON.",
      hint: (detail) => `Парсер зупинився тут: ${detail}`,
    },
    bareArray: {
      headline: "Це голий масив JSON, а не документ JSON:API.",
      hint: 'Документ JSON:API — це об’єкт із ключем `data` на верхньому рівні. Загорніть масив: `{ "data": [...] }`.',
    },
    doubleEncoded: {
      headline: "Це рядок JSON, який містить JSON.",
      hint: "Payload закодовано двічі. Розгорніть зовнішній рядок і вставте внутрішній документ.",
    },
    wrongType: {
      headline: (what) => `Це JSON-${what}, а не документ JSON:API.`,
      hint: "Вставте все тіло відповіді — об’єкт із ключем `data`, `errors` або `meta` на верхньому рівні.",
    },
    notJsonApi: {
      headline: "Це коректний JSON, але не документ JSON:API.",
      hintKeys: (preview, more) =>
        `На верхньому рівні немає ані \`data\`, ані \`errors\`, ані \`meta\` — лише ${preview}${more ? ", …" : ""}. Якщо документ вкладено в один із них, вставте саме цю частину.`,
      hintEmpty:
        "Об’єкт порожній. Документу JSON:API потрібен щонайменше один із ключів `data`, `errors` або `meta`.",
    },
    dataAndErrors: {
      headline: "У цьому документі є і `data`, і `errors`.",
      hint: "Специфікація забороняє таке поєднання. Показати його все одно означало б хибно подати відповідь — перевірте, що саме сервер мав намір надіслати.",
    },
    unknown: {
      headline: "Під час читання цього документа щось пішло не так.",
    },
    fileUnreadable: {
      headline: "Не вдалося прочитати цей файл.",
      hint: "Спробуйте відкрити його й вставити вміст.",
    },
  },

  shareErrors: {
    createFailed: {
      headline: "Не вдалося створити спільне посилання.",
      serverStatus: (status) => `Сервер повернув ${f.n(status)}.`,
    },
    fetchFailed: {
      headline: "Не вдалося завантажити цей спільний документ.",
      network: "Мережевий запит не вдався. Перевірте з’єднання та спробуйте ще раз.",
    },
    gone: {
      headline: "Цього спільного документа більше немає.",
      hint: "Його або ніколи не створювали, або вже видалено.",
    },
    expired: {
      headline: "Строк дії цього посилання минув.",
      hint: "Спільні посилання видаляються, коли їхній строк дії завершується. Попросіть нове посилання.",
    },
    corruptShort: {
      headline: "Цей спільний документ пошкоджено.",
      hint: "Збережені дані закороткі, щоб бути коректним документом.",
    },
    wrongVersion: {
      headline: "Це посилання створила інша версія.",
      hint: (found, expected) =>
        `Воно використовує версію формату ${f.n(found)}, а ця збірка читає версію ${f.n(expected)}. Попросіть нове посилання.`,
    },
    undecryptable: {
      headline: "Не вдалося розшифрувати це посилання.",
      hint: "Ключ не підходить до цього документа. Якщо посилання скорочували, обробляв месенджер або його передруковували вручну, ключ, найімовірніше, хибний.",
    },
    corruptDeflate: {
      headline: "Цей спільний документ пошкоджено.",
      hint: "Його вдалося розшифрувати, але вміст не розпакувався.",
    },
    corruptPayload: {
      headline: "Цей спільний документ пошкоджено.",
      hint: "Його вдалося розшифрувати, але документа він не містить.",
    },
  },

  labels: {
    pastedDocument: "вставлений документ",
    storedDocument: "збережений документ",
    sharedDocument: (id) => `спільний документ ${f.n(id)}`,
  },
};
