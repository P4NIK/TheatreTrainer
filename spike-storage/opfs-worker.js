/* Der schnelle OPFS-Weg.
 *
 * createSyncAccessHandle() gibt es nur im Worker. Es ist der einzige Zugriff,
 * der ohne Streams und ohne Zwischenkopie auskommt - und genau deshalb der
 * einzige, der fuer 1400 Bloecke in Frage kommt. Der Hauptthread kann nur
 * createWritable(), und wie weit die beiden auseinanderliegen, ist eine der
 * Fragen dieses Spikes.
 */

const DIR = 'spike-cache'

async function cacheDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR, { create: true })
}

/** Schreibt count Bloecke und misst dabei mit. */
async function write(count, payload, offset = 0) {
  const dir = await cacheDir()
  const started = performance.now()
  let written = 0
  const perBlock = []

  for (let i = 0; i < count; i++) {
    const t0 = performance.now()
    const file = await dir.getFileHandle(`block-${offset + i}.wav`, { create: true })
    const handle = await file.createSyncAccessHandle()
    try {
      handle.truncate(0)
      handle.write(payload, { at: 0 })
      handle.flush()
    } finally {
      handle.close()
    }
    written += payload.length
    perBlock.push(performance.now() - t0)
  }
  return { ms: performance.now() - started, written, perBlock }
}

/** Liest alles zurueck und prueft stichprobenartig, ob es unveraendert ist. */
async function read(count, expected) {
  const dir = await cacheDir()
  const started = performance.now()
  let read = 0
  let corrupt = 0

  for (let i = 0; i < count; i++) {
    const file = await dir.getFileHandle(`block-${i}.wav`)
    const handle = await file.createSyncAccessHandle()
    try {
      const size = handle.getSize()
      const buffer = new Uint8Array(size)
      handle.read(buffer, { at: 0 })
      read += size
      // Anfang, Mitte, Ende - ein stiller Datenverlust waere schlimmer als
      // gar kein Zwischenspeicher.
      if (size !== expected.length ||
          buffer[0] !== expected[0] ||
          buffer[size >> 1] !== expected[size >> 1] ||
          buffer[size - 1] !== expected[size - 1]) {
        corrupt++
      }
    } finally {
      handle.close()
    }
  }
  return { ms: performance.now() - started, read, corrupt }
}

/** Was KeepOnly im Backend tut: auflisten und wegwerfen. */
async function sweep() {
  const dir = await cacheDir()
  const t0 = performance.now()
  const names = []
  for await (const name of dir.keys()) names.push(name)
  const listed = performance.now() - t0

  const t1 = performance.now()
  for (const name of names) await dir.removeEntry(name)
  return { count: names.length, listMs: listed, deleteMs: performance.now() - t1 }
}

self.onmessage = async (event) => {
  const { id, op, count, payload, offset } = event.data
  try {
    let result
    if (op === 'write') result = await write(count, payload, offset)
    else if (op === 'read') result = await read(count, payload)
    else if (op === 'sweep') result = await sweep()
    else throw new Error(`unbekannte Operation ${op}`)
    self.postMessage({ id, ok: true, result })
  } catch (error) {
    self.postMessage({ id, ok: false, error: `${error.name}: ${error.message}` })
  }
}
