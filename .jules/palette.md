## 2024-04-12 - Icon-only buttons lacking ARIA labels
**Learning:** The application uses several icon-only buttons via the Material Symbols font, which are visually clear but lack context for screen readers.
**Action:** Always verify icon-only buttons include an `aria-label` attribute explaining their function.

## 2024-05-26 - Keyboard navigation focus indicators
**Learning:** Tailwind CSS's preflight resets default browser focus outlines. When creating custom interactive elements (like `.btn-primary` and `.btn-secondary`), explicit `:focus-visible` styles must be added to ensure keyboard accessibility, otherwise they appear unfocusable to keyboard users.
**Action:** Always verify that custom buttons and interactive elements include explicitly defined `:focus-visible` styles.
