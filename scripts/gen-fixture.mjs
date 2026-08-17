#!/usr/bin/env node
/**
 * Generate a large, structurally realistic JSON:API document for perf work.
 *
 *   node scripts/gen-fixture.mjs [includedCount] [outPath]
 *
 * Defaults to 50,000 included resources at fixtures/large-50k.json. The shape
 * mirrors a rail provider response: a page of trips whose segments point at
 * stations, which point at countries, plus fares, vehicles and carriers — so
 * the relationship graph is deep enough that resolution actually costs
 * something, and roughly 2% of pointers deliberately dangle.
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

const CITIES = [
  "Berlin", "Praha", "Wien", "Zürich", "Milano", "Lyon", "Barcelona", "Porto",
  "Kraków", "Budapest", "Ljubljana", "Zagreb", "București", "Sofia", "Thessaloniki",
  "København", "Göteborg", "Oslo", "Tampere", "Rīga", "Vilnius", "Tallinn",
  "Amsterdam", "Antwerpen", "Luxembourg", "Strasbourg", "Torino", "Napoli",
];

const COUNTRIES = [
  ["DE", "Germany", "EUR"], ["CZ", "Czechia", "CZK"], ["AT", "Austria", "EUR"],
  ["CH", "Switzerland", "CHF"], ["IT", "Italy", "EUR"], ["FR", "France", "EUR"],
  ["ES", "Spain", "EUR"], ["PT", "Portugal", "EUR"], ["PL", "Poland", "PLN"],
  ["HU", "Hungary", "HUF"], ["SI", "Slovenia", "EUR"], ["HR", "Croatia", "EUR"],
  ["RO", "Romania", "RON"], ["BG", "Bulgaria", "BGN"], ["GR", "Greece", "EUR"],
  ["DK", "Denmark", "DKK"], ["SE", "Sweden", "SEK"], ["NO", "Norway", "NOK"],
  ["FI", "Finland", "EUR"], ["LV", "Latvia", "EUR"], ["LT", "Lithuania", "EUR"],
  ["EE", "Estonia", "EUR"], ["NL", "Netherlands", "EUR"], ["BE", "Belgium", "EUR"],
  ["LU", "Luxembourg", "EUR"],
];

const CARRIERS = [
  ["db", "Deutsche Bahn"], ["cd", "České dráhy"], ["obb", "ÖBB"], ["sbb", "SBB"],
  ["trenitalia", "Trenitalia"], ["sncf", "SNCF"], ["renfe", "Renfe"], ["cp", "CP"],
  ["pkp", "PKP Intercity"], ["mav", "MÁV"], ["flix", "FlixTrain"], ["westbahn", "WESTbahn"],
];

const AMENITIES = ["wifi", "power_sockets", "bistro", "bicycle_spaces", "quiet_zone", "air_conditioning"];

/* Budget: the caller asks for a total `included` count, so split it across the
   types in fixed proportions rather than hardcoding per-type counts. */
const share = {
  segments: 0.34,
  stations: 0.2,
  fares: 0.28,
  vehicles: 0.11,
  carriers: 0.0,
  countries: 0.0,
};

const nStations = Math.max(2, Math.floor(included * share.stations));
const nSegments = Math.max(1, Math.floor(included * share.segments));
const nFares = Math.max(1, Math.floor(included * share.fares));
const nVehicles = Math.max(1, Math.floor(included * share.vehicles));
const nCountries = COUNTRIES.length;
const nCarriers = CARRIERS.length;

// Whatever the proportions leave over becomes extra segments.
const assigned = nStations + nSegments + nFares + nVehicles + nCountries + nCarriers;
const nSegmentsFinal = nSegments + Math.max(0, included - assigned);

// Trips are the primary data; each owns a few segments and fares.
const nTrips = Math.max(1, Math.floor(nSegmentsFinal / 3));

const pad = (n, width) => String(n).padStart(width, "0");
const stationId = (i) => `station-${pad(i, 6)}`;
const segmentId = (i) => `seg-${pad(i, 7)}`;
const fareId = (i) => `fare-${pad(i, 7)}`;
const vehicleId = (i) => `vehicle-${pad(i, 6)}`;
const tripId = (i) => `trip-${pad(i, 7)}`;

const DAY = 24 * 60 * 60 * 1000;
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
      requires_seat_reservation: random() < 0.4,
    },
    relationships: {
      default_carrier: { data: { type: "carriers", id: `carrier-${pick(CARRIERS)[0]}` } },
    },
  });
}

for (const [slug, name] of CARRIERS) {
  includedOut.push({
    type: "carriers",
    id: `carrier-${slug}`,
    attributes: {
      name,
      short_name: slug.toUpperCase(),
      support_url: `https://example.com/support/${slug}`,
      founded: `${int(1980, 2005)}-01-01`,
    },
    relationships: {
      home_country: { data: { type: "countries", id: pick(COUNTRIES)[0] } },
    },
  });
}

