#!/usr/bin/env node
/**
 * Generate a large, structurally realistic JSON:API document for perf work.
 *
 *   node scripts/gen-fixture.mjs [includedCount] [outPath]
 *
 * Defaults to 50,000 included resources at fixtures/large-50k.json. The shape is
 * a paginated article feed: articles whose comments point at people, who point
 * at organizations, which point at countries — deep enough that relationship
 * resolution actually costs something. Roughly 2% of pointers deliberately
 * dangle, so the unresolved-pointer path gets exercised at scale too.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const included = Number(process.argv[2] ?? 50_000);
const outPath = resolve(process.argv[3] ?? "fixtures/large-50k.json");

if (!Number.isFinite(included) || included < 1) {
  console.error("First argument must be a positive resource count.");
  process.exit(1);
}

/* Deterministic PRNG so successive runs produce byte-identical fixtures and
   perf comparisons are not chasing generator noise. */
let seed = 0x9e3779b9;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
}

const pick = (list) => list[Math.floor(random() * list.length)];
const int = (min, max) => min + Math.floor(random() * (max - min + 1));

const GIVEN = [
  "Ada", "Grace", "Alan", "Barbara", "Edsger", "Katherine", "Donald", "Radia",
  "Tim", "Frances", "Ken", "Margaret", "Dennis", "Adele", "Linus", "Jean",
  "Guido", "Sophie", "Rich", "Anita", "Bjarne", "Karen", "Vint", "Shafi",
];

const FAMILY = [
  "Lovelace", "Hopper", "Turing", "Liskov", "Dijkstra", "Johnson", "Knuth",
  "Perlman", "Berners-Lee", "Allen", "Thompson", "Hamilton", "Ritchie",
  "Goldberg", "Torvalds", "Bartik", "Rossum", "Wilson", "Stallman", "Borg",
];

const ORGS = [
  ["acme", "Acme Research"], ["globex", "Globex Corporation"],
  ["initech", "Initech"], ["umbrella", "Umbrella Analytics"],
  ["hooli", "Hooli Labs"], ["soylent", "Soylent Media"],
  ["cyberdyne", "Cyberdyne Systems"], ["stark", "Stark Industries"],
  ["wayne", "Wayne Enterprises"], ["tyrell", "Tyrell Corporation"],
  ["aperture", "Aperture Science"], ["blackmesa", "Black Mesa"],
];

const COUNTRIES = [
  ["GB", "United Kingdom", "GBP"], ["US", "United States", "USD"],
  ["DE", "Germany", "EUR"], ["FR", "France", "EUR"], ["JP", "Japan", "JPY"],
  ["BR", "Brazil", "BRL"], ["IN", "India", "INR"], ["CA", "Canada", "CAD"],
  ["AU", "Australia", "AUD"], ["ZA", "South Africa", "ZAR"],
  ["SE", "Sweden", "SEK"], ["PL", "Poland", "PLN"], ["ES", "Spain", "EUR"],
  ["IT", "Italy", "EUR"], ["NL", "Netherlands", "EUR"], ["KR", "South Korea", "KRW"],
  ["MX", "Mexico", "MXN"], ["NG", "Nigeria", "NGN"], ["EG", "Egypt", "EGP"],
  ["AR", "Argentina", "ARS"], ["ID", "Indonesia", "IDR"], ["TR", "Turkey", "TRY"],
  ["CZ", "Czechia", "CZK"], ["PT", "Portugal", "EUR"], ["FI", "Finland", "EUR"],
];

const TOPICS = [
  "parsers", "indexes", "caching", "rendering", "protocols", "typography",
  "storage", "scheduling", "compilers", "queues", "graphs", "encodings",
];

const KEYWORDS = ["json-api", "tooling", "graphs", "browsers", "performance", "specs"];

/* Budget: the caller asks for a total `included` count, so split it across the
   types in fixed proportions rather than hardcoding per-type counts. */
const nPeople = Math.max(2, Math.floor(included * 0.2));
const nTags = Math.max(1, Math.floor(included * 0.11));
const nCountries = COUNTRIES.length;
const nOrgs = ORGS.length;

const baseComments = Math.max(1, Math.floor(included * 0.62));
const assigned = nPeople + nTags + nCountries + nOrgs + baseComments;
// Whatever the proportions leave over becomes extra comments.
const nComments = baseComments + Math.max(0, included - assigned);

// Articles are the primary data; each owns a few comments and tags.
const nArticles = Math.max(1, Math.floor(nComments / 3));

const pad = (n, width) => String(n).padStart(width, "0");
const personId = (i) => `per-${pad(i, 6)}`;
const commentId = (i) => `cmt-${pad(i, 7)}`;
const tagId = (i) => `tag-${pad(i, 6)}`;
const articleId = (i) => `art-${pad(i, 7)}`;

const BASE = Date.parse("2026-09-14T05:00:00Z");
const isoAt = (minutes) => new Date(BASE + minutes * 60_000).toISOString();

const includedOut = [];

for (const [code, name, currency] of COUNTRIES) {
  includedOut.push({
    type: "countries",
    id: code,
    attributes: {
      name,
      iso_alpha2: code,
      currency,
      default_locale: `${code.toLowerCase()}-${code}`,
    },
    relationships: {
      primary_organization: { data: { type: "organizations", id: `org-${pick(ORGS)[0]}` } },
    },
  });
}

for (const [slug, name] of ORGS) {
  includedOut.push({
    type: "organizations",
    id: `org-${slug}`,
    attributes: {
      name,
      short_name: slug,
      support_url: `https://example.com/support/${slug}`,
      founded: `${int(1980, 2015)}-01-01`,
      employee_count: int(12, 4200),
    },
    relationships: {
      country: { data: { type: "countries", id: pick(COUNTRIES)[0] } },
    },
  });
}

