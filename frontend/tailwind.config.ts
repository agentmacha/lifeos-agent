import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#020617",
        },
      },
      animation: {
        "slide-in": "slideIn 0.35s ease-out",
        "fade-in": "fadeIn 0.25s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "spin-slow": "spin 3s linear infinite",
        "bounce-in": "bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        slideIn: {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        bounceIn: {
          from: { opacity: "0", transform: "scale(0.6)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
