import { useEffect, useState } from 'react'
import LoginPage from './features/auth/LoginPage.tsx'
import ChatListPage from './features/conversations/ChatListPage'

type SessionStatus = 'checking' | 'signed-out' | 'signed-in' | 'unavailable'

export default function App() {
  const [status, setStatus] = useState<SessionStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()

    async function checkSession() {
      try {
        const response = await fetch('/api/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        if (response.status === 204) {
          setStatus('signed-in')
        } else if (response.status === 401) {
          setStatus('signed-out')
        } else {
          setStatus('unavailable')
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus('unavailable')
        }
      }
    }

    void checkSession()
    return () => controller.abort()
  }, [])

  if (status === 'signed-out') {
    return <LoginPage onSignedIn={() => setStatus('signed-in')} />
  }

  if (status === 'signed-in') {
    return <ChatListPage />
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f7f8] px-6 text-center">
      {status === 'unavailable' ? (
        <p role="alert">Could not check your session. Start the backend and refresh.</p>
      ) : (
        <p role="status">Checking your session…</p>
      )}
    </main>
  )
}