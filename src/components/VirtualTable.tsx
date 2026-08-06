// AVNIDEEP CRM PRO — Reusable Virtual Scrolling Table Component
// Uses @tanstack/react-virtual to render only visible rows.
// Div-based layout for proper virtual scrolling with variable row heights.
// Columns are aligned using CSS grid with user-defined widths.

import { useRef, useCallback, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Helper to compute the total minimum width of all columns for horizontal scroll.
 * Sums all `width` values that are px-based; falls back to 100%.
 */
function getTotalMinWidth(columns: { width: string }[]): string {
  const pxTotal = columns.reduce((sum, col) => {
    const match = col.width.match(/^(\d+)px$/);
    return sum + (match ? parseInt(match[1]) : 0);
  }, 0);
  return pxTotal > 0 ? `${pxTotal}px` : '100%';
}

export interface VirtualTableColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS width e.g. '180px', '1fr', '15%' */
  width: string;
  /** Optional alignment */
  align?: 'left' | 'center' | 'right';
  /** Extra class on header and cell */
  className?: string;
  /** Render function for each cell */
  render: (item: T, index: number) => ReactNode;
}

interface VirtualTableProps<T> {
  data: T[];
  columns: VirtualTableColumn<T>[];
  /** Estimated row height in px (default: 60) */
  estimateSize?: number;
  /** Additional class on outer wrapper */
  className?: string;
  /** Container max-height (default: 600) */
  height?: number;
  /** Override key extraction */
  getKey?: (item: T, index: number) => string | number;
  /** Empty state content */
  emptyState?: ReactNode;
  /** Row class based on item */
  rowClassName?: (item: T, index: number) => string;
}

export function VirtualTable<T extends { id?: number | string }>({
  data,
  columns,
  estimateSize = 60,
  className = '',
  height = 600,
  getKey,
  emptyState,
  rowClassName,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const getItemKey = useCallback(
    (index: number) => {
      const item = data[index];
      if (getKey) return getKey(item, index);
      return item?.id ?? index;
    },
    [data, getKey]
  );

  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    getItemKey,
    overscan: 5,
  });

  // Build CSS grid template from column widths
  const gridTemplateColumns = columns.map((c) => c.width).join(' ');

  if (data.length === 0) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
        {emptyState || (
          <div className="flex items-center justify-center" style={{ height }}>
            <p className="text-slate-400 text-sm">No data to display</p>
          </div>
        )}
      </div>
    );
  }

  const { getVirtualItems, getTotalSize } = rowVirtualizer;
  const totalMinWidth = getTotalMinWidth(columns);

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {/* Single scrollable container — header + rows scroll HORIZONTALLY together */}
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: height }}>
        {/* Sticky header: scrolls horizontally with body, stays fixed vertically */}
        <div
          className="grid bg-slate-100 text-slate-500 text-xs uppercase font-bold tracking-wider border-b border-slate-200 sticky top-0 z-10"
          style={{
            gridTemplateColumns,
            minWidth: totalMinWidth,
          }}
        >
          {columns.map((col) => (
            <div
              key={col.key}
              className={`p-4 ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'} ${col.className || ''}`}
            >
              {col.header}
            </div>
          ))}
        </div>

        {/* Virtual rows container */}
        <div
          style={{
            height: getTotalSize(),
            width: '100%',
            minWidth: totalMinWidth,
            position: 'relative',
          }}
        >
          {getVirtualItems().map((virtualRow) => {
            const item = data[virtualRow.index];
            const defaultRowClass = 'border-b border-slate-100 hover:bg-slate-50 transition-colors';
            const extraClass = rowClassName?.(item, virtualRow.index) || '';

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={`${defaultRowClass} ${extraClass}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns,
                    minHeight: `${estimateSize}px`,
                  }}
                >
                  {columns.map((col) => (
                    <div
                      key={col.key}
                      className={`p-4 flex items-center text-sm ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : 'justify-start'} ${col.className || ''}`}
                    >
                      {col.render(item, virtualRow.index)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
