// AVNIDEEP CRM PRO — Global Date Filter Component
// Quick filters: Today, Yesterday, Last 7 Days, Last 30 Days, This Month, Last Month, This Year, Custom Range
// Integrates with DateFilterContext for cross-module consistency.

import { useState, useRef, useEffect } from 'react';
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import X from 'lucide-react/dist/esm/icons/x'
import { useDateFilter, DatePreset, QUICK_PRESETS, PRESET_LABELS } from '../context/DateFilterContext';
import { cn } from '../lib/utils';

export function GlobalDateFilter() {
  const { state, range, setPreset, setCustomRange, clearFilter, activeLabel } = useDateFilter();
  const [isOpen, setIsOpen] = useState(false);
  const [customStart, setCustomStart] = useState(state.customStart);
  const [customEnd, setCustomEnd] = useState(state.customEnd);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync local custom state with context
  useEffect(() => {
    setCustomStart(state.customStart);
    setCustomEnd(state.customEnd);
  }, [state.customStart, state.customEnd]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePresetClick = (preset: DatePreset) => {
    if (preset === 'custom') {
      // When clicking Custom, keep dropdown open to show date inputs
      return;
    }
    setPreset(preset);
    setIsOpen(false);
  };

  const handleApplyCustom = () => {
    if (customStart && customEnd) {
      setCustomRange(customStart, customEnd);
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    clearFilter();
    setCustomStart('');
    setCustomEnd('');
    setIsOpen(false);
  };

  const isFilterActive = state.preset !== 'all';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200',
          isFilterActive
            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
            : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50'
        )}
      >
        <Calendar size={16} className={isFilterActive ? 'text-blue-500' : 'text-slate-400'} />
        <span>{activeLabel}</span>
        <ChevronDown size={14} className={cn('transition-transform duration-200', isOpen && 'rotate-180')} />
        {isFilterActive && (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-[680px] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Quick Preset Grid */}
          <div className="p-4 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Quick Filters</div>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_PRESETS.map((preset) => {
                const isActive = state.preset === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => {
                      if (preset === 'custom') {
                        setPreset('custom');
                      } else {
                        handlePresetClick(preset);
                      }
                    }}
                    className={cn(
                      'px-3 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 border',
                      isActive
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-[1.02]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                    )}
                  >
                    {PRESET_LABELS[preset]}
                    {isActive && preset !== 'custom' && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-white/70" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Date Range Inputs */}
          <div className="p-4 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Custom Date Range</div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-medium text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
                  max={customEnd || undefined}
                />
              </div>
              <div className="flex items-center pt-5">
                <span className="text-slate-400 text-sm">→</span>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-medium text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
                  min={customStart || undefined}
                />
              </div>
              <div className="flex items-end gap-2 pt-5">
                <button
                  onClick={handleApplyCustom}
                  disabled={!customStart || !customEnd}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 bg-slate-50 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {range.start && range.end ? (
                <span>
                  Showing data from{' '}
                  <strong>{range.start.toLocaleDateString('en-IN')}</strong> to{' '}
                  <strong>{range.end.toLocaleDateString('en-IN')}</strong>
                </span>
              ) : (
                <span>Showing all data (no date filter)</span>
              )}
            </div>
            {isFilterActive && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              >
                <X size={14} /> Clear Filter
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
