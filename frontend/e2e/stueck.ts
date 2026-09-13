/**
 * Ein Textbuch für die Prüfung – gebaut, nicht eingecheckt.
 *
 * Ein echtes Stück in das Repository zu legen ginge nicht: Theatertexte sind
 * geschützt, und zwar auch die, die man selbst gekauft hat. Also steht hier
 * kein PDF, sondern der Bauplan für eines. Der Text stammt aus dieser Datei,
 * ist für diesen Zweck geschrieben und fällt damit unter dieselbe Lizenz wie
 * der Rest des Projekts – niemandes Rechte, kein Blob in der Geschichte, und
 * bei jedem Lauf frisch erzeugt.
 *
 * Der zweite Vorteil wiegt schwerer: Wer das Stück baut, kennt die Wahrheit.
 * Die Prüfung muss nicht raten, ob „ungefähr genug“ Blöcke erkannt wurden –
 * sie weiß, dass es 78 Repliken und 18 Regieanweisungen sind, und welche
 * Rolle wie oft spricht. Ein Erkenner, der zwei Repliken verschluckt, fällt
 * damit auf.
 *
 * Gebaut werden zwei Satzarten, weil die App zwei kennt:
 *
 *   'spalten'  Sprechername in einer eigenen Spalte links, Text eingerückt
 *   'fett'     „NAME: Text“ in einer Zeile, der Name fett, Regie kursiv
 *
 * Dazu, was ein Textbuch sonst so hat und was die Erkennung stören kann:
 * Titelseite, Personenverzeichnis mit Einsatzzahlen, Akt- und Szenenzeilen,
 * Kolumnentitel und Seitenzahlen auf jeder Seite.
 *
 * Das PDF wird von Hand geschrieben (siehe unten) – eine Bibliothek dafür
 * wäre eine weitere Abhängigkeit für dreißig Zeilen Arbeit.
 */

export type Profil = 'spalten' | 'fett'

export interface Wahrheit {
  /** Wie das Stück heißt – steht im Kolumnentitel. */
  titel: string
  seiten: number
  /** Seiten, die kein Sprechtext sind: Titel, Personen. */
  vorspann: number
  /** Repliken je Rolle, so wie sie im Personenverzeichnis stehen. */
  einsaetze: Record<string, number>
  repliken: number
  regie: number
  /**
   * Repliken mit einem eingeklammerten Einschub.
   *
   * Sie entscheiden, wie viele Blöcke am Ende herauskommen: „als eigene
   * Blöcke“ macht aus einer solchen Replik drei (Text, Einschub, Text),
   * „entfernen“ und „im Text lassen“ lassen es bei einer.
   */
  einschuebe: number
  /**
   * Die erste Replik – an ihr prüft sich die Textübernahme.
   *
   * `seite` ist die Seitenzahl in der App (1-basiert, Vorspann mitgezählt),
   * `rahmen` ihr Platz auf der Seite in Anteilen der Seitengröße: genau die
   * Koordinaten, in denen der Editor rechnet. Damit zieht die Prüfung ihr
   * Rechteck nicht nach Gefühl, sondern dorthin, wo der Satz wirklich steht.
   */
  ersteReplik: {
    rolle: string
    text: string
    seite: number
    rahmen: { x: number; y: number; w: number; h: number }
  }
}

export interface Textbuch {
  pdf: Uint8Array
  wahrheit: Wahrheit
}

/* ----------------------------------------------------------- Der Inhalt */

const ROLLEN = ['WILHELM', 'MARLENE', 'DER NOTAR', 'FRAU BUSCH']

/**
 * Sätze, die nach Theater klingen und trotzdem niemandem gehören.
 *
 * Absichtlich mit dem, woran sich die Erkennung stoßen kann: Klammern mitten
 * im Sprechtext, ein Doppelpunkt, Zahlen, ein Gedankenstrich, ein Komma vor
 * „nicht wahr“. Kein Wort davon ist zitiert.
 */
