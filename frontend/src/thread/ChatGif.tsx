import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getGiphyGifsByIds, type GiphyGif } from '../features/messages/giphy.api'
import type { ChatMessage, MessageGif } from '../features/messages/messages.types'

type ChatGifProps =
  | { media: MessageGif; preview?: boolean }
  | { giphyId: string }

type GifImageProps = {
  media: MessageGif
  label: string
  eager?: boolean
}

const GiphyContext = createContext<ReadonlyMap<string, GiphyGif | null> | null>(null)

export function ChatGifProvider({ messages, children }: {
  messages: readonly ChatMessage[]
  children: ReactNode
}) {
  const [gifs, setGifs] = useState(() => new Map<string, GiphyGif | null>())
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeRequest.current?.abort()
    activeRequest.current = null
  }, [])

  useEffect(() => {
    if (activeRequest.current) return

    const ids = new Set<string>()
    for (const { gif, giphyId } of messages) {
      if (!gif && giphyId && !gifs.has(giphyId)) ids.add(giphyId)
    }
    if (ids.size === 0) return

    const controller = new AbortController()
    activeRequest.current = controller

    async function load() {
      const found = await getGiphyGifsByIds([...ids], controller.signal)
        .catch(() => new Map<string, GiphyGif>())
      if (controller.signal.aborted) return

      activeRequest.current = null
      setGifs((current) => {
        const next = new Map(current)
        for (const id of ids) next.set(id, found.get(id) ?? null)
        return next
      })
    }

    queueMicrotask(() => {
      if (!controller.signal.aborted) void load()
    })
  }, [messages, gifs])

  return <GiphyContext.Provider value={gifs}>{children}</GiphyContext.Provider>
}

function GifStatus({ text }: { text: string }) {
  return (
    <p role="status" className="w-fit max-w-full wrap-anywhere text-sm leading-5 text-[#68707a]">
      {text}
    </p>
  )
}

function GifImage({ media, label, eager = false }: GifImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const { url, width, height } = media
  const widthRatio = width && height ? Math.min(1, width / height) : 1

  if (failedUrl === url) return <GifStatus text="Could not load GIF." />

  return (
    <img
      src={url}
      width={width}
      height={height}
      alt={label}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
      className="block h-auto max-h-(--chat-gif-size) rounded-xl object-contain [--chat-gif-size:180px] md:[--chat-gif-size:240px]"
      style={{ maxWidth: `min(100%, calc(var(--chat-gif-size) * ${widthRatio}))` }}
    />
  )
}

export function ChatGif(props: ChatGifProps) {
  if ('media' in props) {
    const { media, preview } = props
    return <GifImage media={media} label={preview ? 'GIF preview' : 'Animated GIF'} eager={preview} />
  }

  return <GiphyImage gifId={props.giphyId} />
}

function GiphyImage({ gifId }: { gifId: string }) {
  const gifs = useContext(GiphyContext)
  const giphy = gifs ? gifs.get(gifId) : null
  if (giphy === undefined) return <GifStatus text="Loading GIF…" />
  if (!giphy?.image) return <GifStatus text="GIF unavailable." />

  return (
    <figure className="w-fit max-w-full">
      <GifImage media={giphy.image} label={giphy.label} />
      {giphy.attribution && (
        <figcaption className="mt-0.5 w-0 min-w-full truncate text-xs text-[#68707a]" title={giphy.attribution}>
          {giphy.attribution}
        </figcaption>
      )}
    </figure>
  )
}