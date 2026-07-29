/**
 * Server-side transactional email helper (Resend). Safe to call from API routes and webhooks.
 * No-ops gracefully (returns { sent: false }) when RESEND_API_KEY is unset — never throws, so
 * it can be fire-and-forget after a payment/signup without risking the main response.
 */
const RESEND_KEY = process.env.RESEND_API_KEY ?? ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'OMNEX <hello@omnex.ai>'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<{ sent: boolean; id?: string | undefined; reason?: string | undefined }> {
  if (!RESEND_KEY) return { sent: false, reason: 'RESEND_API_KEY not set' }
  if (!opts.to) return { sent: false, reason: 'no recipient' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
      }),
    })
    if (!res.ok) return { sent: false, reason: `resend ${res.status}` }
    const data = await res.json().catch(() => ({})) as { id?: string }
    return { sent: true, id: data.id }
  } catch (e) {
    return { sent: false, reason: String(e) }
  }
}
