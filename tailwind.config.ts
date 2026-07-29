import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:       '#060810',
        surface:  '#0d1117',
        surface2: '#141a24',
        surface3: '#1a2232',
        border:   'rgba(255,255,255,0.07)',
        border2:  'rgba(255,255,255,0.13)',
        text:     '#e8edf5',
        muted:    '#637082',
        muted2:   '#8b9ab0',
        accent:   '#4f8ef7',
        accent2:  '#7c3aed',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow':   'pulse 3s ease-in-out infinite',
        'fade-in':      'fadeIn 0.4s ease forwards',
        'slide-up':     'slideUp 0.5s ease forwards',
        'glow':         'glow 2s ease-in-out infinite alternate',
        'counter':      'counter 1s ease-out forwards',
        'scan':         'scan 2s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        glow:    { from: { boxShadow: '0 0 20px rgba(79,142,247,0.3)' }, to: { boxShadow: '0 0 40px rgba(79,142,247,0.6)' } },
        scan:    { from: { transform: 'translateY(-100%)' }, to: { transform: 'translateY(400%)' } },
      },
      backgroundImage: {
        'gradient-radial':    'radial-gradient(var(--tw-gradient-stops))',
        'gradient-mesh':      'radial-gradient(at 40% 20%, #1e3a5f 0px, transparent 50%), radial-gradient(at 80% 0%, #3b0764 0px, transparent 50%), radial-gradient(at 0% 50%, #0f172a 0px, transparent 50%)',
        'hero-gradient':      'linear-gradient(135deg, rgba(79,142,247,0.08) 0%, rgba(124,58,237,0.05) 50%, transparent 100%)',
        'card-gradient':      'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 100%)',
        'accent-gradient':    'linear-gradient(135deg, #4f8ef7, #7c3aed)',
        'epsilon-gradient':   'linear-gradient(135deg, #4f8ef7 0%, #7c3aed 33%, #ec4899 66%, #f59e0b 100%)',
      },
    },
  },
  plugins: [typography],
}

export default config
