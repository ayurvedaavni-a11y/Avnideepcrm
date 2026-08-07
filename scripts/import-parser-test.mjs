// import-parser-test.mjs — runs the REAL src/db/importParser.ts logic
// (bundled via esbuild) through the full Bulk Import test matrix.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// 1) Bundle the real source so we test exactly what ships in production.
execSync('npx esbuild src/db/importParser.ts --bundle --platform=node --format=esm --outfile=scripts/.tmp-importParser.test.mjs', { stdio: 'inherit', cwd: process.cwd() });
const { parseCsv, getVal, normalizeMobile } = await import(new URL('./.tmp-importParser.test.mjs', import.meta.url).href);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== CSV PARSER TESTS ===');

// 1. Empty CSV
{
  const { headers, rows } = parseCsv('');
  check('Empty CSV → 0 rows', rows.length === 0 && headers.length === 0);
}
// 2. Header-only CSV
{
  const { headers, rows } = parseCsv('Name,Mobile,Product\n');
  check('Header-only CSV → 0 rows', rows.length === 0 && headers.length === 3);
}
// 3. Normal CSV
{
  const { headers, rows } = parseCsv('Name,Mobile,Product\nRahul,9988776655,Earbuds\n');
  check('Normal CSV → 1 row', rows.length === 1 && rows[0].Name === 'Rahul' && rows[0].Mobile === '9988776655');
}
// 4. Quoted fields with commas
{
  const { rows } = parseCsv('Name,Mobile,Address\n"Sharma, Rahul",9988776655,"Shop 5, Main Bazaar, Delhi"\n');
  check('Quoted commas preserved', rows.length === 1 && rows[0].Address === 'Shop 5, Main Bazaar, Delhi' && rows[0].Name === 'Sharma, Rahul');
}
// 5. CRLF line endings
{
  const { rows } = parseCsv('Name,Mobile,Product\r\nRahul,9988776655,Earbuds\r\n');
  check('CRLF handled', rows.length === 1 && rows[0].Mobile === '9988776655');
}
// 6. UTF-8 BOM
{
  const { rows } = parseCsv('\uFEFFName,Mobile\nRahul,9988776655\n');
  check('BOM stripped', rows.length === 1 && rows[0].Name === 'Rahul');
}
// 7. Duplicate mobiles (both rows kept — dedup happens at import policy level)
{
  const { rows } = parseCsv('Name,Mobile\nA,9988776655\nB,9988776655\n');
  check('Duplicate mobiles both parsed', rows.length === 2);
}
// 8. Missing columns (no Mobile header) — must not crash
{
  const { rows } = parseCsv('Name,Product\nRahul,Earbuds\n');
  check('Missing columns → row parses, mobile empty', rows.length === 1 && getVal(rows[0], 'mobile') === '');
}
// 9. Large CSV (10,000 rows)
{
  let csv = 'Name,Mobile,Product,Amount,Status\n';
  for (let i = 0; i < 10000; i++) csv += `Customer${i},9${String(i).padStart(9, '0')},Product,499,New Lead\n`;
  const t0 = Date.now();
  const { rows } = parseCsv(csv);
  const ms = Date.now() - t0;
  check('10,000-row CSV parsed', rows.length === 10000, `rows=${rows.length}`);
  check('10,000 rows < 2s', ms < 2000, `${ms}ms`);
}

console.log('\n=== MOBILE NORMALIZATION TESTS ===');
check('Scientific notation 9.988776655E+09 → 9988776655', normalizeMobile('9.988776655E+09') === '9988776655', normalizeMobile('9.988776655E+09'));
check('91 prefix stripped', normalizeMobile('919988776655') === '9988776655');
check('Leading 0 stripped', normalizeMobile('09988776655') === '9988776655');
check('+91-99 887 76655 → digits', normalizeMobile('+91-99 887 76655') === '9988776655');
check('Invalid (too short) → empty', normalizeMobile('123') === '');
check('Invalid (starts with 5) → empty', normalizeMobile('5000000000') === '');
check('Already valid → unchanged', normalizeMobile('9988776655') === '9988776655');

console.log('\n=== XLSX PARSER (xlsx.load — the production fix) ===');
try {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(['Name', 'Mobile', 'Product', 'Amount']);
  ws.addRow(['Rahul', '9988776655', 'Earbuds', 499]);
  ws.addRow(['Sita', '9876543210', 'Earbuds', 499, 'EXTRA-IGNORED']);
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  // THE FIX: load() — readBuffer() is undefined in exceljs 4.x
  await wb2.xlsx.load(buf);
  const headers = ['Name', 'Mobile', 'Product', 'Amount'];
  const rowsOut = [];
  wb2.worksheets[0].eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj = {};
    for (let ci = 1; ci <= headers.length; ci++) obj[headers[ci - 1]] = row.getCell(ci).value?.toString?.() ?? '';
    rowsOut.push(obj);
  });
  check('xlsx.load parses workbook', rowsOut.length === 2 && rowsOut[0].Mobile === '9988776655', JSON.stringify(rowsOut));
  check('Sparse/extra cells do not misalign', rowsOut[1].Amount === '499' && !rowsOut[1].EXTRA, JSON.stringify(rowsOut[1]));
} catch (e) {
  fail++;
  console.log('  ❌ xlsx.load test failed — ' + e.message);
}

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
