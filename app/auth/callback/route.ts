import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/core/supabase/server'

// Exchanges the email-confirmation code for a session cookie, then lands the
// customer directly in the product rather than on a generic dashboard.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/studio', req.url))
}
