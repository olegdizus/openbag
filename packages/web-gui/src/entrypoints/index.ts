// web-ui/entrypoints/index.ts — generic catch-all bundle.
//
// Loaded on pages that don't have a specific bundle yet (none today, but kept
// for graceful fallback). Always: register toast-region + site-shell elements
// so logout / toasts work on any page.

import "../components/toast-region";
import "../components/site-shell";
