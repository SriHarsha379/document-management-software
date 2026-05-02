/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#4361ee',
          50:  '#eef0ff',
          100: '#dde2ff',
          200: '#c0c8ff',
          500: '#4361ee',
          600: '#3651d4',
          700: '#2a40b8',
        },
        navy: '#1a1a2e',
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10)',
        modal: '0 8px 40px rgba(0,0,0,0.18)',
      },
    },
  },
  plugins: [],
}


