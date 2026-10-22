import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Paleta cian sobre azul marino oscuro (#0a1729 / #0e1d33 / #1ea7e8 / #64c7f5)
        amber: {
          50: "#eaf6fd",
          100: "#d0eefb",
          200: "#a3dff8",
          300: "#64c7f5", // --accent-soft
          400: "#3cb6ee",
          500: "#1ea7e8", // --accent
          600: "#1589c2",
          700: "#116c99",
          800: "#0e1d33", // --panel
          900: "#0a1729", // --bg
          950: "#060e1a",
        },
        sepia: {
          bg: "#f8f1e3",
          card: "#efe6d5",
          text: "#3c3328",
          muted: "#7c7062",
          border: "#dfd5c2",
          active: "#eed8a1",
        },
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
