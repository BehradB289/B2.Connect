/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Vazirmatn"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"Vazirmatn"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        espresso: {
          950: '#0A0807',
          900: '#14100E',
          800: '#1C1511',
          700: '#2A201A',
          crema: '#D4A373',
          light: '#E6CCB2',
          bronze: '#9C6B3B',
          ivory: '#FAF7F5',
        },
        noir: {
          950: '#050506',
          900: '#101012',
          800: '#18181B',
        },
        daylight: {
          50: '#FAF7F5',
          100: '#F4EFEA',
          200: '#E6DDD3',
          900: '#1A130F',
        },
      },
    },
  },
  plugins: [],
};
