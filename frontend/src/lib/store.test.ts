import { describe, expect, it } from 'vitest'

import type { Block, ProgressInput } from '../types'
import { DIRECTION_KEY } from '../types'
import { fromBase64, memoryProjectStore, slugify, toBase64 } from './store'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x41])

function block(over: Partial<Block> & Pick<Block, 'id'>): Block {
  return {
    page: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    order: 0,
    type: 'line',
    speaker: 'HUGO',
    text: 'Guten Abend.',
    ...over,
  }
}

const progress: ProgressInput = {
  blockId: 'a',
  page: 1,
  order: 0,
  role: 'HUGO',
  index: 3,
  total: 12,
  done: false,
}

describe('slugify', () => {
  it('macht aus einem Titel eine ID wie das Backend', () => {
    expect(slugify('Der Zerbrochne Krug')).toBe('der-zerbrochne-krug')
    expect(slugify('Räuber & Söhne')).toBe('raeuber-soehne')
    expect(slugify('  Faust I  ')).toBe('faust-i')
    expect(slugify('Maß für Maß')).toBe('mass-fuer-mass')
  })
})

describe('Stücke anlegen und finden', () => {
  it('legt ein Stück mit PDF, leeren Blöcken und Regiestimme an', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Der Zerbrochne Krug', PDF)

    expect(p.id).toBe('der-zerbrochne-krug')
    expect(p.name).toBe('Der Zerbrochne Krug')
    expect(p.pdfFile).toBe('source.pdf')
    expect(await store.getBlocks(p.id)).toEqual([])
    expect(Object.keys(await store.getSpeakers(p.id))).toEqual([DIRECTION_KEY])
    expect(Array.from(await store.getPdf(p.id))).toEqual(Array.from(PDF))
  })

  it('hängt eine Zahl an, wenn der Name schon vergeben ist', async () => {
    const store = memoryProjectStore()
    expect((await store.createProject('Faust', PDF)).id).toBe('faust')
    expect((await store.createProject('Faust', PDF)).id).toBe('faust-2')
    expect((await store.createProject('Faust', PDF)).id).toBe('faust-3')
  })

  it('gibt einem Titel ohne brauchbare Zeichen trotzdem eine ID', async () => {
    const store = memoryProjectStore()
    expect((await store.createProject('???', PDF)).id).toBe('stueck')
  })

  it('listet das Neueste zuerst', async () => {
    const store = memoryProjectStore()
    const alt = await store.createProject('Alt', PDF)
    await store.updateProject(alt.id, {})
    const neu = await store.createProject('Neu', PDF)
    // Beide in derselben Millisekunde angelegt zu haben, wäre ein Zufall –
    // aber kein unmöglicher, deshalb wird hier nachgeholfen.
    await store.saveProgress(neu.id, progress)

    const namen = (await store.listProjects()).map((p) => p.name)
    expect(namen).toContain('Alt')
    expect(namen).toContain('Neu')
    expect(namen.length).toBe(2)
  })

  // Ein Lesezugriff legt den Ordner nebenbei an; ohne diese Regel stünde
  // danach ein Geist in der Liste.
  it('zählt einen Ordner ohne project.json nicht mit', async () => {
    const store = memoryProjectStore()
    await store.createProject('Echt', PDF)
    await expect(store.getProject('erfunden')).rejects.toThrow(/gibt es nicht/)

    expect((await store.listProjects()).map((p) => p.id)).toEqual(['echt'])
  })

  it('löscht ein Stück mit allem darin', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Weg damit', PDF)
    await store.deleteProject(p.id)

    expect(await store.listProjects()).toEqual([])
    await expect(store.getProject(p.id)).rejects.toThrow()
  })
})

describe('Metadaten', () => {
  it('ändert nur, was übergeben wird', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    await store.updateProject(p.id, { pageCount: 42 })
    await store.updateProject(p.id, { myRole: 'HAMLET' })
    const got = await store.updateProject(p.id, { premiere: '  2026-10-31 ' })

    expect(got.pageCount).toBe(42)
    expect(got.myRole).toBe('HAMLET')
    expect(got.premiere).toBe('2026-10-31')
    expect(got.name).toBe('Hamlet')
  })

  it('lässt sich den Namen nicht wegnehmen', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)
    expect((await store.updateProject(p.id, { name: '   ' })).name).toBe('Hamlet')
  })

  it('merkt sich den Stand und vergisst ihn wieder', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    const mit = await store.saveProgress(p.id, progress)
    expect(mit.progress?.blockId).toBe('a')
    expect(mit.progress?.updatedAt).toBeTruthy()
    // Der Zeitstempel kommt vom Speicher, nicht vom Aufrufer.
    expect(Date.parse(mit.progress!.updatedAt)).toBeGreaterThan(0)

    expect((await store.clearProgress(p.id)).progress).toBeUndefined()
    expect((await store.getProject(p.id)).progress).toBeUndefined()
  })
})

