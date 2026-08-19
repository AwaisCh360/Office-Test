/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        hover: 'var(--hover)',
        inset: 'var(--inset)',
        accent: 'var(--accent)',
        'accent-tint': 'var(--accent-tint)',
        'accent-ink': 'var(--accent-ink)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        line: 'var(--line)',
      },
      boxShadow: {
        raised: 'var(--shadow-raised)',
        hairline: 'var(--shadow-hairline)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
      },
      spacing: {
        '4.5': '1.125rem',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        }
      },
      animation: {
        'pop-in': 'pop-in 250ms cubic-bezier(0.23,1,0.32,1) both',
      }
    },
  },
  plugins: [],
}
