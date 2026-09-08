// Shared design tokens for geoaid-mobile.
//
// These mirror the brand palette already used on the marketing/landing
// page (GEOAID_frontend/src/pages/landing/landing.css) so the mobile app
// and the web landing page read as the same product:
//   --primary blue:  #2563eb   (links, primary actions, focus states)
//   --dark navy:     #0f172a   (headings, dark buttons/nav)
//   --accent green:  #16a34a   (success, positive/CTA emphasis)
//   --muted text:    #64748b   (secondary/help text)
//
// Import this instead of hardcoding hex values in a screen's
// StyleSheet so a future palette tweak only has to happen once.

export const COLORS = {
  // Brand
  primary: "#2563eb",
  primaryDark: "#1d4ed8", // pressed/active state for primary buttons
  dark: "#0f172a", // headings, dark surfaces (nav, dark CTA buttons)
  accent: "#16a34a", // success / register / positive emphasis
  accentDark: "#15803d", // accent text on light backgrounds (better contrast)

  // Text
  textBody: "#111827",
  textMuted: "#64748b",
  textLabel: "#374151",
  textFaint: "#9aa3af",
  white: "#ffffff",

  // Surfaces
  bg: "#ffffff",
  bgMuted: "#f5f7fa",
  border: "#d1d5db",
  borderLight: "#e5e7eb",

  // Feedback
  danger: "#b42318",
  dangerBg: "#fdecec",
  dangerBorder: "#f5b5b5",
  warningText: "#8a5a00",
  warningBg: "#fff4e5",
  warningBorder: "#ffdca8",
  infoText: "#1d4ed8",
  infoBg: "#eaf3ff",
  infoBorder: "#bcdcff",
  successText: "#15803d",
  successBg: "#f0fdf4",
  successBorder: "#bbf7d0",
};

export const RADIUS = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
};

// Minimum readable sizes for a mobile screen — nothing in the app should
// go below FONT.xs (12) for any text a resident needs to read, per
// accessibility guidance for small screens.
export const FONT = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 15,
  xl: 17,
  heading: 20,
  headingLg: 22,
};

export default { COLORS, RADIUS, FONT };
