/**
 * Die Einführung: was wo ist, beim ersten Mal von selbst.
 *
 * Wer ein Stück proben will, sieht zuerst eine leere Liste und danach ein PDF,
 * über das man Rechtecke ziehen soll – das ist niemandem anzusehen. Drei kurze
 * Touren erklären es dort, wo es passiert: in der Stückeliste, im Editor und
 * beim Proben.
 *
 * Eine Tour je Ansicht, und jede erklärt nur, was dort zu sehen ist. Der erste
 * Versuch ließ eine einzige Tour durch die Reiter wandern – wer im Lernmodus
 * auf das Fragezeichen drückte, landete zuerst bei den Sprechern. Hilfe muss
 * dort anfangen, wo man steht.
 *
 * Hier stehen nur die Texte und das Gedächtnis dafür, welche Tour schon lief.
 * Das Anzeigen macht components/Tour/Tour.tsx, das Auslösen die Seiten selbst –
 * jede weiß am besten, wann sie fertig aufgebaut ist.
 *
 * Keine fremde Bibliothek: intro.js steht seit Fassung 3 unter der AGPL und
 * würde dieses Projekt mitziehen, und die schwierige Hälfte – ein Kasten, der
 * neben einem Element steht und mitwandert – liegt ohnehin schon in Mantine.
 */

export type TourId = 'stuecke' | 'editor' | 'sprecher' | 'hoerfassung' | 'probe' | 'karten'

/** Die Reiter des Editors, so wie Tabs sie nennt. */
export type TabValue = 'editor' | 'speakers' | 'audio' | 'rehearsal' | 'cards'

export interface TourStep {
  /**
   * Woran der Kasten hängt: der Wert eines `data-tour`-Attributs. Fehlt das
   * Ziel auf der Seite, steht der Kasten in der Mitte – ein Schritt, dessen
   * Anker gerade nicht da ist, soll nicht die ganze Tour anhalten.
   */
  target?: string
  title: string
  text: string
  /** Nur auf Geräten mit Finger – oder nur auf denen mit Maus. */
  only?: 'touch' | 'desktop'
}

