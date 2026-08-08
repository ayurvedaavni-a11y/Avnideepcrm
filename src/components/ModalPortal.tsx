import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * ModalPortal — renders a modal into document.body via a React portal.
 *
 * WHY THIS EXISTS (root-cause fix for "global header overlaps modal"):
 * The app shell renders every page inside
 *   <main className="... relative z-0">
 * `position: relative` + `z-index: 0` creates a STACKING CONTEXT on <main>.
 * Any `position: fixed` modal rendered inside <main> is therefore trapped at
 * that stacking level, while the global header (<GlobalSearchAndNav/>,
 * `sticky top-0 z-10`) and the date-filter bar (`z-10`) are SIBLINGS of <main>
 * in the same stacking context. Because z-10 > z-0, the header always paints
 * ABOVE every modal — cutting off the top of tall modals (title, customer
 * name, close button).
 *
 * Rendering the modal through createPortal(document.body) escapes <main>'s
 * stacking context entirely: at the root level the modal's own z-index
 * (z-50 / z-[100] / z-[110]) is above the header's z-10, so the overlay +
 * panel correctly cover the whole viewport, including the header.
 *
 * While open it also locks scrolling of the app content container (see the
 * `body.av-modal-open main` rule in index.css) and restores it on close, so
 * the page behind the modal never scrolls.
 */
// Module-level counter: nested ModalPortals (e.g. Order Details → Edit) each
// add/remove the scroll lock; only the LAST one to close releases it.
let openCount = 0;

export function ModalPortal({ children }: { children: ReactNode }) {
  useEffect(() => {
    openCount += 1;
    if (openCount === 1) {
      document.body.classList.add('av-modal-open');
    }
    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        document.body.classList.remove('av-modal-open');
      }
    };
  }, []);

  return createPortal(children, document.body);
}