const SAETZE = [
  'Guten Abend. Ich hatte nicht damit gerechnet, dass heute noch jemand kommt.',
  'Der Schlüssel lag unter dem Stein, wo er seit dreißig Jahren liegt.',
  'Sie sagen das so, als wäre es eine Kleinigkeit – für mich ist es keine.',
  'Setzen Sie sich doch. Der Stuhl am Fenster hat schon andere ausgehalten.',
  'Ich habe den Brief gelesen (zweimal sogar) und verstehe ihn immer noch nicht.',
  'Nein. Was ich zu sagen habe, sage ich im Stehen.',
  'Um Viertel nach acht war das Licht noch an, das kann ich beschwören.',
  'Wir hatten eine Abmachung, nicht wahr? Dann halten wir uns auch daran.',
  'Das Haus gehört seit 1912 der Familie, und dabei bleibt es.',
  'Reden Sie weiter, ich höre zu. Ich habe heute nichts Besseres vor.',
]

const REGIE = [
  'Er tritt ans Fenster und zieht den Vorhang beiseite.',
  'Sie legt das Buch weg und steht langsam auf.',
  'Von draußen hört man einen Wagen halten.',
  'Kurze Pause. Die Uhr im Flur schlägt.',
]

const AKTE = ['1. Akt', '2. Akt', '3. Akt']
const SZENEN = ['1. Szene', '2. Szene', '3. Szene', '4. Szene']

/* ------------------------------------------------------ Der Satzspiegel */

const BREITE = 420 // A5 quer gerechnet in Punkten
const HOEHE = 595
const RAND = 42
const ZEILE = 15

type Stueck = { art: 'text'; x: number; y: number; font: Font; text: string }
type Font = 'F1' | 'F2' | 'F3' // normal, fett, kursiv

/** Bricht einen Satz auf eine Breite um – grob, aber gleichmäßig. */
function umbrechen(text: string, zeichenProZeile: number): string[] {
  const woerter = text.split(' ')
  const zeilen: string[] = []
  let zeile = ''
  for (const wort of woerter) {
    if (zeile === '') zeile = wort
    else if (zeile.length + 1 + wort.length <= zeichenProZeile) zeile += ` ${wort}`
    else {
      zeilen.push(zeile)
      zeile = wort
    }
  }
  if (zeile !== '') zeilen.push(zeile)
  return zeilen
}

/**
 * Baut das Textbuch.
 *
 * `laenge` ist die Zahl der Sprechseiten; die Vorspannseiten kommen davor.
 * Klein halten: Jede Seite kostet die Erkennung Zeit, und geprüft wird der
 * Weg, nicht die Ausdauer.
 */