export interface Tour {
  id: TourId
  title: string
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'stuecke',
    title: 'Die Stückeliste',
    steps: [
      {
        target: 'neues-projekt',
        title: 'Ein Stück ist ein PDF',
        text: 'Lade das Textbuch hoch und gib ihm einen Namen. Alles Weitere passiert in diesem Browser – es gibt keinen Server, der etwas von deinem Stück erfährt.',
      },
      {
        target: 'sicherung',
        title: 'Die einzige Kopie bist du',
        text: 'Weil alles hier liegt, ist eine Sicherungskopie eine Datei. Sie überlebt einen aufgeräumten Browser und bringt ein Stück auf ein zweites Gerät.',
      },
      {
        target: 'technik',
        title: 'Wenn etwas klemmt',
        text: 'Die Technik-Prüfung sagt, was dieses Gerät kann, wie viel Platz da ist und ob die Daten liegen bleiben.',
      },
    ],
  },
  {
    id: 'editor',
    title: 'Blöcke markieren',
    steps: [
      {
        target: 'markieren',
        title: 'Erst „Markieren“, dann ziehen',
        text: 'Auf dem Telefon schiebt der Finger normalerweise die Seite. Mit diesem Knopf zieht er stattdessen ein Rechteck über eine Textzeile.',
        only: 'touch',
      },
      {
        target: 'pdf',
        title: 'Ein Rechteck über eine Zeile',
        text: 'Zieh ein Rechteck über eine Textzeile – der Text darin wird aus dem PDF übernommen. So ein Block ist eine Replik oder eine Regieanweisung; die Farbe zeigt, wer sie spricht.',
        only: 'desktop',
      },
      {
        target: 'erkennen',
        title: 'Den Rest macht die App',
        text: 'Zwei, drei Blöcke von Hand genügen. „Automatisch erkennen“ liest daran den Aufbau des Textbuchs ab und füllt das ganze Stück – mit Vorschau, bevor etwas übernommen wird.',
      },
      {
        target: 'blockliste',
        title: 'Die Liste der Blöcke',
        text: 'Hier stehen sie in Vorlese-Reihenfolge: antippen zum Bearbeiten, ziehen zum Sortieren, Papierkorb zum Löschen. Stimmt die Reihenfolge nicht, wird hier sortiert.',
      },
      {
        target: 'reiter',
        title: 'Weiter geht es oben',
        text: 'Als Nächstes der Reiter „Sprecher“. Jeder Reiter erklärt sich beim ersten Öffnen selbst – und das Fragezeichen oben rechts holt die Erklärung jederzeit zurück.',
      },
    ],
  },
  {
    id: 'sprecher',
    title: 'Sprecher',
    steps: [
      {
        target: 'meine-rolle',
        title: 'Welche Rolle ist deine?',
        text: 'Markiere sie hier. Im Durchlauf wird sie ausgespart – an ihrer Stelle steht eine Pause, denn die sprichst du selbst.',
      },
      {
        target: 'stimm-regler',
        title: 'Rollen unterscheiden',
        text: 'Es gibt eine Stimme, und sie steht schon überall. Verschieden klingen die Rollen über Tonhöhe und Tempo – ein paar Striche Unterschied genügen fürs Ohr.',
      },
      {
        target: 'hoerprobe',
        title: 'Wie klingt das?',
        text: 'Das Dreieck spricht einen Satz mit dieser Einstellung. Beim allerersten Mal lädt dabei die Stimme (rund 60 MB) und bleibt danach im Browser – auch ohne Internet.',
      },
    ],
  },
  {
    id: 'hoerfassung',
    title: 'Hörfassung',
    steps: [
      {
        target: 'auswahl',
        title: 'Welcher Teil',
        text: 'Das ganze Stück, ein Seitenbereich – oder nur die Umgebung deiner eigenen Repliken. Für eine Szene, die morgen dran ist, ist das Letzte das Richtige.',
      },
      {
        target: 'aussparen',
        title: 'Deine Rolle als Pause',
        text: 'Statt deiner Replik bleibt eine Lücke in genau ihrer Länge – dein Einsatz kommt also zeitlich richtig. Dafür wird sie im Hintergrund trotzdem erzeugt.',
      },
      {
        target: 'audio-erzeugen',
        title: 'Eine Datei zum Mitlaufen',
        text: 'Am Ende steht eine WAV-Datei: anhören oder herunterladen, im Auto, beim Spülen. Der zweite Durchlauf ist schnell – erzeugt wird nur, was sich geändert hat.',
      },
    ],
  },
  {
    id: 'probe',
    title: 'Lernmodus',
    steps: [
      {
        target: 'probe-starten',
        title: 'Kein Abspielen, eine Probe',
        text: 'Es wird vorgelesen, und bei deiner Replik wartet der Rechner auf dich. Wo ihr aufgehört habt, merkt er sich – beim nächsten Mal geht es dort weiter.',
      },
      {
        target: 'ausschnitt',
        title: 'Welcher Teil',
        text: 'Der ganze Akt oder nur die Stellen um deine eigenen Repliken herum. „Wie viel Hilfe“ darunter entscheidet, ob du den Text der anderen mitliest oder nur hörst.',
      },
      {
        target: 'auswerten',
        title: 'Mitschneiden und auswerten',
        text: 'Wer mag, lässt zuhören: Die App vergleicht Wort für Wort mit dem Text und zeigt, wo es hakte. Dafür lädt sie einmal die Spracherkennung – das dauert und braucht Platz.',
      },
    ],
  },
  {
    id: 'karten',
    title: 'Karteikarten',
    steps: [
      {
        target: 'stapel',
        title: 'Jede Replik eine Karte',
        text: 'Du hörst das Stichwort, sprichst – und bewertest dich selbst. Was saß, kommt später wieder; was nicht saß, schon morgen.',
      },
      {
        target: 'stichwort',
        title: 'Wie viel vorher',
        text: '„Stichwort“ sagt, wie viele Repliken vor deiner gespielt werden. Null heißt: Text aufdecken und sprechen. Darüber wählst du, ob nur Fälliges drankommt.',
      },
      {
        target: 'sitzung-starten',
        title: 'Eine Sitzung',
        text: 'Danebengegangene Karten kommen drei Karten später noch einmal, wackelige zehn – so wird eine lange Sitzung von selbst zur Wiederholung.',
      },
    ],
  },
]

/** Welche Einführung zu einem Reiter des Editors gehört. */
export function tourForTab(tab: TabValue): TourId {
  switch (tab) {
    case 'speakers':
      return 'sprecher'
    case 'audio':
      return 'hoerfassung'
    case 'rehearsal':
      return 'probe'
    case 'cards':
      return 'karten'
    default:
      return 'editor'
  }
}