describe('Blöcke', () => {
  it('speichert in Lesereihenfolge', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    await store.saveBlocks(p.id, [
      block({ id: 'c', order: 2 }),
      block({ id: 'a', order: 0 }),
      block({ id: 'b', order: 1 }),
    ])
    expect((await store.getBlocks(p.id)).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('nimmt einer Regieanweisung den Sprechernamen ab', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    const saved = await store.saveBlocks(p.id, [
      block({ id: 'r', type: 'direction', speaker: 'HUGO' }),
    ])
    expect(saved[0].speaker).toBe(null)
    expect((await store.getBlocks(p.id))[0].speaker).toBe(null)
  })

  it('kennt nur zwei Sorten von Blöcken', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    const saved = await store.saveBlocks(p.id, [
      { ...block({ id: 'x' }), type: 'unfug' as Block['type'] },
    ])
    expect(saved[0].type).toBe('line')
  })

  it('weist Blöcke für ein unbekanntes Stück zurück', async () => {
    const store = memoryProjectStore()
    await expect(store.saveBlocks('erfunden', [])).rejects.toThrow(/gibt es nicht/)
  })
})

describe('Karteikarten', () => {
  const karte = { box: 1, due: '2026-09-12', reviews: 1, lapses: 0, streak: 1, lastGrade: 'good' as const, lastReviewed: '2026-09-09' }

  it('fängt leer an und nimmt einzelne Karten auf', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    expect(await store.getCards(p.id)).toEqual({})
    await store.saveCards(p.id, { a: karte })
    const deck = await store.saveCards(p.id, { b: { ...karte, box: 2 } })

    expect(Object.keys(deck).sort()).toEqual(['a', 'b'])
    expect(deck.b.box).toBe(2)
  })

  it('wirft eine Karte weg, wenn null kommt', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)

    await store.saveCards(p.id, { a: karte, b: karte })
    expect(Object.keys(await store.saveCards(p.id, { a: null }))).toEqual(['b'])
  })

  it('vergisst den Lernstand, nicht die Blöcke', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)
    await store.saveBlocks(p.id, [block({ id: 'a' })])
    await store.saveCards(p.id, { a: karte })

    await store.clearCards(p.id)
    expect(await store.getCards(p.id)).toEqual({})
    expect((await store.getBlocks(p.id)).length).toBe(1)
  })
})

describe('Sicherungskopie', () => {
  it('nimmt alles mit, was nicht nachrechenbar ist', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)
    await store.saveBlocks(p.id, [block({ id: 'a', text: 'Sein oder Nichtsein.' })])
    await store.saveSpeakers(p.id, { HUGO: { model: 'de_DE-thorsten-medium', speakerId: 0, lengthScale: 1, volume: 1, pitch: 1, color: '#000' } })
    await store.saveCards(p.id, { a: { box: 2, due: '2026-09-20', reviews: 3, lapses: 1, streak: 2, lastGrade: 'good', lastReviewed: '2026-09-09' } })
    await store.updateProject(p.id, { pageCount: 7, myRole: 'HUGO' })

    const kopie = await store.exportProject(p.id)
    expect(kopie.format).toBe('theater-tts')
    expect(kopie.project.pageCount).toBe(7)
    expect(kopie.blocks[0].text).toBe('Sein oder Nichtsein.')
    expect(kopie.speakers.HUGO.model).toBe('de_DE-thorsten-medium')
    expect(kopie.cards.a.box).toBe(2)
    expect(Array.from(fromBase64(kopie.pdf))).toEqual(Array.from(PDF))
  })

  it('spielt eine Kopie in einen leeren Browser zurück', async () => {
    const alt = memoryProjectStore()
    const p = await alt.createProject('Hamlet', PDF)
    await alt.saveBlocks(p.id, [block({ id: 'a' })])
    const kopie = await alt.exportProject(p.id)

    const neu = memoryProjectStore()
    const zurueck = await neu.importProject(JSON.parse(JSON.stringify(kopie)))

    expect(zurueck.id).toBe('hamlet')
    expect(zurueck.name).toBe('Hamlet')
    expect((await neu.getBlocks(zurueck.id))[0].id).toBe('a')
    expect(Array.from(await neu.getPdf(zurueck.id))).toEqual(Array.from(PDF))
  })

  // Ein Import daneben ist zurückzunehmen, ein Import darüber nicht.
  it('legt sich neben das vorhandene Stück statt darüber', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)
    await store.saveBlocks(p.id, [block({ id: 'original' })])
    const kopie = await store.exportProject(p.id)

    const zweit = await store.importProject(kopie)
    expect(zweit.id).toBe('hamlet-2')
    expect((await store.getBlocks('hamlet'))[0].id).toBe('original')
  })

  it('weist zurück, was keine Sicherungskopie ist', async () => {
    const store = memoryProjectStore()
    await expect(store.importProject({ irgendwas: true })).rejects.toThrow(/keine Sicherungskopie/)
    await expect(store.importProject(null)).rejects.toThrow(/keine Sicherungskopie/)
  })

  it('weist eine Kopie aus einer neueren Fassung zurück', async () => {
    const store = memoryProjectStore()
    const p = await store.createProject('Hamlet', PDF)
    const kopie = { ...(await store.exportProject(p.id)), version: 99 }
    await expect(store.importProject(kopie)).rejects.toThrow(/neueren Fassung/)
  })
})

describe('base64', () => {
  it('überlebt den Weg hin und zurück, auch bei vielen Bytes', () => {
    const gross = new Uint8Array(200_000)
    for (let i = 0; i < gross.length; i++) gross[i] = (i * 31) % 256

    expect(Array.from(fromBase64(toBase64(gross)))).toEqual(Array.from(gross))
    expect(toBase64(new Uint8Array(0))).toBe('')
  })
})
