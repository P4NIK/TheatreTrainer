/**
 * One Piper per project, shared by everyone who needs it.
 *
 * The voice is 63 MB in memory and the worker holding it takes a moment to
 * come up, so a run and a single block preview must not each build their own.
 * A module-level map is the plainest thing that gives both the same engine
 * without threading a provider through the whole tree.
 *
 * What lives where:
 *
 *   models                       the voices, shared by every project
 *   projects/<id>/cache          the rendered blocks of one project
 *
 * The second path is the one the backend kept in `data/projects/<id>/cache/`,
 * and the keys inside are the same – the port was checked against it.
 */

import type { RenderedBlock, SynthRequest } from './pipeline'
import { BlockCache, ModelStore, opfsStore, type DownloadProgress } from './storage'
import { cachedRenderer, PiperPool } from './synth'

export interface VoiceProgress extends DownloadProgress {
  voice: string
}

export interface Engine {
  readonly projectId: string
  readonly cache: BlockCache
  readonly models: ModelStore
  readonly pool: PiperPool
  /** The renderer to hand to runSynthesis(). */
  readonly render: (request: SynthRequest) => Promise<RenderedBlock>
  /** Watches voice downloads; returns the function that stops watching. */
  watchVoice(listener: (progress: VoiceProgress) => void): () => void
  close(): void
}

const engines = new Map<string, Engine>()

export function engineFor(projectId: string): Engine {
  const known = engines.get(projectId)
  if (known) return known

  const listeners = new Set<(progress: VoiceProgress) => void>()
  const models = new ModelStore(opfsStore('models'))
  const cache = new BlockCache(opfsStore(`projects/${projectId}/cache`))
  const pool = new PiperPool({
    models,
    onVoiceProgress: (voice, progress) => {
      for (const listener of listeners) listener({ voice, ...progress })
    },
  })

  const engine: Engine = {
    projectId,
    cache,
    models,
    pool,
    render: cachedRenderer(pool.synthesize, cache),
    watchVoice(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      pool.close()
      listeners.clear()
      engines.delete(projectId)
    },
  }

  engines.set(projectId, engine)
  return engine
}

/**
 * Ends every engine but this one. Worth calling when another project is
 * opened: a worker that nobody talks to still holds its 63 MB.
 */
export function closeOtherEngines(projectId?: string): void {
  for (const engine of [...engines.values()]) {
    if (engine.projectId !== projectId) engine.close()
  }
}

/** Ends one engine – after its project has been deleted, say. */
export function closeEngine(projectId: string): void {
  engines.get(projectId)?.close()
}
