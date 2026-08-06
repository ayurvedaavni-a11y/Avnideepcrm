import { useMemo } from 'react';
import { safeMoney } from '../lib/safe';
import { ColumnMapping } from '../db/courierEngine';

interface Props {
  rows: any[];
  mapping: ColumnMapping;
  maxRows?: number;
}

export function ImportPreviewTable({ rows, mapping, maxRows = 8 }: Props) {
  const preview = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);
  const map = mapping as any; // Use any cast to access optional fields safely

  const fields = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'tracking', label: 'AWB' },
    { key: 'cod', label: 'COD' },
    { key: 'status', label: 'Status' },
    { key: 'product', label: 'Product' },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold">
            <th className="p-3">#</th>
            {fields.map(f => (<th key={f.key} className="p-3">{f.label}</th>))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, idx) => (
            <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="p-3 text-slate-400">{idx + 1}</td>
              {fields.map(f => {
                const col = map[f.key];
                const raw = col ? row[col] : '';
                const val = raw !== undefined && raw !== null ? String(raw) : '';
                let display = val || '—';
                let className = 'text-slate-700';
                if (f.key === 'cod' && val) {
                  const money = safeMoney(val);
                  display = `₹${money.toFixed(2)}`;
                  className = money > 0 ? 'font-bold text-emerald-600' : 'text-slate-400';
                }
                if (f.key === 'phone' && val) display = val.replace(/\D/g,'').slice(0,10);
                if (!val) className = 'text-slate-300 italic';
                return (<td key={f.key} className={`p-3 max-w-[200px] truncate ${className}`}>{display}</td>);
              })}
            </tr>
          ))}
          {preview.length === 0 && (<tr><td colSpan={7} className="p-8 text-center text-slate-400">No data</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
