// ============================================================
// services/pptThemes.js — 5 professional PPT themes
// Har theme background, typography, header + accent styling
// define karta hai. Ek design hard-coded NAHI hai.
// ============================================================

const THEMES = {
  Modern: {
    label: "Modern",
    bg: "FFFFFF",
    panel: "EEF2FF",
    accent: "2563EB",
    accent2: "7C3AED",
    titleColor: "111827",
    bodyColor: "374151",
    headerBg: "2563EB",
    headerText: "FFFFFF",
    font: "Calibri",
    dark: false,
  },
  Academic: {
    label: "Academic",
    bg: "FDFBF6",
    panel: "F1EDE3",
    accent: "7F1D1D",
    accent2: "B45309",
    titleColor: "1F2937",
    bodyColor: "374151",
    headerBg: "7F1D1D",
    headerText: "FDFBF6",
    font: "Georgia",
    dark: false,
  },
  Professional: {
    label: "Professional",
    bg: "F8FAFC",
    panel: "E0F2F1",
    accent: "0F766E",
    accent2: "0EA5E9",
    titleColor: "0F172A",
    bodyColor: "334155",
    headerBg: "0F766E",
    headerText: "F8FAFC",
    font: "Calibri",
    dark: false,
  },
  Minimal: {
    label: "Minimal",
    bg: "FFFFFF",
    panel: "F3F4F6",
    accent: "111827",
    accent2: "6B7280",
    titleColor: "111827",
    bodyColor: "4B5563",
    headerBg: "111827",
    headerText: "FFFFFF",
    font: "Calibri",
    dark: false,
  },
  Dark: {
    label: "Dark",
    bg: "0F172A",
    panel: "1E293B",
    accent: "60A5FA",
    accent2: "A78BFA",
    titleColor: "F9FAFB",
    bodyColor: "D1D5DB",
    headerBg: "1D4ED8",
    headerText: "F9FAFB",
    font: "Calibri",
    dark: true,
  },
};

function getTheme(name) {
  return THEMES[name] || THEMES.Modern;
}

module.exports = { THEMES, getTheme };