export function baueTextbuch(profil: Profil = 'fett', laenge = 6): Textbuch {
  const titel = profil === 'fett' ? 'Der Schlüssel unter dem Stein' : 'Das Haus am Deich'
  const seiten: Stueck[][] = []
  const einsaetze: Record<string, number> = Object.fromEntries(ROLLEN.map((r) => [r, 0]))
  let repliken = 0
  let regie = 0
  let einschuebe = 0
  let ersteReplik: Wahrheit['ersteReplik'] = {
    rolle: '',
    text: '',
    seite: 0,
    rahmen: { x: 0, y: 0, w: 0, h: 0 },
  }

  /* ---- Titelseite ---- */
  seiten.push([
    { art: 'text', x: RAND, y: HOEHE - 200, font: 'F2', text: titel },
    { art: 'text', x: RAND, y: HOEHE - 230, font: 'F1', text: 'Ein Stück in drei Akten' },
    { art: 'text', x: RAND, y: HOEHE - 260, font: 'F1', text: 'Prüfstück für den Theater-Vorleser' },
  ])

  /* ---- Personenverzeichnis (die Einsatzzahlen kommen unten dazu) ---- */
  const personenSeite: Stueck[] = [
    { art: 'text', x: RAND, y: HOEHE - 80, font: 'F2', text: 'Personen' },
  ]
  seiten.push(personenSeite)

  /* ---- Sprechseiten ---- */
  let n = 0
  for (let s = 0; s < laenge; s++) {
    const seite: Stueck[] = []
    let y = HOEHE - 70

    // Kolumnentitel und Seitenzahl: auf jeder Seite an derselben Stelle –
    // genau das, woran die Erkennung sie erkennt.
    seite.push({ art: 'text', x: RAND, y: HOEHE - 40, font: 'F1', text: titel })
    seite.push({ art: 'text', x: BREITE - RAND - 20, y: 30, font: 'F1', text: String(s + 3) })

    if (s % 2 === 0) {
      seite.push({ art: 'text', x: RAND, y, font: 'F2', text: AKTE[(s / 2) % AKTE.length] })
      y -= ZEILE * 2
    }
    seite.push({ art: 'text', x: RAND, y, font: 'F2', text: SZENEN[s % SZENEN.length] })
    y -= ZEILE * 2

    while (y > 70) {
      n++
      if (n % 6 === 0) {
        // Eine Regieanweisung, kursiv und ohne Sprecher.
        const text = REGIE[n % REGIE.length]
        for (const zeile of umbrechen(text, 58)) {
          seite.push({ art: 'text', x: RAND + 10, y, font: 'F3', text: zeile })
          y -= ZEILE
        }
        y -= 4
        regie++
        continue
      }

      const rolle = ROLLEN[n % ROLLEN.length]
      const satz = SAETZE[n % SAETZE.length]
      const merkeErste = ersteReplik.rolle === ''
      const yOben = y
      if (profil === 'fett') {
        // „NAME: Text …“ – der Name fett, alles in einer Spalte.
        const zeilen = umbrechen(satz, 52)
        seite.push({ art: 'text', x: RAND, y, font: 'F2', text: `${rolle}:` })
        seite.push({ art: 'text', x: RAND + 8 * rolle.length + 14, y, font: 'F1', text: zeilen[0] })
        y -= ZEILE
        for (const zeile of zeilen.slice(1)) {
          seite.push({ art: 'text', x: RAND + 12, y, font: 'F1', text: zeile })
          y -= ZEILE
        }
      } else {
        // Name links in eigener Spalte, Text eingerückt.
        const zeilen = umbrechen(satz, 42)
        seite.push({ art: 'text', x: RAND, y, font: 'F2', text: rolle })
        zeilen.forEach((zeile, i) => {
          seite.push({ art: 'text', x: RAND + 120, y: y - i * ZEILE, font: 'F1', text: zeile })
        })
        y -= ZEILE * zeilen.length
      }

      /*
       * Die erste Replik mit ihrem ganzen Platz merken – über alle Zeilen,
       * die sie belegt. Nur so zieht die Prüfung dasselbe Rechteck, das auch
       * die automatische Erkennung findet, und die Zahlen am Ende stimmen.
       */
      if (merkeErste) {
        ersteReplik = {
          rolle,
          text: satz,
          // Seitenzahl in der App: Titel und Personen zählen mit.
          seite: seiten.length + 1,
          rahmen: {
            x: (RAND - 8) / BREITE,
            y: (HOEHE - yOben - 10) / HOEHE,
            w: (BREITE - 2 * RAND + 16) / BREITE,
            h: (yOben - y + 8) / HOEHE,
          },
        }
      }

      y -= 5
      repliken++
      if (satz.includes('(')) einschuebe++
      einsaetze[rolle]++
    }
    seiten.push(seite)
  }

  /* ---- jetzt erst das Personenverzeichnis, mit den wahren Zahlen ---- */
  let py = HOEHE - 110
  for (const rolle of ROLLEN) {
    personenSeite.push({
      art: 'text',
      x: RAND,
      y: py,
      font: 'F1',
      // „Name (Zahl)“ – die Schreibweise, in der Verlage die Einsätze
      // angeben und die die App abgleicht.
      text: `${rolle} (${einsaetze[rolle]})`,
    })
    py -= ZEILE * 1.5
  }

  return {
    pdf: schreibePdf(seiten),
    wahrheit: {
      titel,
      seiten: seiten.length,
      vorspann: 2,
      einsaetze,
      repliken,
      regie,
      einschuebe,
      ersteReplik,
    },
  }
}

/* --------------------------------------------------------- Das PDF selbst */

/**
 * Ein PDF von Hand.
 *
 * Mehr als das braucht es hier nicht: drei Standardschriften, Text an festen
 * Stellen, eine Seite je Inhaltsstrom. Die Schriftnamen sind wichtig –
 * `Helvetica-Bold` und `Helvetica-Oblique` sind es, woran die Erkennung fett
 * und kursiv festmacht, wenn sie den Aufbau aus der Schrift lernt.
 */
