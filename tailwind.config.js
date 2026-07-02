/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Poppins', 'Inter', 'sans-serif'],
      },
      colors: {
        // Marketoos — bleu de marque (#002E93 / #0143B0 / #025AC9)
        brand: {
          50:  '#eaf2fc',
          100: '#dbebf4',
          200: '#bcd8ef',
          300: '#8fbce5',
          400: '#3e86d6',
          500: '#025ac9', // bleu digital
          600: '#0143b0', // bleu principal
          700: '#002e93', // bleu profond
          800: '#002878',
          900: '#001b54',
        },
        // Turquoise d'action (#0199A9 / #04BFBA / #41CAC5)
        teal: {
          50:  '#e7faf9',
          100: '#c8f2f0',
          200: '#93e5e1',
          300: '#41cac5', // turquoise clair
          400: '#14c3be',
          500: '#04bfba', // turquoise
          600: '#0199a9', // turquoise foncé
          700: '#017e8c',
        },
        ink: {
          DEFAULT: '#0f172a',
          soft:    '#1e293b',
          muted:   '#64748b',
          subtle:  '#94a3b8',
        },
        surface: {
          DEFAULT: '#ffffff',
          alt:     '#f6f9fd',
          tint:    '#eef4fb',
        },
        accent: {
          // Repurposed to the brand turquoise so decorative glows stay on-brand.
          rose:   '#04bfba',
          teal:   '#04bfba',
          amber:  '#f59e0b',
          mint:   '#04bfba',
          sky:    '#025ac9',
        },
      },
      boxShadow: {
        soft:    '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        card:    '0 4px 16px -4px rgba(15, 23, 42, 0.06), 0 2px 6px -2px rgba(15, 23, 42, 0.04)',
        elevated:'0 12px 32px -12px rgba(15, 23, 42, 0.18), 0 4px 12px -4px rgba(15, 23, 42, 0.08)',
        glow:    '0 12px 32px -8px rgba(1, 67, 176, 0.42)',
        glowSm:  '0 6px 18px -6px rgba(1, 67, 176, 0.42)',
        ring:    '0 0 0 4px rgba(1, 67, 176, 0.14)',
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
        // Dégradé logo Marketoos (bleu profond → bleu digital → turquoise)
        'brand-gradient':   'linear-gradient(135deg, #002e93 0%, #025ac9 50%, #04bfba 100%)',
        // Dégradé bleu premium (fonds, en-têtes, cartes fortes)
        'brand-gradient-2': 'linear-gradient(135deg, #002e93 0%, #0143b0 55%, #025ac9 100%)',
        // Dégradé turquoise (badges, éléments d'action)
        'sunset':           'linear-gradient(135deg, #0199a9 0%, #04bfba 50%, #41cac5 100%)',
        'teal-gradient':    'linear-gradient(135deg, #0199a9 0%, #04bfba 50%, #41cac5 100%)',
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
