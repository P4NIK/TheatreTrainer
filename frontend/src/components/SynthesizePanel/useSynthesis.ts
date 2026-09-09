/**
 * The run, as the panel sees it.
 *
 * This is what is left of the job registry: the run happens in this tab, so
 * there is nothing to poll and nothing to reconnect to. What the panel needs
 * is a bit of state that survives a re-render, and that is all this hook is.
 *
 * One thing it does that the backend never had to: load the voice before the
 * first block. It is a 63 MB download exactly once, and hiding it inside
 * "block 1 of 340" would look like the app had hung.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { engineFor } from '../../lib/engine'
import { planRun } from '../../lib/pipeline'
import { requestPersistence } from '../../lib/storage'
import { runSynthesis, tidyCache } from '../../lib/synth'
import { VOICES } from '../../lib/voices'
import type { Block, CacheStatus, Project, SelectionItem, Speakers } from '../../types'

export type RunStatus = 'idle' | 'voice' | 'running' | 'done' | 'error'

export interface RunState {
  status: RunStatus
  /** Blocks finished and blocks in total. */
  done: number
  total: number
  /** Blocks that went through Piper, and blocks that came from the cache. */
  rendered: number
  cached: number
  message: string
  error: string
  /** Object URL of the finished WAV; empty until there is one. */
  url: string
  /** Voices missing from the list, and blocks that could not be planned. */
  problems: string[]
  /** Set while a voice is being fetched. */
  voice: { name: string; loaded: number; total: number } | null
}

export interface StartOptions {
  skipMyRole: boolean
  includeDirections: boolean
  /** Empty or absent means the whole play. */
  selection?: SelectionItem[]
}

const IDLE: RunState = {
  status: 'idle',
  done: 0,
  total: 0,
  rendered: 0,
  cached: 0,
  message: '',
  error: '',
  url: '',
  problems: [],
  voice: null,
}

export function useSynthesis(project: Project, blocks: Block[], speakers: Speakers) {
  const [state, setState] = useState<RunState>(IDLE)
  const [cache, setCache] = useState<CacheStatus | null>(null)
  const running = useRef<AbortController | null>(null)
  const url = useRef('')

  const engine = engineFor(project.id)

  const refreshCache = useCallback(() => {
    engine.cache.stats().then(setCache).catch(() => setCache(null))
  }, [engine])

  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  // The URL belongs to this tab, not to a server: without this the finished
  // audio would stay in memory for as long as the page is open.
  useEffect(() => {
    return () => {
      if (url.current) URL.revokeObjectURL(url.current)
      running.current?.abort()
    }
  }, [])

  const start = useCallback(
    async (options: StartOptions) => {
      const controller = new AbortController()
      running.current = controller

      if (url.current) {
        URL.revokeObjectURL(url.current)
        url.current = ''
      }
      setState({ ...IDLE, status: 'running', message: 'Der Durchlauf wird geplant …' })

      const input = {
        project,
        blocks,
        speakers,
        options: { skipMyRole: options.skipMyRole, includeDirections: options.includeDirections },
        selection: options.selection,
        knownModels: VOICES.map((voice) => voice.name),
        // The wording of the "voice is missing" message: nothing is installed
        // any more, so pointing at a folder would send people looking.
        voicesLocation: 'der Stimmenliste',
      }

      try {
        const plan = planRun(input)
        if (plan.items.length === 0) {
          setState({ ...IDLE, status: 'error', error: 'Die Auswahl enthält keine Blöcke zum Vorlesen.', problems: plan.problems })
          return
        }

        // Asked for before the first big download, not on the first visit:
        // a browser dialog out of nowhere gets clicked away.
        await requestPersistence().catch(() => false)

        const needed = new Set<string>()
        for (const item of plan.items) if (item.request) needed.add(item.request.model)

        for (const name of needed) {
          if (engine.pool.ready(name)) continue
          setState((s) => ({ ...s, status: 'voice', message: `Stimme ${name} wird geladen …`, voice: { name, loaded: 0, total: 0 } }))
          const unwatch = engine.watchVoice((progress) =>
            setState((s) => ({ ...s, voice: { name: progress.voice, loaded: progress.loaded, total: progress.total } })),
          )
          try {
            await engine.pool.ensure(name)
          } finally {
            unwatch()
          }
          if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError')
        }

        setState((s) => ({ ...s, status: 'running', voice: null, message: 'Der erste Block wird erzeugt …' }))

        const out = await runSynthesis(input, engine.render, {
          signal: controller.signal,
          onProgress: (progress) =>
            setState((s) => ({
              ...s,
              status: 'running',
              done: progress.done,
              total: progress.total,
              rendered: progress.rendered,
              cached: progress.cached,
              message: progress.message,
            })),
        })

        url.current = URL.createObjectURL(new Blob([out.wav], { type: 'audio/wav' }))
        setState({
          status: 'done',
          done: plan.items.length,
          total: plan.items.length,
          rendered: out.stats.rendered,
          cached: out.stats.cached,
          message: out.message,
          error: '',
          url: url.current,
          problems: out.problems,
          voice: null,
        })

        // Same housekeeping as after a run in the backend: entries no block
        // points at any more are thrown away.
        await tidyCache(engine.cache, project, blocks, speakers).catch(() => 0)
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        setState((s) => ({
          ...s,
          status: 'error',
          voice: null,
          message: aborted ? 'Abgebrochen' : s.message,
          error: aborted ? '' : error instanceof Error ? error.message : String(error),
        }))
      } finally {
        running.current = null
        refreshCache()
      }
    },
    [blocks, engine, project, refreshCache, speakers],
  )

  const cancel = useCallback(() => running.current?.abort(), [])

  const clearCache = useCallback(async () => {
    await engine.cache.clear().catch(() => 0)
    refreshCache()
  }, [engine, refreshCache])

  return { state, cache, start, cancel, clearCache, refreshCache }
}
