/**
 * Transactional email templates (inline HTML, dark theme). Pure functions — no deps.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://omnex-platform.vercel.app'

const shell = (inner: string) => `
<div style="background:#0a0a0a;color:#e5e7eb;font-family:system-ui,Segoe UI,Arial,sans-serif;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #222;border-radius:14px;padding:28px">
    <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#4f8ef7,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent">OMNEX</div>
    ${inner}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #222;font-size:12px;color:#6b7280">
      OMNEX · Autonomous AI revenue platform ·
      <a href="${APP_URL}/privacy" style="color:#6b7280">Privacy</a> ·
      <a href="${APP_URL}/terms" style="color:#6b7280">Terms</a>
    </div>
  </div>
</div>`

export function welcomeEmail(name?: string) {
  const who = name ? ` ${name}` : ''
  return {
    subject: 'Welcome to OMNEX — your autonomous AI workspace is ready',
    html: shell(`
      <h1 style="font-size:22px;margin:18px 0 6px">Welcome${who} 👋</h1>
      <p style="color:#9ca3af;line-height:1.6">Your OMNEX account is live. You start on the Free plan with 5 runs —
      enough to spin up your first autonomous workflow.</p>
      <p style="margin:22px 0">
        <a href="${APP_URL}/onboarding" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Start your first workflow →</a>
      </p>
      <p style="color:#9ca3af;line-height:1.6;font-size:14px">When you're ready to scale, see <a href="${APP_URL}/pricing" style="color:#4f8ef7">pricing</a>.</p>`),
    text: `Welcome${who} to OMNEX. Your account is live on the Free plan (5 runs). Start: ${APP_URL}/onboarding`,
  }
}

export function receiptEmail(opts: { plan: string; amountEur: number }) {
  const amount = opts.amountEur.toFixed(2)
  return {
    subject: `OMNEX receipt — ${opts.plan} plan activated`,
    html: shell(`
      <h1 style="font-size:22px;margin:18px 0 6px">Payment received — thank you 🎉</h1>
      <p style="color:#9ca3af;line-height:1.6">Your <strong style="color:#e5e7eb">${opts.plan}</strong> plan is now active.</p>
      <table style="width:100%;margin:18px 0;font-size:14px;color:#9ca3af">
        <tr><td>Plan</td><td style="text-align:right;color:#e5e7eb">${opts.plan}</td></tr>
        <tr><td>Amount</td><td style="text-align:right;color:#e5e7eb">€${amount}</td></tr>
      </table>
      <p style="margin:22px 0">
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Go to dashboard →</a>
      </p>
      <p style="color:#9ca3af;font-size:13px">Manage or cancel anytime from <a href="${APP_URL}/billing" style="color:#4f8ef7">billing</a>. A formal invoice is available in your Stripe customer portal.</p>`),
    text: `OMNEX: your ${opts.plan} plan is active. Amount: €${amount}. Dashboard: ${APP_URL}/dashboard`,
  }
}
