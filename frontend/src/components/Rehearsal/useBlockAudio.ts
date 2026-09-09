/**
 * Keeps the audio of single blocks at hand.
 *
 * Where this asked the server for `/blocks/<id>/audio`, the block is now
 * rendered in this tab – through the same worker and the same cache a whole
 * run uses. A line heard while rehearsing is therefore already there when the
 * run reaches it, and the other way round.
 *
 * The look-ahead stays what it was: the first pass through a scene costs about
 * a second per line, and a gap between two lines is the one thing a rehearsal
 * must not have. So while one line plays, the next few are already rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { encodeWav, resample } from '../../lib/audio'
import { engineFor } from '../../lib/engine'
import { requestFor } from '../../lib/pipeline'
import { SAMPLE_RATE } from '../../lib/synth'
import type { Block, Project, Speakers } from '../../types'

export interface BlockAudio {
  /** Object URL of the block, rendering it if necessary. */
  get: (blockId: string) => Promise<string>
  /** Renders blocks in the background; errors are ignored. */
  prefetch: (blockIds: string[]) => void
  /** Throws a block away after its text changed, so it is rendered anew. */
  invalidate: (blockId: string) => void
  /** Blocks currently being rendered – for a "wird vorbereitet …" hint. */
  loading: Set<string>
}

export function useBlockAudio(
  project: Project,
  blocks: Block[],
  speakers: Speakers,
): BlockAudio {
  const urls = useRef(new Map<string, string>())
  const inFlight = useRef(new Map<string, Promise<string>>())
  const [loading, setLoading] = useState<Set<string>>(new Set())

  // Read through a ref rather than a dependency: the blocks array changes
  // identity on every edit, and `get` handed to the run must not.
  const latest = useRef({ project, blocks, speakers })
  latest.current = { project, blocks, speakers }

  // Object URLs stay alive for the lifetime of the panel and are released in
  // one go – a rehearsal run touches a few dozen blocks, not thousands.
  useEffect(() => {
    const map = urls.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      map.clear()
    }
  }, [project.id])

  const get = useCallback(
    (blockId: string): Promise<string> => {
      const ready = urls.current.get(blockId)
      if (ready) return Promise.resolve(ready)

      const running = inFlight.current.get(blockId)
      if (running) return running

      setLoading((s) => new Set(s).add(blockId))
      const task = (async () => {
        const current = latest.current
        const block = current.blocks.find((b) => b.id === blockId)
        if (!block) throw new Error(`Block "${blockId}" gehört nicht zu diesem Projekt`)

        // The same options the server used here: stage directions count, and
        // your own role is rendered rather than skipped – whoever asks for
        // this block wants to hear it.
        const { request, ok } = requestFor(block, current.project, current.speakers, {
          skipMyRole: false,
          includeDirections: true,
        })
        if (!ok || !request) throw new Error('Für diesen Block ist keine Stimme konfiguriert')

        const rendered = await engineFor(current.project.id).render(request)
        const samples = resample(rendered.samples, rendered.sampleRate, SAMPLE_RATE)
        const url = URL.createObjectURL(
          new Blob([encodeWav(samples, SAMPLE_RATE)], { type: 'audio/wav' }),
        )
        urls.current.set(blockId, url)
        return url
      })().finally(() => {
        inFlight.current.delete(blockId)
        setLoading((s) => {
          const next = new Set(s)
          next.delete(blockId)
          return next
        })
      })

      inFlight.current.set(blockId, task)
      return task
    },
    [],
  )

  const prefetch = useCallback(
    (blockIds: string[]) => {
      for (const id of blockIds) void get(id).catch(() => undefined)
    },
    [get],
  )

  const invalidate = useCallback((blockId: string) => {
    const url = urls.current.get(blockId)
    if (url) {
      URL.revokeObjectURL(url)
      urls.current.delete(blockId)
    }
    inFlight.current.delete(blockId)
  }, [])

  return { get, prefetch, invalidate, loading }
}
