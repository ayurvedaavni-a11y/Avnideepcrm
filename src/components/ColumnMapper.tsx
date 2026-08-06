import { useMemo } from 'react';
import Truck from 'lucide-react/dist/esm/icons/truck'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import { ColumnMapping } from '../db/courierEngine';
import { safeMoney } from '../lib/safe';

interface Props {
  columns: string[];
  mapping: ColumnMapping;
  sampleRows: any[];
  courierName: string;
  onChange: (mapping: ColumnMapping) => void;
}

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean; color: string }[] = [
  { key: 'phone', label: 'Phone Number', required: true, color: 'border-l-blue-500' },
  { key: 'tracking', label: 'AWB / Tracking ID', required: true, color: 'border-l-indigo-500' },
  { key: 'cod', label: 'COD Amount', required: true, color: 'border-l-emerald-500' },
  { key: 'status', label: 'Shipment Status', required: true, color: 'border-l-amber-500' },
  { key: 'name', label: 'Customer Name', required: false, color: 'border-l-slate-400' },
  { key: 'orderId', label: 'Order ID', required: false, color: 'border-l-slate-400' },
  { key: 'product', label: 'Product', required: false, color: 'border-l-slate-400' },
  { key: 'address', label: 'Address', required: false, color: 'border-l-slate-400' },
  { key: 'city', label: 'City', required: false, color: 'border-l-slate-400' },
  { key: 'state', label: 'State', required: false, color: 'border-l-slate-400' },
  { key: 'pincode', label: 'Pincode', required: false, color: 'border-l-slate-400' },
  { key: 'date', label: 'Date', required: false, color: 'border-l-slate-400' },
  { key: 'courier', label: 'Courier Name', required: false, color: 'border-l-slate-400' },
  { key: 'quantity', label: 'Quantity', required: false, color: 'border-l-slate-400' },
];

export function ColumnMapper({ columns, mapping, sampleRows, courierName, onChange }: Props) {
  const sampleVals = useMemo(() => {
    const vals: Record<string, string[]> = {};
    for (const f of FIELDS) {
      const col = mapping[f.key];
      vals[f.key] = sampleRows.slice(0, 5).map(row => {
        if (!col) return '';
        return row[col] !== undefined && row[col] !== null ? String(row[col]) : '';
      });
    }
    return vals;
  }, [mapping, sampleRows]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
        <Truck size={20} className="text-purple-600" />
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Column Mapping — <span className="text-purple-700">{courierName}</span></h3>
          <p className="text-xs text-slate-500">{columns.length} columns detected • Auto-mapped below • Adjust if needed</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
              <th className="p-3 w-36">CRM Field</th>
              <th className="p-3 w-56">Mapped Column</th>
              <th className="p-3">Sample Values (first 5 rows)</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(field => {
              const currentCol = mapping[field.key] || '';
              const isMapped = !!currentCol;
              const hasConflict = isMapped && Object.entries(mapping).filter(([k, v]) => v === currentCol && k !== field.key).length > 0;
              
              // For COD: show parsed values
              const showParsed = field.key === 'cod' && isMapped;
              
              return (
                <tr key={field.key} className={`border-b border-slate-100 hover:bg-slate-50/50 transition ${!isMapped ? 'bg-red-50/30' : ''}`}>
                  <td className={`p-3 border-l-2 ${field.color} ${field.required && !isMapped ? 'font-bold' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span>{field.label}</span>
                      {field.required && <span className="text-red-500 text-xs">*</span>}
                    </div>
                    {!isMapped && field.required && (
                      <span className="text-[10px] text-red-600 font-medium">⚠ Not mapped</span>
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      value={currentCol}
                      onChange={(e) => {
                        const newMapping = { ...mapping };
                        // Remove any existing assignment of this column to avoid conflicts
                        for (const k of Object.keys(newMapping)) {
                          if ((newMapping as any)[k] === e.target.value) {
                            (newMapping as any)[k] = '';
                          }
                        }
                        (newMapping as any)[field.key] = e.target.value || undefined;
                        onChange(newMapping);
                      }}
                      className={`w-full p-1.5 border rounded-lg text-sm outline-none focus:ring-2 ${
                        hasConflict ? 'border-red-300 focus:ring-red-500 bg-red-50' :
                        !isMapped && field.required ? 'border-red-300 focus:ring-red-500' :
                        'border-slate-300 focus:ring-blue-500'
                      }`}
                    >
                      <option value="">-- Not mapped --</option>
                      {columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                    {hasConflict && <p className="text-[10px] text-red-600 mt-0.5">⚠ Multiple fields map to same column</p>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {sampleVals[field.key]?.map((val, i) => (
                        <div key={i} className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          val ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-300'
                        }`}>
                          {val || '(empty)'}
                          {showParsed && val && (
                            <span className="text-emerald-600 ml-1">→ ₹{safeMoney(val)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {sampleVals[field.key]?.length === 0 && <span className="text-xs text-slate-400 italic">No data</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detection confidence */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center gap-2">
        {mapping.cod && sampleVals.cod?.some(v => safeMoney(v) > 0) ? (
          <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle size={14} /> COD column confirmed: values detected
          </span>
        ) : mapping.cod ? (
          <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
            <AlertTriangle size={14} /> COD column mapped but sample shows 0 values — verify correct column
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-700 font-medium">
            <AlertTriangle size={14} /> COD column not mapped — amounts will be ₹0
          </span>
        )}
      </div>
    </div>
  );
}
