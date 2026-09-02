/**
 * Keeps the audio of single blocks at hand.
 *
 * The server renders a block on first request and keeps it in its cache, so
 * the first pass through a scene costs a few seconds per line and every pass
 * after that is instant. That first pass must not be audible as a gap, hence
 * the look-ahead: while one line plays, the next few are already loading.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api/client'

export interface BlockAudio {
  /** Object URL of the block, fetching it if necessary. */
  get: (blockId: string) => Promise<string>
  /** Loads blocks in the background; errors are ignored. */
  prefetch: (blockIds: string[]) => void
  /** Throws a block away after its text changed, so it is rendered anew. */
  invalidate: (blockId: string) => void
  /** Blocks currently in flight – for a "wird vorbereitet …" hint. */
  loading: Set<string>
}

export function useBlockAudio(projectId: string): BlockAudio {
  const urls = useRef(new Map<string, string>())
  const inFlight = useRef(new Map<string, Promise<string>>())
  const [loading, setLoading] = useState<Set<string>>(new Set())

  // Object URLs stay alive for the lifetime of the panel and are released in
  // one go – a rehearsal run touches a few dozen blocks, not thousands.
  useEffect(() => {
    const map = urls.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      map.clear()
    }
  }, [projectId])

  const get = useCallback(
    (blockId: string): Promise<string> => {
      const ready = urls.current.get(blockId)
      if (ready) return Promise.resolve(ready)

      const running = inFlight.current.get(blockId)
      if (running) return running

      setLoading((s) => new Set(s).add(blockId))
      const task = fetch(api.blockAudioUrl(projectId, blockId))
        .then(async (res) => {
          if (!res.ok) {
            let message = `${res.status} ${res.statusText}`
            try {
              const body = await res.json()
              if (body?.error) message = body.error
            } catch {
              /* keep the status text */
            }
            throw new Error(message)
          }
          const url = URL.createObjectURL(await res.blob())
          urls.current.set(blockId, url)
          return url
        })
        .finally(() => {
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
    [projectId],
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
