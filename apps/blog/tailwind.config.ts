import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: 'var(--color-primary-light)',
          lighter: 'var(--color-primary-lighter)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
        },
        background: {
          DEFAULT: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          card: 'var(--bg-card)',
        },
        foreground: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          hover: 'var(--border-hover)',
        },
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        primary: 'var(--shadow-primary)',
        'primary-lg': 'var(--shadow-primary-lg)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-playfair)', 'var(--font-noto-serif-sc)', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      // Aether Codex 动效映射 —— ref: .claude/design-system/04-motion.md
      transitionTimingFunction: {
        aether: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        instant: '120ms',
        quick: '260ms',
        flow: '520ms',
        ambient: '1800ms',
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'var(--text-secondary)',
            a: { color: 'var(--color-primary)' },
            h1: { color: 'var(--text-primary)' },
            h2: { color: 'var(--text-primary)' },
            h3: { color: 'var(--text-primary)' },
            code: { color: 'var(--text-primary)' },
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;

