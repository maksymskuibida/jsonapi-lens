/**
 * Rechtstexte, Deutsch.
 *
 * Dies ist die Fassung, die im Streitfall gelesen wird — von einer
 * Aufsichtsbehörde, einem Mitbewerber oder einer abmahnenden Kanzlei. Sie folgt
 * denselben Tatsachen wie die englische Fassung, verwendet aber die üblichen
 * deutschen Formulierungen, weil genau die erwartet werden.
 *
 * Kein Link zur OS-Plattform: Die Verordnung (EU) 524/2013 wurde aufgehoben,
 * die europäische OS-Plattform ist zum 20. Juli 2025 eingestellt worden.
 */

import { IDENTITY } from "./identity.js";
import type { LegalPages } from "./types.js";

const anschrift = [
  IDENTITY.name,
  IDENTITY.street,
  `${IDENTITY.postalCode} ${IDENTITY.city}`,
  "Deutschland",
];

export const legalDe: LegalPages = {
  updatedOn: "2026-08-18",
  updated: (date) => `Stand: ${date}`,
  placeholderWarning:
    "Die Anbieterangaben auf dieser Seite sind noch Platzhalter, die Seite ist damit rechtlich nicht wirksam. Bitte src/legal/identity.ts vor dem Deployment ausfüllen.",

  impressum: {
    title: "Impressum",
    lede: "Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).",
    sections: [
      {
        heading: "Diensteanbieter",
        blocks: [
          { kind: "lines", lines: anschrift },
          {
            kind: "p",
            text: "Dieses Angebot wird von einer selbstständig tätigen natürlichen Person betrieben. Es besteht keine Gesellschaft, kein Handelsregistereintrag und kein über die vorstehende Anschrift hinausgehender Sitz.",
          },
        ],
      },
      {
        heading: "Kontakt",
        blocks: [
          {
            kind: "pairs",
            rows: [
              ["E-Mail", IDENTITY.email],
              ...(IDENTITY.phone ? ([["Telefon", IDENTITY.phone]] as [string, string][]) : []),
            ],
          },
          {
            kind: "p",
            text: "Der schnellste Weg ist die E-Mail; sie wird an Werktagen gelesen. Anfragen sind auf Deutsch oder Englisch möglich.",
          },
        ],
      },
      ...(IDENTITY.vatId
        ? [
            {
              heading: "Umsatzsteuer",
              blocks: [
                {
                  kind: "pairs" as const,
                  rows: [
                    ["Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG", IDENTITY.vatId] as [
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
        heading: "Haftung für Inhalte",
        blocks: [
          {
            kind: "p",
            text: "Als Diensteanbieter bin ich gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG bin ich als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.",
          },
          {
            kind: "p",
            text: "Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen werde ich diese Inhalte umgehend entfernen.",
          },
        ],
      },
      {
        heading: "Haftung für Links",
        blocks: [
          {
            kind: "p",
            text: "Dieses Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte ich keinen Einfluss habe. Deshalb kann ich für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft; rechtswidrige Inhalte waren nicht erkennbar.",
          },
          {
            kind: "p",
            text: "Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen werde ich derartige Links umgehend entfernen.",
          },
        ],
      },
      {
        heading: "Urheberrecht",
        blocks: [
          {
            kind: "p",
            text: "Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung. Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.",
          },
          {
            kind: "p",
            text: "Der Quellcode dieser Anwendung ist gesondert unter der MIT-Lizenz veröffentlicht; für dessen Nutzung gilt diese Lizenz und nicht der vorstehende Absatz.",
          },
        ],
      },
      {
        heading: "Verbraucherstreitbeilegung",
        blocks: [
          {
            kind: "p",
            text: "Ich bin nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).",
          },
        ],
      },
    ],
  },

  privacy: {
    title: "Datenschutzerklärung",
    lede: "Informationen zur Verarbeitung personenbezogener Daten nach Art. 13 und 14 DSGVO.",
    sections: [
      {
        heading: "Kurz gefasst",
        blocks: [
          {
            kind: "note",
            text: "Dokumente, die Sie einfügen, öffnen oder speichern, verlassen Ihren Browser nicht. Sie werden auf Ihrem eigenen Gerät gelesen, indiziert und dargestellt und in der Datenbank Ihres Browsers gespeichert. Es gibt kein Nutzerkonto, keine Analyse, kein Tracking und keine Werbung, und es werden keine Cookies gesetzt. Die einzige Ausnahme ist die Funktion „Share-Link“, die Sie bewusst auslösen müssen — und selbst dann erhält der Server nur einen verschlüsselten Datensatz, den er nicht lesen kann.",
          },
        ],
      },
      {
        heading: "Verantwortlicher",
        blocks: [
          {
            kind: "p",
            text: "Verantwortlicher für die Datenverarbeitung auf dieser Website im Sinne der DSGVO ist:",
          },
          { kind: "lines", lines: anschrift },
          {
            kind: "pairs",
            rows: [
              ["E-Mail", IDENTITY.email],
              ...(IDENTITY.phone ? ([["Telefon", IDENTITY.phone]] as [string, string][]) : []),
            ],
          },
          {
            kind: "p",
            text: "Ein Datenschutzbeauftragter wurde nicht bestellt, da die Voraussetzungen des § 38 BDSG nicht vorliegen.",
          },
        ],
      },
      {
        heading: "Hosting und Server-Logdaten",
        blocks: [
          {
            kind: "p",
            text: "Diese Website wird auf Cloudflare Workers betrieben. Die Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA ist dabei Auftragsverarbeiterin auf Grundlage eines Auftragsverarbeitungsvertrags, der Bestandteil ihrer Standardbedingungen ist.",
          },
          {
            kind: "p",
            text: "Die Auslieferung einer Seite setzt die Verarbeitung Ihrer IP-Adresse voraus; der Abruf selbst wird kurzzeitig protokolliert. Verarbeitet werden:",
          },
          {
            kind: "list",
            items: [
              "IP-Adresse des anfragenden Endgeräts",
              "Datum und Uhrzeit des Abrufs",
              "der angefragte Pfad und der zurückgegebene HTTP-Status",
              "übertragene Datenmenge",
              "Browsertyp und -version sowie Betriebssystem",
              "Referrer-URL, soweit der Browser eine übermittelt",
            ],
          },
          {
            kind: "pairs",
            rows: [
              [
                "Rechtsgrundlage",
                "Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an einem zuverlässigen Betrieb und an der Abwehr von Missbrauch.",
              ],
              [
                "Speicherdauer",
                "Betriebsprotokolle werden für einen kurzen Zeitraum zur Fehlersuche vorgehalten und danach automatisch gelöscht. Eine Zusammenführung mit anderen Daten oder eine Profilbildung findet nicht statt.",
              ],
            ],
          },
        ],
      },
      {
        heading: "Datenübermittlung in Drittländer",
        blocks: [
          {
            kind: "p",
            text: "Cloudflare ist ein US-amerikanisches Unternehmen und betreibt ein weltweites Netz, sodass eine Verarbeitung auch außerhalb der Europäischen Union stattfinden kann. Die Übermittlung ist durch die Standardvertragsklauseln der Europäischen Kommission gemäß Art. 46 Abs. 2 lit. c DSGVO abgesichert; Cloudflare ist zudem nach dem EU-US Data Privacy Framework zertifiziert.",
          },
          {
            kind: "p",
            text: "Welche Daten Cloudflare in meinem Auftrag verarbeitet, beschreibt die eigene Datenschutzerklärung des Anbieters.",
          },
          { kind: "link", text: "cloudflare.com/privacypolicy", href: "https://www.cloudflare.com/privacypolicy/" },
        ],
      },
      {
        heading: "Speicherung auf Ihrem Endgerät",
        blocks: [
          {
            kind: "p",
            text: "Diese Website speichert Informationen auf Ihrem Endgerät; übermittelt wird davon nichts:",
          },
          {
            kind: "pairs",
            rows: [
              [
                "IndexedDB",
                "das Dokument, das Sie gerade lesen, sowie ausdrücklich gespeicherte Dokumente. Dabei kann es sich um mehrere Megabyte JSON handeln — deshalb nicht im localStorage.",
              ],
              [
                "localStorage",
                "drei Einstellungen: Farbschema, Sprache und die voreingestellte Gültigkeitsdauer für Share-Links.",
              ],
            ],
          },
          {
            kind: "p",
            text: "Sämtliche Speicherung ist unbedingt erforderlich, um den von Ihnen ausdrücklich gewünschten Dienst bereitzustellen. Eine Einwilligung ist daher nach § 25 Abs. 2 Nr. 2 TDDDG nicht erforderlich, und diese Website zeigt kein Cookie-Banner. Eine Nutzung zu Analyse- oder Wiedererkennungszwecken findet nicht statt; Cookies werden überhaupt nicht gesetzt.",
          },
          {
            kind: "p",
            text: "Die Kontrolle bleibt bei Ihnen: Wenn Sie die Websitedaten in Ihrem Browser löschen, sind sämtliche dieser Daten sofort entfernt. Zusätzlich bietet die Anwendung für jedes gespeicherte Dokument eine Löschfunktion.",
          },
        ],
      },
      {
        heading: "Share-Links",
        blocks: [
          {
            kind: "p",
            text: "Das Erstellen eines Share-Links ist die einzige Funktion, bei der Daten an den Server übermittelt werden — und sie wird ausschließlich durch Ihren Klick ausgelöst.",
          },
          {
            kind: "p",
            text: "Ihr Browser komprimiert das Dokument, erzeugt lokal einen Schlüssel und verschlüsselt das Dokument damit. Übertragen wird nur der verschlüsselte Datensatz. Der Schlüssel steht ausschließlich im Link und wird zu keinem Zeitpunkt an den Server gesendet; dieser speichert also einen Datensatz, den er nicht lesen kann. Beschreibende Angaben werden nicht mitgespeichert — kein Dateiname, keine Bezeichnung, keine Ressourcentypen —, sondern nur eine laufende Nummer, die Größe in Bytes und die von Ihnen gewählte Gültigkeitsdauer.",
          },
          {
            kind: "pairs",
            rows: [
              [
                "Rechtsgrundlage",
                "Art. 6 Abs. 1 lit. b DSGVO, da die Erstellung des Links der von Ihnen angeforderte Dienst ist, sowie Art. 6 Abs. 1 lit. f DSGVO für die zur Auslieferung erforderliche Speicherung.",
              ],
              [
                "Speicherdauer",
                "bis zum Ablauf der von Ihnen gewählten Gültigkeitsdauer; danach werden Datensatz und verschlüsselter Inhalt gelöscht. Ein Link ohne Ablauf bleibt bis zu einem Löschverlangen bestehen.",
              ],
              ["Empfänger", "Cloudflare als Auftragsverarbeiterin für die Speicherung in D1 und R2."],
            ],
          },
          {
            kind: "note",
            text: "Wer den Link besitzt, kann das Dokument entschlüsseln und lesen. Enthält Ihr Dokument personenbezogene Daten, behandeln Sie den Link genau wie das Dokument selbst. Übermitteln Sie darin personenbezogene Daten Dritter, sind dafür Sie und nicht ich verantwortlich.",
          },
        ],
      },
      {
        heading: "Schriftarten und Inhalte Dritter",
        blocks: [
          {
            kind: "p",
            text: "Die verwendeten Schriftarten werden von der eigenen Domain dieser Website ausgeliefert. Es werden keine Schriften, Skripte, Stylesheets oder Bilder von Servern Dritter nachgeladen; es geht also keine Anfrage mit Ihrer IP-Adresse an einen anderen Anbieter als den oben genannten Hoster.",
          },
          {
            kind: "p",
            text: "Es werden kein Analysedienst, kein Tag-Manager, kein Werbenetzwerk, keine Social-Media-Plugins und keine eingebetteten Videos eingesetzt.",
          },
        ],
      },
      {
        heading: "Kontaktaufnahme",
        blocks: [
          {
            kind: "p",
            text: "Wenn Sie mir an die oben genannte Adresse schreiben, werden Ihre Nachricht und die darin enthaltenen Angaben zur Bearbeitung Ihres Anliegens verarbeitet und so lange gespeichert, wie dies dafür erforderlich ist, zuzüglich etwaiger gesetzlicher Aufbewahrungsfristen.",
          },
          {
            kind: "pairs",
            rows: [
              [
                "Rechtsgrundlage",
                "Art. 6 Abs. 1 lit. b DSGVO, soweit Ihre Anfrage einen Vertrag betrifft, im Übrigen Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Beantwortung von Anfragen.",
              ],
            ],
          },
        ],
      },
      {
        heading: "Ihre Rechte",
        blocks: [
          {
            kind: "p",
            text: "Hinsichtlich der Sie betreffenden Daten haben Sie das Recht auf:",
          },
          {
            kind: "list",
            items: [
              "Auskunft und Erhalt einer Kopie (Art. 15 DSGVO)",
              "Berichtigung unrichtiger Daten (Art. 16 DSGVO)",
              "Löschung (Art. 17 DSGVO)",
              "Einschränkung der Verarbeitung (Art. 18 DSGVO)",
              "Datenübertragbarkeit (Art. 20 DSGVO)",
              "Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter Interessen (Art. 21 DSGVO)",
            ],
          },
          {
            kind: "p",
            text: "Zur Ausübung genügt eine Nachricht an die oben genannte Adresse. Praktisch liegen hier ohnehin kaum Daten über Sie vor: Es gibt keine Nutzerkonten, und die von Ihnen bearbeiteten Dokumente werden nicht hochgeladen.",
          },
          {
            kind: "p",
            text: "Eine automatisierte Entscheidungsfindung oder ein Profiling im Sinne des Art. 22 DSGVO findet nicht statt.",
          },
        ],
      },
      {
        heading: "Beschwerderecht",
        blocks: [
          {
            kind: "p",
            text: "Sie haben das Recht, sich bei einer Aufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO). Die für mich zuständige Aufsichtsbehörde ist:",
          },
          { kind: "lines", lines: [IDENTITY.authority.name] },
          { kind: "link", text: IDENTITY.authority.url, href: IDENTITY.authority.url },
        ],
      },
      {
        heading: "Änderungen dieser Erklärung",
        blocks: [
          {
            kind: "p",
            text: "Diese Erklärung wird angepasst, sobald sich die Website in einer Weise ändert, die sie betrifft — etwa durch eine neue Funktion oder einen anderen Dienstleister. Das nachstehende Datum bezeichnet stets die aktuelle Fassung.",
          },
        ],
      },
    ],
  },
};
