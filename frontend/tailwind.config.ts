import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        health: { green: '#22c55e', yellow: '#eab308', red: '#ef4444' },
        priority: { critical: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#6b7280' },
        category: {
          flagship: '#8b5cf6', platform: '#3b82f6', b2c: '#10b981',
          passion: '#f59e0b', consulting: '#6366f1', social: '#ec4899',
        },

        // Brand — violet/purple. Obsidian's signature accent.
        // Used for: primary buttons, active nav, focus rings, links.
        brand: {
          50:  '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },

        // Obsidian dark surfaces — near-neutral, slight warmth.
        // Use these as the dark-mode building blocks instead of gray-* (which is bluish).
        obsidian: {
          bg:           '#1e1e1e', // canvas / main content area
          panel:        '#262626', // cards, popovers, modal sheets
          raised:       '#2c2c2c', // hover states on panels, dropdowns
          sunken:       '#181818', // sidebar, deeper recessed regions
          deep:         '#141414', // page background behind everything
          border:       '#2f2f2f', // default divider
          'border-strong': '#3a3a3a', // emphasized divider
          fg:           '#dcddde', // primary text
          muted:        '#a3a3a3', // secondary text
          faded:        '#737373', // tertiary / placeholder
        },

        success: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
        warning: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
        danger:  { 50: '#fef2f2', 100: '#fee2e2', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
        info:    { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // +1px per tier compared to the original ladder. Team feedback #2:
        // text felt small on default-sized monitors (15px body / 12px chrome
        // is on the dense side for office viewing distance). The bump
        // cascades to every `text-xs / text-sm / text-base` site without
        // re-touching individual components, AND the body rule below is
        // synced to the new base.
        '2xs': ['11px', { lineHeight: '15px' }],
        xs:   ['13px', { lineHeight: '17px' }],
        sm:   ['14px', { lineHeight: '21px' }],
        base: ['16px', { lineHeight: '25px' }],
        lg:   ['18px', { lineHeight: '27px' }],
        xl:   ['21px', { lineHeight: '29px', letterSpacing: '-0.01em' }],
        '2xl': ['25px', { lineHeight: '33px', letterSpacing: '-0.015em' }],
        '3xl': ['31px', { lineHeight: '37px', letterSpacing: '-0.02em' }],
        '4xl': ['37px', { lineHeight: '41px', letterSpacing: '-0.025em' }],
      },

      // Shadow ladder. Dark variants use ring-style shadows since drop shadows
      // disappear on dark surfaces — a 1px inner highlight reads as elevation.
      boxShadow: {
        soft:      '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 1px 0 rgba(15, 23, 42, 0.03)',
        lift:      '0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)',
        pop:       '0 16px 40px -8px rgba(15, 23, 42, 0.18), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
        innerSoft: 'inset 0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        focus:     '0 0 0 3px rgba(139, 92, 246, 0.30)',
        'glow-brand': '0 0 0 1px rgba(139, 92, 246, 0.35), 0 0 24px -4px rgba(139, 92, 246, 0.30)',
        // Dark-tuned: subtle inner top highlight + outer drop. Reads on #1e1e1e.
        'soft-dark':  'inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 2px 0 rgba(0,0,0,0.4)',
        'lift-dark':  'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 6px 16px -4px rgba(0,0,0,0.5)',
        'pop-dark':   'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 20px 48px -8px rgba(0,0,0,0.6)',
      },

      borderRadius: {
        '2xs': '3px',
        xs: '5px',
      },

      keyframes: {
        'fade-in':    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in-down': { '0%': { opacity: '0', transform: 'translateY(-6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'scale-in':   { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'slide-in-left':  { '0%': { opacity: '0', transform: 'translateX(-8px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'slide-in-right': { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'shimmer':    { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(139, 92, 246, 0.0)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(139, 92, 246, 0.18)' },
        },
      },
      animation: {
        'fade-in':       'fade-in 0.2s ease-out',
        'fade-in-up':    'fade-in-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-down':  'fade-in-down 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in':      'scale-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left':  'slide-in-left 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer':       'shimmer 1.6s linear infinite',
        'pulse-glow':    'pulse-glow 2.4s ease-in-out infinite',
      },

      spacing: {
        '4.5': '1.125rem', // 18px
      },
    },
  },
  plugins: [],
} satisfies Config;
