// bulkimport-repro.mjs — reproduces BulkImport.tsx parse + preview logic in Node
// to pinpoint the production crash. Uses the project's exceljs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

// ---- exact copy of BulkImport.tsx parse (handleFileUpload) ----
function parseWorkbook(workbook) {
  const allData = [];
  for (const ws of workbook.worksheets) {
    const headers = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) {
        row.eachCell((cell) => headers.push(cell.value?.toString() || ''));
      } else {
        const obj = {};
        let ci = 0;
        row.eachCell((cell) => { obj[headers[ci]] = String(cell.value ?? ''); ci++; });
        allData.push(obj);
      }
    });
  }
  return allData;
}

// ---- exact copy of the preview render's risky operations ----
function simulateRender(allData) {
  const preview = allData.slice(0, 10);
  const rendered = [];
  for (const row of preview) {
    const keys = Object.keys(row);           // thead
    const vals = Object.values(row);          // tbody cells
    rendered.push({ keys, cellCount: vals.length });
  }
  return rendered;
}

async function run() {
  // ---- TEST 1: sample XLSX (like exportSample generates) ----
  console.log('=== TEST 1: Sample XLSX ===');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sample');
    ws.addRow(['Name', 'Mobile', 'Product', 'Amount', 'Status', 'Source', 'Notes', 'Address', 'City', 'State', 'Pincode']);
    ws.addRow(['Rahul Sharma', '9988776655', 'Wireless Earbuds', 1499, 'New Lead', 'Facebook', '', 'Delhi', 'Delhi', 'Delhi', '110001']);
    const buf = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readBuffer(buf);
    const data = parseWorkbook(wb2);
    console.log('rows parsed:', data.length, '| first row:', JSON.stringify(data[0]));
    console.log('render-safe:', JSON.stringify(simulateRender(data)));
  }

  // ---- TEST 2: CSV via workbook.xlsx.readBuffer (CURRENT broken path) ----
  console.log('\n=== TEST 2: CSV via xlsx.readBuffer (current code path) ===');
  {
    const csv = 'Name,Mobile,Product,Amount,Status\nRahul,9988776655,Earbuds,499,New Lead\n';
    const buf = Buffer.from(csv, 'utf-8');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readBuffer(buf);
      console.log('CSV parsed OK via xlsx.readBuffer');
    } catch (e) {
      console.log('CSV FAILED via xlsx.readBuffer →', e.message?.slice(0, 120));
      console.log('=> CSV upload is BROKEN on the Bulk Import page (caught, shows "Failed to parse file")');
    }
  }

  // ---- TEST 3: CSV via workbook.csv.readBuffer (correct path) ----
  console.log('\n=== TEST 3: CSV via csv.readBuffer (correct path) ===');
  {
    const csv = 'Name,Mobile,Product,Amount,Status\nRahul,9988776655,Earbuds,499,New Lead\n';
    const buf = Buffer.from(csv, 'utf-8');
    const wb = new ExcelJS.Workbook();
    try {
      const ws = await wb.csv.readBuffer(buf);
      console.log('CSV parsed OK via csv.readBuffer — headers:', JSON.stringify(ws.getRow(1).values.filter(Boolean)));
    } catch (e) {
      console.log('CSV csv.readBuffer FAILED →', e.message?.slice(0, 120));
    }
  }

  // ---- TEST 4: sparse/empty cells (row.eachCell skips empties → misaligned headers) ----
  console.log('\n=== TEST 4: XLSX with sparse cells (empty middle columns) ===');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Mobile', 'Product', 'Amount']);
    ws.addRow(['Rahul', '9988776655', '', 499]); // empty Product cell
    const buf = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readBuffer(buf);
    const data = parseWorkbook(wb2);
    console.log('parsed row:', JSON.stringify(data[0]), '← NOTE: Product value shifted to Amount column');
  }

  // ---- TEST 5: file with ONLY a header row ----
  console.log('\n=== TEST 5: Header-only file ===');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Mobile']);
    const buf = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readBuffer(buf);
    const data = parseWorkbook(wb2);
    console.log('rows parsed:', data.length, '(preview empty → no crash)');
  }

  // ---- TEST 6: Excel DATE cells (cell.value is a Date object) ----
  console.log('\n=== TEST 6: Date-valued cells ===');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Mobile', 'Followup Date']);
    ws.addRow(['Rahul', '9988776655', new Date('2026-08-10')]);
    const buf = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readBuffer(buf);
    const data = parseWorkbook(wb2);
    console.log('parsed row:', JSON.stringify(data[0]));
    console.log('render-safe:', JSON.stringify(simulateRender(data)));
  }

  console.log('\n=== DONE ===');
}

run().catch((e) => { console.error('REPRO CRASH:', e); process.exit(1); });
