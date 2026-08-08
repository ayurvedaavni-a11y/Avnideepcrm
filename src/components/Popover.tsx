import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Popover — the ONE shared dropdown/popover layer for the whole CRM.
 *
 * WHY IT EXISTS (permanent root-cause fix for clipped/hidden dropdowns):
 * The app shell renders every page inside
 *   <main className="... relative z-0 overflow-y-auto">
 * `relative` + `z-index: 0` creates a STACKING CONTEXT on <main>, and
 * `overflow-y-auto` CLIPS absolutely-positioned children. So any dropdown
 * rendered inline (`absolute top-full`) is (a) trapped at main's z-0 level —
 * the header/sidebar/date-bar (z-10, z-50) always paint above it — and
 * (b) cut off by the scroll container. That's why dropdowns appeared behind
 * the sidebar/header or got clipped.
 *
 * This component renders through createPortal(document.body), escaping main's
 * stacking context AND every overflow container. It positions itself with
 * fixed coordinates from the trigger's getBoundingClientRect, flips upward
 * when there's not enough space below, clamps to the viewport on all sides,
 * and sits on the dedicated global popover layer (z-index 60, see index.css)
 * — above header/sidebar/cards, below modals (100+) and toasts (9999).
 *
 * Mobile: max-width is capped to the viewport and the panel scrolls
 * internally, so it can never overflow the screen.
 */

export interface PopoverProps {
  /** The trigger element we anchor to (must be positioned/measured). */
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Preferred width of the panel (default 320px). */
  width?: number;
  /** Extra class applied to the panel. */
  className?: string;
  /** When true, also close on scroll/resize (e.g. autocomplete lists). */
  closeOnScroll?: boolean;
  /** Optional backdrop behind the popover (closes on click). */
  backdrop?: boolean;
}

export function Popover({
  anchor,
  open,
  onClose,
  children,
  width = 320,
  className = '',
  closeOnScroll = false,
  backdrop = false,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Outside click + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (anchor && anchor.contains(t)) return; // trigger toggles it
      if (panelRef.current && panelRef.current.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  // Position the panel: below the anchor, flip up when space is short, clamp
  // horizontally and cap height to the visible viewport.
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const place = () => {
      const ar = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Measure the panel (it is already in the DOM at this point).
      const pw = panelRef.current?.offsetWidth || width;
      const ph = panelRef.current?.offsetHeight || 240;

      const spaceBelow = vh - ar.bottom;
      const spaceAbove = ar.top;
      const placeBelow = spaceBelow >= Math.min(ph, 320) || spaceBelow >= spaceAbove;

      let top: number;
      let maxHeight: number;
      if (placeBelow) {
        top = ar.bottom + 6;
        maxHeight = vh - top - 8;
      } else {
        top = Math.max(8, ar.top - ph - 6);
        maxHeight = Math.max(8, ar.top - 8);
      }
      // Clamp so the panel never leaves the screen horizontally.
      const left = Math.max(8, Math.min(ar.left, vw - pw - 8));
      setPos({ top, left, maxHeight });
    };
    place();
    // Re-measure after paint (fonts/layout can shift the first measure).
    const raf = requestAnimationFrame(() => place());
    window.addEventListener('resize', place);
    // Reposition on ANY scroll, capture-phase: the page content lives inside
    // <main className="overflow-y-auto">, so inner-container scrolls never
    // fire plain window 'scroll' events — capture=true catches them all and
    // keeps the panel glued to its trigger.
    window.addEventListener('scroll', place, true);
    // Autocomplete lists additionally close on scroll (typing-list UX).
    if (closeOnScroll) window.addEventListener('scroll', onClose, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      if (closeOnScroll) window.removeEventListener('scroll', onClose, true);
    };
  }, [open, anchor, width, closeOnScroll, onClose]);

  if (!open) return null;

  const panel = (
    <div
      ref={panelRef}
      className={`av-popover-layer fixed z-[60] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-y-auto av-scroll-thin ${className}`}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: pos ? Math.min(width, (typeof window !== 'undefined' ? window.innerWidth - 16 : width)) : width,
        maxHeight: pos?.maxHeight ?? 320,
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="menu"
    >
      {children}
    </div>
  );

  if (!backdrop) return createPortal(panel, document.body);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[59] bg-transparent" onClick={onClose} />
      {panel}
    </>,
    document.body
  );
}
