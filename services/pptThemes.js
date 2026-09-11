// ============================================================
// services/pptThemes.js — Upgraded theme system
// Font pairings, heading/body styles, cards, accents, margins.
// 5 themes preserved: Modern, Academic, Professional, Minimal, Dark.
// ============================================================

const THEMES = {
  Modern: {
    label: "Modern",
    bg: "FFFFFF",
    panel: "EEF2FF",
    panelBorder: "C7D2FE",
    accent: "2563EB",
    accent2: "7C3AED",
    titleColor: "111827",
    bodyColor: "374151",
    headerBg: "2563EB",
    headerText: "FFFFFF",
    fontPair: { heading: "Segoe UI", body: "Calibri" },
    headingSize: 26,
    bodySize: 16,
    dark: false,
  },
  Academic: {
    label: "Academic",
    bg: "FDFBF6",
    panel: "F1EDE3",
    panelBorder: "D6CDB8",
    accent: "7F1D1D",
    accent2: "B45309",
    titleColor: "1F2937",
    bodyColor: "374151",
    headerBg: "7F1D1D",
    headerText: "FDFBF6",
    fontPair: { heading: "Georgia", body: "Cambria" },
    headingSize: 25,
    bodySize: 16,
    dark: false,
  },
  Professional: {
    label: "Professional",
    bg: "F8FAFC",
    panel: "E0F2F1",
    panelBorder: "B2DFDB",
    accent: "0F766E",
    accent2: "0EA5E9",
    titleColor: "0F172A",
    bodyColor: "334155",
    headerBg: "0F766E",
    headerText: "F8FAFC",
    fontPair: { heading: "Segoe UI Semibold", body: "Calibri" },
    headingSize: 25,
    bodySize: 16,
    dark: false,
  },
  Minimal: {
    label: "Minimal",
    bg: "FFFFFF",
    panel: "F3F4F6",
    panelBorder: "E5E7EB",
    accent: "111827",
    accent2: "6B7280",
    titleColor: "111827",
    bodyColor: "4B5563",
    headerBg: "111827",
    headerText: "FFFFFF",
    fontPair: { heading: "Segoe UI Light", body: "Segoe UI" },
    headingSize: 26,
    bodySize: 15,
    dark: false,
  },
  Dark: {
    label: "Dark",
    bg: "0F172A",
    panel: "1E293B",
    panelBorder: "334155",
    accent: "60A5FA",
    accent2: "A78BFA",
    titleColor: "F9FAFB",
    bodyColor: "D1D5DB",
    headerBg: "1D4ED8",
    headerText: "F9FAFB",
    fontPair: { heading: "Segoe UI", body: "Calibri" },
    headingSize: 26,
    bodySize: 16,
    dark: true,
  },
};

// Consistent layout grid (inches, 16:9 = 10 x 5.63)
const GRID = {
  marginX: 0.45,
  headerH: 0.85,
  contentTop: 1.15,
  contentH: 4.1,
  footerY: 5.35,
};

function getTheme(name) {
  return THEMES[name] || THEMES.Modern;
}

module.exports = { THEMES, getTheme, GRID };