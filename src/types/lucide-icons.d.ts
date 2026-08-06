// Type declarations for individual lucide-react icon imports
// Vite/esbuild resolves these to .mjs files at build time,
// but tsc needs type declarations for them.
declare module 'lucide-react/dist/esm/icons/*' {
  import type { LucideIcon } from 'lucide-react';
  const icon: LucideIcon;
  export default icon;
}