export function tourById(id: TourId): Tour | undefined {
  return TOURS.find((tour) => tour.id === id)
}

/** Die Schritte, die auf dieses Gerät passen. */
export function stepsFor(id: TourId, touch: boolean): TourStep[] {
  const tour = tourById(id)
  if (!tour) return []
  return tour.steps.filter((step) => !step.only || (step.only === 'touch') === touch)
}

/* ------------------------------------------------------------- Platzierung */

/** Luft zwischen Ziel und Kasten. */
export const GAP = 14
/** Und zum Fensterrand. */
export const RAND = 12
/** So breit wird der Kasten, wo Platz ist. */
export const CARD_WIDTH = 380

export interface Kasten {
  top: number
  left: number
  width: number
  height: number
}

export interface Platz {
  top: number
  left: number
  width: number
}

/**
 * Wo der Kasten steht.
 *
 * Auf dem Telefon an dem Rand, der dem Ziel gegenüberliegt; am Rechner neben
 * dem Ziel, bevorzugt darunter. Entscheidend sind aber die beiden letzten
 * Zeilen: Was auch immer vorher gewünscht war, wird in den sichtbaren Bereich
 * geschoben. Ohne das stand der Kasten in einem flachen Fenster halb über dem
 * oberen Rand, und die Überschrift war nicht mehr zu lesen.
 *
 * Die Höhe kommt gemessen herein, nicht geschätzt: Sie hängt an der Länge des
 * Textes und an der Breite des Fensters, und geraten war sie schon einmal
 * falsch.
 */
export function cardPlacement(options: {
  box: Kasten | null
  cardHeight: number
  view: { width: number; height: number }
  narrow: boolean
}): Platz {
  const { box, cardHeight, view, narrow } = options
  const hoch = Math.min(cardHeight, Math.max(0, view.height - 2 * RAND))
  const breit = narrow
    ? Math.max(0, view.width - 2 * RAND)
    : Math.min(CARD_WIDTH, Math.max(0, view.width - 2 * RAND))

  const einpassen = (wert: number, raum: number, laenge: number) =>
    Math.min(Math.max(RAND, wert), Math.max(RAND, raum - laenge - RAND))

  if (!box) {
    return {
      top: einpassen((view.height - hoch) / 2, view.height, hoch),
      left: einpassen((view.width - breit) / 2, view.width, breit),
      width: breit,
    }
  }

  const platzOben = box.top - GAP - RAND
  const platzUnten = view.height - (box.top + box.height) - GAP - RAND
  const untenHin = narrow
    ? box.top + box.height / 2 < view.height / 2
    : platzUnten >= hoch || platzUnten >= platzOben

  const gewuenscht = narrow
    ? untenHin
      ? view.height - hoch - RAND
      : RAND
    : untenHin
      ? box.top + box.height + GAP
      : box.top - GAP - hoch

  return {
    top: einpassen(gewuenscht, view.height, hoch),
    left: narrow ? RAND : einpassen(box.left + box.width / 2 - breit / 2, view.width, breit),
    width: breit,
  }
}

/* ------------------------------------------------------------- Gedächtnis */

const SEEN_KEY = 'theater-touren'

/** Welche Touren schon liefen. Pro Browser, wie alles andere hier auch. */
export function seenTours(): TourId[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as TourId[]) : []
  } catch {
    return []
  }
}

export function hasSeen(id: TourId): boolean {
  return seenTours().includes(id)
}

export function markSeen(id: TourId): void {
  if (hasSeen(id)) return
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seenTours(), id]))
  } catch {
    // Privates Fenster: dann eben jedes Mal wieder. Besser als gar nicht.
  }
}

/** Alles vergessen – für „Einführung noch einmal“. */
export function forgetTours(): void {
  try {
    window.localStorage.removeItem(SEEN_KEY)
  } catch {
    // nichts zu vergessen
  }
}

/* ---------------------------------------------------------- Fragezeichen */

/*
 * Der Knopf im Seitenkopf weiß nicht, welche Tour gerade passt – die Seite
 * darunter weiß es. Also ruft er, und wer gerade offen ist, meldet sich.
 */
const listeners = new Set<() => void>()

export function askForTour(): void {
  for (const listener of listeners) listener()
}

export function onAskForTour(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
