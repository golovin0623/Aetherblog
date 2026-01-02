import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6366f1',
          50: '#eef2ff',
          500: '#6366f1',
          600: '#4f46e5',
        },
        background: {
          DEFAULT: '#0a0a0f',
          secondary: '#13131a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#d1d5db',
            a: { color: '#6366f1' },
            h1: { color: '#ffffff' },
            h2: { color: '#ffffff' },
            h3: { color: '#ffffff' },
            code: { color: '#e5e7eb' },
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