for (let i = 0; i < nStations; i++) {
  const city = pick(CITIES);
  includedOut.push({
    type: "stations",
    id: stationId(i),
    attributes: {
      name: `${city} ${pick(["Hauptbahnhof", "Centrale", "Central", "Hbf", "Nord", "Est"])}`,
      code: `${city.slice(0, 3).toUpperCase()}${pad(i % 1000, 3)}`,
      timezone: "Europe/Berlin",
      latitude: Number((40 + random() * 20).toFixed(6)),
      longitude: Number((-8 + random() * 32).toFixed(6)),
      wheelchair_accessible: random() < 0.75,
      platforms: int(2, 28),
      address: {
        street: `${pick(["Bahnhofstraße", "Via Roma", "Rue de la Gare", "Wilsonova"])} ${int(1, 240)}`,
        postal_code: pad(int(1000, 99999), 5),
        city,
        region: random() < 0.5 ? null : city,
      },
    },
    relationships: {
      country: { data: { type: "countries", id: pick(COUNTRIES)[0] } },
      // ~2% of station pointers reference a station that was never sent.
      connected_stations: {
        data: Array.from({ length: int(0, 3) }, () =>
          random() < 0.02
            ? { type: "stations", id: `station-absent-${pad(int(0, 9999), 6)}` }
            : { type: "stations", id: stationId(int(0, nStations - 1)) },
        ),
      },
    },
  });
}

for (let i = 0; i < nVehicles; i++) {
  includedOut.push({
    type: "vehicles",
    id: vehicleId(i),
    attributes: {
      kind: pick(["train", "coach", "ferry"]),
      model: pick(["Siemens Vectron", "Railjet", "Frecciarossa 1000", "TGV Duplex", "Stadler FLIRT"]),
      has_wifi: random() < 0.8,
      coaches: int(3, 14),
      quiet_zone: random() < 0.5,
    },
    relationships: {
      operator: { data: { type: "carriers", id: `carrier-${pick(CARRIERS)[0]}` } },
    },
  });
}

for (let i = 0; i < nSegmentsFinal; i++) {
  const depart = int(0, 14 * 24 * 60);
  includedOut.push({
    type: "segments",
    id: segmentId(i),
    attributes: {
      sequence: (i % 3) + 1,
      departure_time: isoAt(depart),
      arrival_time: isoAt(depart + int(35, 320)),
      platform: String(int(1, 24)),
      distance_km: Number((30 + random() * 600).toFixed(1)),
      service_number: `${pick(["EC", "IC", "RJ", "TGV", "FR"])} ${int(100, 9999)}`,
    },
    relationships: {
      origin_station: { data: { type: "stations", id: stationId(int(0, nStations - 1)) } },
      destination_station: {
        data:
          random() < 0.02
            ? { type: "stations", id: `station-absent-${pad(int(0, 9999), 6)}` }
            : { type: "stations", id: stationId(int(0, nStations - 1)) },
      },
      vehicle: { data: { type: "vehicles", id: vehicleId(int(0, nVehicles - 1)) } },
      operating_carrier: { data: { type: "carriers", id: `carrier-${pick(CARRIERS)[0]}` } },
      trip: { data: { type: "trips", id: tripId(i % nTrips) } },
    },
  });
}

for (let i = 0; i < nFares; i++) {
  includedOut.push({
    type: "fares",
    id: fareId(i),
    attributes: {
      name: pick(["Standard", "Flexible", "Super Saver", "Business", "Youth"]),
      class: pick(["first", "second"]),
      refundable: random() < 0.3,
      changeable: random() < 0.6,
      change_fee: random() < 0.2 ? null : { amount: int(0, 4000), currency: "EUR" },
      baggage_allowance: { pieces: int(1, 3), max_weight_kg: int(20, 32) },
    },
    relationships: {
      trip: { data: { type: "trips", id: tripId(i % nTrips) } },
    },
  });
}

const data = [];
for (let i = 0; i < nTrips; i++) {
  const depart = int(0, 14 * 24 * 60);
  const duration = int(60, 600);
  data.push({
    type: "trips",
    id: tripId(i),
    attributes: {
      name: `${pick(CITIES)} → ${pick(CITIES)}`,
      departure_time: isoAt(depart),
      arrival_time: isoAt(depart + duration),
      duration_minutes: duration,
      changes: int(0, 3),
      bookable: random() < 0.9,
      available_seats: int(0, 220),
      cancellation_policy: random() < 0.5 ? null : pick(["non_refundable", "flexible"]),
      amenities: AMENITIES.filter(() => random() < 0.5),
      price: { amount: int(900, 24900), currency: "EUR", fractional_digits: 2 },
    },
    relationships: {
      segments: {
        data: [0, 1, 2]
          .map((k) => i * 3 + k)
          .filter((k) => k < nSegmentsFinal)
          .map((k) => ({ type: "segments", id: segmentId(k) })),
      },
      fares: {
        data: [0, 1]
          .map((k) => i * 2 + k)
          .filter((k) => k < nFares)
          .map((k) => ({ type: "fares", id: fareId(k) })),
      },
      marketing_carrier: { data: { type: "carriers", id: `carrier-${pick(CARRIERS)[0]}` } },
      booking: { data: null },
      seat_map: { links: { related: `https://api.example.com/v2/trips/${tripId(i)}/seat-map` } },
    },
  });
}

const doc = {
  jsonapi: { version: "1.1" },
  links: { self: "https://api.example.com/v2/trips?include=segments.origin_station.country" },
  meta: {
    request_id: "perf-fixture",
    generated_at: new Date(BASE - DAY).toISOString(),
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
console.log(`  primary data : ${data.length.toLocaleString()} trips`);
console.log(`  included     : ${includedOut.length.toLocaleString()}`);
for (const [type, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type.padEnd(12)} ${n.toLocaleString()}`);
}
console.log(`  total resources: ${(data.length + includedOut.length).toLocaleString()}`);
console.log(`  size           : ${(json.length / 1024 / 1024).toFixed(2)} MB`);
