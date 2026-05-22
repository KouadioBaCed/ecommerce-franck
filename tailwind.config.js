/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        ink: {
          DEFAULT: '#0f172a',
          soft:    '#1e293b',
          muted:   '#64748b',
          subtle:  '#94a3b8',
        },
        surface: {
          DEFAULT: '#ffffff',
          alt:     '#fafbff',
          tint:    '#f4f5fb',
        },
        accent: {
          rose:   '#ec4899',
          amber:  '#f59e0b',
          mint:   '#10b981',
          sky:    '#0ea5e9',
        },
      },
      boxShadow: {
        soft:    '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        card:    '0 4px 16px -4px rgba(15, 23, 42, 0.06), 0 2px 6px -2px rgba(15, 23, 42, 0.04)',
        elevated:'0 12px 32px -12px rgba(15, 23, 42, 0.18), 0 4px 12px -4px rgba(15, 23, 42, 0.08)',
        glow:    '0 12px 32px -8px rgba(99, 102, 241, 0.45)',
        glowSm:  '0 6px 18px -6px rgba(99, 102, 241, 0.45)',
        ring:    '0 0 0 4px rgba(99, 102, 241, 0.14)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      transitionTimingFunction: {
        'out-soft':  'cubic-bezier(0.22, 1, 0.36, 1)',
        'out-pop':   'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      backgroundImage: {
        'brand-gradient':   'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
        'brand-gradient-2': 'linear-gradient(135deg, #312e81 0%, #4f46e5 60%, #06b6d4 100%)',
        'sunset':           'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.line-clamp-1': { display: '-webkit-box', '-webkit-line-clamp': '1', '-webkit-box-orient': 'vertical', overflow: 'hidden' },
        '.line-clamp-2': { display: '-webkit-box', '-webkit-line-clamp': '2', '-webkit-box-orient': 'vertical', overflow: 'hidden' },
        '.line-clamp-3': { display: '-webkit-box', '-webkit-line-clamp': '3', '-webkit-box-orient': 'vertical', overflow: 'hidden' },
      });
    },
  ],
};
