import { describe, expect, it } from 'vitest'

import { precisionFor } from './stt'

/*
 * Die Genauigkeit des Encoders ist kein Geschmacksurteil, sondern eine Frage
 * des Geräts: Auf dem Telefon beendet Safari die Seite, während onnxruntime
 * das Netz aufbaut. Lieber ungenauer erkennen als gar nicht.
 */
describe('precisionFor', () => {
  const zeiger = (art: 'coarse' | 'fine') => (query: string) =>
    query.includes('coarse') === (art === 'coarse')

  it('nimmt auf dem Telefon die sparsame Fassung', () => {
    expect(precisionFor(zeiger('coarse'))).toBe('q8')
  })

  it('lässt dem Rechner die volle Genauigkeit', () => {
    expect(precisionFor(zeiger('fine'))).toBe('fp32')
  })

  it('entscheidet sich im Zweifel für die volle', () => {
    expect(precisionFor(() => false)).toBe('fp32')
  })
})
