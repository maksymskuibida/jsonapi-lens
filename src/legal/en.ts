/**
 * Legal pages, English.
 *
 * Two things here are deliberate and easy to "fix" wrongly later:
 *
 *  - **The title keeps the word Impressum** even in English. § 5 DDG wants the
 *    provider information to be *leicht erkennbar*, and the case law grew up
 *    around that specific word; a German visitor scanning an English page looks
 *    for it. The prose around it is English because the site is.
 *  - **There is no ODR platform link.** Regulation (EU) 524/2013 was repealed
 *    and the European ODR platform shut down on 20 July 2025. Most Impressum
 *    templates still carry that link; it now points at nothing.
 */

import { IDENTITY } from "./identity.js";
import type { LegalPages } from "./types.js";

const address = [
  IDENTITY.name,
  IDENTITY.street,
  `${IDENTITY.postalCode} ${IDENTITY.city}`,
  "Germany",
];

export const legalEn: LegalPages = {
  updatedOn: "2026-08-18",
  updated: (date) => `Last updated ${date}`,
  placeholderWarning:
    "The provider details on this page are still placeholders, so it is not yet legally valid. Fill in src/legal/identity.ts before deploying.",

  impressum: {
    title: "Legal Notice (Impressum)",
    lede: "Provider information under § 5 DDG (Digitale-Dienste-Gesetz).",
    sections: [
      {
        heading: "Provider",
        blocks: [
          { kind: "lines", lines: address },
          {
            kind: "p",
            text: "This site is operated by a self-employed individual. There is no company, no commercial register entry and no registered office beyond the address above.",
          },
        ],
      },
      {
        heading: "Contact",
        blocks: [
          {
            kind: "pairs",
            rows: [
              ["Email", IDENTITY.email],
              ...(IDENTITY.phone ? ([["Phone", IDENTITY.phone]] as [string, string][]) : []),
            ],
          },
          {
            kind: "p",
            text: "Email is the fastest route and is read on working days. Please write in English or German.",
          },
        ],
      },
      ...(IDENTITY.vatId
        ? [
            {
              heading: "VAT",
              blocks: [
                {
                  kind: "pairs" as const,
                  rows: [
                    ["VAT identification number under § 27a UStG", IDENTITY.vatId] as [
                      string,
                      string,
                    ],
                  ],
                },
              ],
            },
          ]
        : []),
      {
        heading: "Liability for content",
        blocks: [
          {
            kind: "p",
            text: "As a service provider I am responsible for my own content on these pages under general law (§ 7 (1) DDG). Under §§ 8 to 10 DDG, however, I am not obliged to monitor transmitted or stored third-party information, or to investigate circumstances that indicate unlawful activity.",
          },
          {
            kind: "p",
            text: "Obligations to remove or block the use of information under general law remain unaffected. Liability in this respect begins only from the point at which a concrete infringement becomes known. If I become aware of such infringements, I will remove the content promptly.",
          },
        ],
      },
      {
        heading: "Liability for links",
        blocks: [
          {
            kind: "p",
            text: "This site links to external websites over which I have no control. I therefore accept no responsibility for their content. The provider or operator of a linked site is always responsible for its content. Linked pages were checked for legal violations at the time of linking, and no unlawful content was apparent.",
          },
          {
            kind: "p",
            text: "Permanent monitoring of linked pages is not reasonable without concrete evidence of an infringement. If I become aware of legal violations, I will remove such links promptly.",
          },
        ],
      },
      {
        heading: "Copyright",
        blocks: [
          {
            kind: "p",
            text: "The content of this site is subject to German copyright law. Reproduction, adaptation, distribution and any form of exploitation beyond the limits of copyright require written consent. Downloads and copies of this page are permitted for private, non-commercial use.",
          },
          {
            kind: "p",
            text: "The source code of this application is published separately under the MIT licence, which governs its use rather than this notice.",
          },
        ],
      },
      {
        heading: "Consumer dispute resolution",
        blocks: [
          {
            kind: "p",
            text: "I am neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board (§ 36 VSBG).",
          },
        ],
      },
    ],
  },

  privacy: {
    title: "Privacy Policy (Datenschutzerklärung)",
    lede: "How this site handles personal data, under Articles 13 and 14 GDPR.",
    sections: [
      {
        heading: "The short version",
        blocks: [
          {
            kind: "note",
            text: "Documents you paste, open or save never leave your browser. They are parsed, indexed and rendered on your own machine and stored in your browser's own database. There is no account, no analytics, no tracking and no advertising, and this site sets no cookies. The one exception is the share link feature, which you have to invoke deliberately — and even then the server receives ciphertext it cannot read.",
          },
        ],
      },
      {
        heading: "Controller",
        blocks: [
          {
            kind: "p",
            text: "The controller responsible for data processing on this site within the meaning of the GDPR is:",
          },
          { kind: "lines", lines: address },
          {
            kind: "pairs",
            rows: [
              ["Email", IDENTITY.email],
              ...(IDENTITY.phone ? ([["Phone", IDENTITY.phone]] as [string, string][]) : []),
            ],
          },
          {
            kind: "p",
            text: "No data protection officer has been appointed, because the conditions of § 38 BDSG are not met.",
          },
        ],
      },
      {
        heading: "Hosting and server log data",
        blocks: [
          {
            kind: "p",
            text: "This site is hosted on Cloudflare Workers. Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA acts as a processor under a data processing agreement that forms part of its standard terms.",
          },
          {
            kind: "p",
            text: "Delivering a page necessarily involves your IP address, and the request itself is recorded briefly in operational logs. The data processed is:",
          },
          {
            kind: "list",
            items: [
              "IP address of the requesting device",
              "Date and time of the request",
              "The path requested and the HTTP status returned",
              "Amount of data transferred",
              "Browser type and version, and operating system",
              "Referring URL, where the browser sends one",
            ],
          },
          {
            kind: "pairs",
            rows: [
              [
                "Legal basis",
                "Art. 6 (1) (f) GDPR — a legitimate interest in delivering the site reliably and defending it against abuse.",
              ],
              [
                "Retention",
                "Operational logs are kept for a short period for troubleshooting and are then deleted automatically. They are not combined with any other data and are not used to build a profile.",
              ],
            ],
          },
        ],
      },
      {
        heading: "Transfers outside the EU",
        blocks: [
          {
            kind: "p",
            text: "Cloudflare is a US company and operates a global network, so processing can take place outside the European Union. Transfers are covered by the European Commission's Standard Contractual Clauses under Art. 46 (2) (c) GDPR, and Cloudflare is certified under the EU–US Data Privacy Framework.",
          },
          {
            kind: "p",
            text: "Cloudflare's own privacy policy describes what it does with the data it processes on my behalf.",
          },
          { kind: "link", text: "cloudflare.com/privacypolicy", href: "https://www.cloudflare.com/privacypolicy/" },
        ],
      },
      {
        heading: "Storage in your browser",
        blocks: [
          {
            kind: "p",
            text: "This site stores information on your device, and none of it is transmitted anywhere:",
          },
          {
            kind: "pairs",
            rows: [
              [
                "IndexedDB",
                "The document you are currently reading, and any documents you explicitly save. These can be megabytes of JSON, which is why they are not in localStorage.",
              ],
              [
                "localStorage",
                "Three preferences: your theme, your language, and the default lifetime for share links.",
              ],
            ],
          },
          {
            kind: "p",
            text: "All of it is strictly necessary to provide the service you asked for, so no consent is required under § 25 (2) no. 2 TDDDG and this site shows no cookie banner. Nothing here is used for analytics or recognition, and no cookies are set at all.",
          },
          {
            kind: "p",
            text: "You remain in control: clearing this site's data in your browser deletes all of it immediately, and the app itself offers a delete action for each saved document.",
          },
        ],
      },
      {
        heading: "Share links",
        blocks: [
          {
            kind: "p",
            text: "Creating a share link is the only feature that sends anything to the server, and it happens only when you click the button.",
          },
          {
            kind: "p",
            text: "Your browser compresses the document, generates an encryption key locally and encrypts the document with it. Only the ciphertext is uploaded. The key is placed in the link itself and is never sent in a request, so the server holds a blob it has no way to read. Nothing descriptive is stored alongside it — no filename, no label, no resource types — only a numeric id, the size in bytes and the expiry you chose.",
          },
          {
            kind: "pairs",
            rows: [
              [
                "Legal basis",
                "Art. 6 (1) (b) GDPR, since creating the link is the service you requested; and Art. 6 (1) (f) GDPR for the storage needed to serve it.",
              ],
              [
                "Retention",
                "Until the lifetime you chose runs out, at which point the record and the ciphertext are deleted. A link with no expiry is kept until deletion is requested.",
              ],
              [
                "Recipients",
                "Cloudflare, as processor, for storage in D1 and R2.",
              ],
            ],
          },
          {
            kind: "note",
            text: "Anyone holding a share link can decrypt and read the document. If your payload contains personal data, treat the link exactly as you would treat the payload — and if you are sending someone else's personal data, remember that you are the controller for it, not me.",
          },
        ],
      },
      {
        heading: "Fonts and third-party content",
        blocks: [
          {
            kind: "p",
            text: "The typefaces are served from this site's own domain. No fonts, scripts, stylesheets or images are loaded from third-party servers, so no request carrying your IP address goes to any provider other than the host named above.",
          },
          {
            kind: "p",
            text: "There is no analytics service, no tag manager, no advertising network, no social media plugin and no embedded video.",
          },
        ],
      },
      {
        heading: "Contacting me",
        blocks: [
          {
            kind: "p",
            text: "If you write to the address above, your message and the details it contains are processed to handle your enquiry and are kept for as long as it takes to deal with it, plus any statutory retention period that applies.",
          },
          {
            kind: "pairs",
            rows: [
              [
                "Legal basis",
                "Art. 6 (1) (b) GDPR where your enquiry concerns a contract, otherwise Art. 6 (1) (f) GDPR — a legitimate interest in answering the people who write to me.",
              ],
            ],
          },
        ],
      },
      {
        heading: "Your rights",
        blocks: [
          {
            kind: "p",
            text: "In respect of data concerning you, you have the right to:",
          },
          {
            kind: "list",
            items: [
              "access that data and receive a copy of it (Art. 15 GDPR)",
              "have inaccurate data corrected (Art. 16 GDPR)",
              "have data erased (Art. 17 GDPR)",
              "have processing restricted (Art. 18 GDPR)",
              "receive your data in a portable format (Art. 20 GDPR)",
              "object to processing based on legitimate interests (Art. 21 GDPR)",
            ],
          },
          {
            kind: "p",
            text: "To exercise any of these, write to the address above. In practice very little data about you exists here to begin with — there are no accounts, and the documents you work with are never uploaded.",
          },
          {
            kind: "p",
            text: "No automated decision-making or profiling within the meaning of Art. 22 GDPR takes place on this site.",
          },
        ],
      },
      {
        heading: "Right to complain",
        blocks: [
          {
            kind: "p",
            text: "You have the right to lodge a complaint with a supervisory authority, in particular in the member state of your residence, place of work or the place of the alleged infringement (Art. 77 GDPR). The authority responsible for me is:",
          },
          { kind: "lines", lines: [IDENTITY.authority.name] },
          { kind: "link", text: IDENTITY.authority.url, href: IDENTITY.authority.url },
        ],
      },
      {
        heading: "Changes to this policy",
        blocks: [
          {
            kind: "p",
            text: "This policy is updated whenever the site changes in a way that affects it — a new feature, a different provider. The date below always reflects the current version.",
          },
        ],
      },
    ],
  },
};
