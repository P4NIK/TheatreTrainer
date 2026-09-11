/**
 * Die Einführung: was wo ist, beim ersten Mal von selbst.
 *
 * Wer ein Stück proben will, sieht zuerst eine leere Liste und danach ein PDF,
 * über das man Rechtecke ziehen soll – das ist niemandem anzusehen. Drei kurze
 * Touren erklären es dort, wo es passiert: in der Stückeliste, im Editor und
 * beim Proben.
 *
 * Hier stehen nur die Texte und das Gedächtnis dafür, welche Tour schon lief.
 * Das Anzeigen macht components/Tour/Tour.tsx, das Auslösen die Seiten selbst –
 * jede weiß am besten, wann sie fertig aufgebaut ist.
 *
 * Keine fremde Bibliothek: intro.js steht seit Fassung 3 unter der AGPL und
 * würde dieses Projekt mitziehen, und die schwierige Hälfte – ein Kasten, der
 * neben einem Element steht und mitwandert – liegt ohnehin schon in Mantine.
 */

export type TourId = 'stuecke' | 'editor' | 'proben'

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
  /** Dieser Reiter muss dafür offen sein. */
  tab?: TabValue
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
        text: 'Sprecher, Hörfassung, Lernmodus, Karteikarten – in dieser Reihenfolge. Was dort wartet, zeigt dir die nächste Einführung, sobald du den Lernmodus öffnest.',
      },
    ],
  },
  {
    id: 'proben',
    title: 'Proben',
    steps: [
      {
        tab: 'speakers',
        target: 'meine-rolle',
        title: 'Welche Rolle ist deine?',
        text: 'Markiere sie hier. Im Durchlauf wird sie ausgespart – an ihrer Stelle steht eine Pause, denn die sprichst du selbst.',
      },
      {
        tab: 'speakers',
        target: 'stimm-regler',
        title: 'Rollen unterscheiden',
        text: 'Es gibt eine Stimme, und sie steht schon überall. Verschieden klingen die Rollen über Tonhöhe und Tempo. Das Dreieck daneben spielt eine Hörprobe.',
      },
      {
        tab: 'audio',
        target: 'audio-erzeugen',
        title: 'Die Hörfassung',
        text: 'Das ganze Stück am Stück, als eine Datei zum Mitlaufen – im Auto, beim Spülen. Beim allerersten Mal lädt dabei die Stimme (rund 60 MB), danach nie wieder.',
      },
      {
        tab: 'rehearsal',
        target: 'probe-starten',
        title: 'Die Probe',
        text: 'Kein Abspielen, sondern eine Probe: Es wird vorgelesen, und bei deiner Replik wartet der Rechner auf dich. Er merkt sich, wo ihr aufgehört habt.',
      },
      {
        tab: 'rehearsal',
        target: 'auswerten',
        title: 'Gesagtes auswerten',
        text: 'Wer mag, lässt zuhören: Die App vergleicht Wort für Wort mit dem Text und zeigt, wo es hakte. Dafür lädt sie einmal die Spracherkennung – das dauert und braucht Platz.',
      },
    ],
  },
]

export function tourById(id: TourId): Tour | undefined {
  return TOURS.find((tour) => tour.id === id)
}

/** Die Schritte, die auf dieses Gerät passen. */
export function stepsFor(id: TourId, touch: boolean): TourStep[] {
  const tour = tourById(id)
  if (!tour) return []
  return tour.steps.filter((step) => !step.only || (step.only === 'touch') === touch)
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
