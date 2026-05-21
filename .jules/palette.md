## 2026-04-18 - Semantic Tabs for Bottom Navigation
**Learning:** Interactive elements like bottom navigation tabs should use semantic `<button>` elements with `role='tab'` instead of `<div>` to ensure screen readers properly announce them as interactive tabs rather than generic text blocks. Sighted keyboard users also need visible focus indicators, so when resetting native button styles with `outline: none`, a `:focus-visible` fallback must be provided.
**Action:** When implementing custom navigation or tab components, ensure the container has `role="tablist"`, items use `<button>` tags with `role="tab"` and `aria-selected` attributes, non-semantic icons have `aria-hidden="true"`, and focus states are clearly visible via `:focus-visible`.

## 2024-04-24 - Adaptive Loading Spinners
**Learning:** For UI components like loading spinners that need to contrast against variable backgrounds (e.g., both dark primary buttons and light secondary buttons), using hardcoded colors like `#c6c6c6` and `#000000` causes visibility issues on some themes or components.
**Action:** Use `currentColor` for border styling to automatically inherit the text color of the parent element, and `transparent` for the `border-top-color` to create the spinning effect. This prevents the need for multiple color-specific variants and ensures visibility everywhere.

## 2026-04-30 - Aria Hidden Icons
**Learning:** Screen readers announce text-based ligatures out loud. Using `.material-symbols-outlined` with text like 'arrow_forward' means the screen reader says "arrow forward".
**Action:** When adding decorative icons or icons embedded inside buttons with text, always include `aria-hidden="true"` to hide the ligature text from assistive tech.