for (let i = 0; i < nPeople; i++) {
  const given = pick(GIVEN);
  const family = pick(FAMILY);
  includedOut.push({
    type: "people",
    id: personId(i),
    attributes: {
      name: `${given} ${family}`,
      handle: `${given.toLowerCase()}${pad(i % 10000, 4)}`,
      email: `${given.toLowerCase()}.${family.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
      joined: `${int(2019, 2026)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
      verified: random() < 0.7,
      comment_count: int(0, 480),
      profile: {
        location: pick(["London", "Berlin", "Tokyo", "São Paulo", "Toronto", "Kraków"]),
        timezone: "Europe/London",
        website: random() < 0.4 ? null : `https://example.com/~${given.toLowerCase()}${i}`,
        pronouns: random() < 0.5 ? null : pick(["she/her", "he/him", "they/them"]),
      },
    },
    relationships: {
      employer: { data: { type: "organizations", id: `org-${pick(ORGS)[0]}` } },
      // ~2% of these reference a person who was never sent.
      follows: {
        data: Array.from({ length: int(0, 3) }, () =>
          random() < 0.02
            ? { type: "people", id: `per-absent-${pad(int(0, 9999), 6)}` }
            : { type: "people", id: personId(int(0, nPeople - 1)) },
        ),
      },
    },
  });
}

for (let i = 0; i < nTags; i++) {
  const topic = pick(TOPICS);
  includedOut.push({
    type: "tags",
    id: tagId(i),
    attributes: {
      name: `${topic[0].toUpperCase()}${topic.slice(1)} ${i}`,
      slug: `${topic}-${i}`,
      article_count: int(1, 900),
      featured: random() < 0.1,
    },
    relationships: {
      articles: { data: [{ type: "articles", id: articleId(i % nArticles) }] },
    },
  });
}

for (let i = 0; i < nComments; i++) {
  const created = int(0, 14 * 24 * 60);
  includedOut.push({
    type: "comments",
    id: commentId(i),
    attributes: {
      body: `Comment ${i} about ${pick(TOPICS)}. ${pick(["Useful.", "Not sure about this.", "Agreed.", "Needs a citation.", "This matches what I measured."])}`,
      created_at: isoAt(created),
      edited_at: random() < 0.3 ? isoAt(created + int(1, 500)) : null,
      score: int(-4, 120),
      edited: random() < 0.3,
      flagged: random() < 0.05,
    },
    relationships: {
      author: {
        data:
          random() < 0.02
            ? { type: "people", id: `per-absent-${pad(int(0, 9999), 6)}` }
            : { type: "people", id: personId(int(0, nPeople - 1)) },
      },
      article: { data: { type: "articles", id: articleId(i % nArticles) } },
      in_reply_to:
        random() < 0.35
          ? { data: { type: "comments", id: commentId(int(0, nComments - 1)) } }
          : { data: null },
    },
  });
}

const data = [];
for (let i = 0; i < nArticles; i++) {
  const published = int(0, 14 * 24 * 60);
  data.push({
    type: "articles",
    id: articleId(i),
    attributes: {
      title: `On ${pick(TOPICS)} and ${pick(TOPICS)} (${i})`,
      slug: `on-${pick(TOPICS)}-${i}`,
      published_at: isoAt(published),
      updated_at: isoAt(published + int(10, 6000)),
      reading_minutes: int(2, 40),
      revision: int(1, 12),
      published: random() < 0.9,
      word_count: int(200, 9000),
      retracted_reason: random() < 0.5 ? null : pick(["superseded", "duplicate"]),
      keywords: KEYWORDS.filter(() => random() < 0.5),
      metrics: {
        views: int(10, 90000),
        shares: int(0, 900),
        average_scroll_depth: Number(random().toFixed(2)),
      },
    },
    relationships: {
      comments: {
        data: [0, 1, 2]
          .map((k) => i * 3 + k)
          .filter((k) => k < nComments)
          .map((k) => ({ type: "comments", id: commentId(k) })),
      },
      tags: {
        data: [0, 1]
          .map((k) => i * 2 + k)
          .filter((k) => k < nTags)
          .map((k) => ({ type: "tags", id: tagId(k) })),
      },
      author: { data: { type: "people", id: personId(int(0, nPeople - 1)) } },
      retraction: { data: null },
      revisions: { links: { related: `https://api.example.com/v2/articles/${articleId(i)}/revisions` } },
    },
  });
}

const doc = {
  jsonapi: { version: "1.1" },
  links: { self: "https://api.example.com/v2/articles?include=comments.author.employer.country" },
  meta: {
    request_id: "perf-fixture",
    generated_at: new Date(BASE - 86400000).toISOString(),
    page: { offset: 0, limit: data.length, total: data.length },
  },
  data,
  included: includedOut,
};

const json = JSON.stringify(doc);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json);

const byType = includedOut.reduce((acc, r) => {
  acc[r.type] = (acc[r.type] ?? 0) + 1;
  return acc;
}, {});

console.log(`Wrote ${outPath}`);
console.log(`  primary data : ${data.length.toLocaleString()} articles`);
console.log(`  included     : ${includedOut.length.toLocaleString()}`);
for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type.padEnd(14)} ${n.toLocaleString()}`);
}
console.log(`  total resources: ${(data.length + includedOut.length).toLocaleString()}`);
console.log(`  size           : ${(json.length / 1024 / 1024).toFixed(2)} MB`);