function schreibePdf(seiten: Stueck[][]): Uint8Array {
  /*
   * WinAnsi ist fast Latin-1 – bis auf die typografischen Zeichen, die in
   * einem Textbuch überall stehen: Gedankenstrich, Auslassungspunkte,
   * deutsche Anführungszeichen. Die liegen in der Lücke von 0x80 bis 0x9F,
   * und ohne diese Tabelle stünde im Stück überall ein Fragezeichen.
   */
  const WINANSI: Record<string, number> = {
    '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85,
    '‹': 0x8b, '‘': 0x91, '’': 0x92, '“': 0x93,
    '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '›': 0x9b,
  }

  const enc = (s: string) => {
    const bytes: number[] = []
    for (const zeichen of s) {
      const wina = WINANSI[zeichen]
      if (wina !== undefined) {
        bytes.push(wina)
        continue
      }
      const code = zeichen.codePointAt(0) ?? 63
      bytes.push(code < 256 ? code : 63)
    }
    return bytes
  }

  const objekte: string[] = []
  const push = (inhalt: string) => {
    objekte.push(inhalt)
    return objekte.length // 1-basiert, wie die Objektnummern
  }

  const schutz = (s: string) => s.replace(/([\\()])/g, '\\$1')

  const seitenObjekte: number[] = []
  const inhaltObjekte: string[] = []
  for (const seite of seiten) {
    const zeilen = ['BT']
    let aktuell = ''
    for (const stueck of seite) {
      if (stueck.font !== aktuell) {
        zeilen.push(`/${stueck.font} 10 Tf`)
        aktuell = stueck.font
      }
      zeilen.push(`1 0 0 1 ${stueck.x.toFixed(1)} ${stueck.y.toFixed(1)} Tm`)
      zeilen.push(`(${schutz(stueck.text)}) Tj`)
    }
    zeilen.push('ET')
    inhaltObjekte.push(zeilen.join('\n'))
  }

  // Reihenfolge: Katalog, Seitenbaum, dann je Seite Seite + Inhalt, dann die
  // Schriften. Die Nummern stehen vorher fest, deshalb wird gezählt.
  const nKatalog = 1
  const nBaum = 2
  const nErsteSeite = 3
  for (let i = 0; i < seiten.length; i++) {
    seitenObjekte.push(nErsteSeite + i * 2)
  }
  const nSchriften = nErsteSeite + seiten.length * 2

  push(`<< /Type /Catalog /Pages ${nBaum} 0 R >>`)
  push(
    `<< /Type /Pages /Kids [${seitenObjekte.map((n) => `${n} 0 R`).join(' ')}] ` +
      `/Count ${seiten.length} >>`,
  )
  seiten.forEach((_, i) => {
    const nSeite = nErsteSeite + i * 2
    const nInhalt = nSeite + 1
    push(
      `<< /Type /Page /Parent ${nBaum} 0 R /MediaBox [0 0 ${BREITE} ${HOEHE}] ` +
        `/Resources << /Font << /F1 ${nSchriften} 0 R /F2 ${nSchriften + 1} 0 R ` +
        `/F3 ${nSchriften + 2} 0 R >> >> /Contents ${nInhalt} 0 R >>`,
    )
    const strom = inhaltObjekte[i]
    push(`<< /Length ${enc(strom).length} >>\nstream\n${strom}\nendstream`)
  })
  for (const name of ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique']) {
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)
  }

  const bytes: number[] = []
  const schreibe = (s: string) => bytes.push(...enc(s))
  schreibe('%PDF-1.4\n')
  const stellen: number[] = []
  objekte.forEach((inhalt, i) => {
    stellen.push(bytes.length)
    schreibe(`${i + 1} 0 obj\n${inhalt}\nendobj\n`)
  })
  const xref = bytes.length
  schreibe(`xref\n0 ${objekte.length + 1}\n`)
  schreibe('0000000000 65535 f \n')
  for (const stelle of stellen) schreibe(`${String(stelle).padStart(10, '0')} 00000 n \n`)
  schreibe(
    `trailer\n<< /Size ${objekte.length + 1} /Root ${nKatalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  )
  return new Uint8Array(bytes)
}
