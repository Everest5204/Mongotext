import { useState, type SyntheticEvent } from 'react'

type LoginPageProps = {
  onSignedIn: () => void
}

const inputClassName =
  'mt-2 block h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base font-normal outline-none focus:border-[#e60023] focus:ring-2 focus:ring-[#e60023]/20'

export default function LoginPage({ onSignedIn }: LoginPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubmitting) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const emailOrPhone = String(fields.get('email_or_phone') ?? '').trim()
    const password = String(fields.get('password') ?? '')

    if (!emailOrPhone || !password) {
      setError('Enter your email or phone and password.')
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email_or_phone: emailOrPhone,
          password,
        }),
      })

      if (response.status === 401 || response.status === 403) {
        setError('Check your Mongoksy email or phone and password.')
        return
      }

      if (response.status === 429) {
        setError('Too many attempts. Try again in a moment.')
        return
      }

      if (response.status !== 204) {
        setError('Mongoksy sign-in is temporarily unavailable.')
        return
      }

      form.reset()
      onSignedIn()
    } catch {
      setError('Could not reach the sign-in server. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f7f8] px-5 py-8 font-sans text-[#171b20]">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-9"
      >
        <h1
          id="login-title"
          className="text-3xl font-black tracking-tight text-[#e60023] sm:text-4xl"
        >
          Mongotext
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Sign in with your Mongoksy account.
        </p>

        <form className="mt-7" onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting} className="space-y-4">
            <label className="block text-sm font-semibold">
              Email or phone
              <input
                name="email_or_phone"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                className={inputClassName}
              />
            </label>

            <label className="block text-sm font-semibold">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={inputClassName}
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#e60023] font-semibold text-white hover:bg-[#c9001f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e60023] disabled:opacity-60"
            >
              {isSubmitting ? 'Signing in…' : 'Log in'}
            </button>
          </fieldset>
        </form>
      </section>
    </main>
  )
}