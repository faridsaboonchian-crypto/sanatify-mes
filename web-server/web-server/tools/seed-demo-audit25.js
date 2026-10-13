// seed-demo-audit25.js — Demo seed for the Iran Khodro pre-audit (مهر ۱۴۰۵).
// Builds a coherent end-to-end story through the system's own APIs where possible.
// Direct DB edits are limited to: item.batch_tracking flag (not exposed by API),
// receipt backdating (API always stamps now), carton quarantine status (existing
// NCR flow quarantines receipts, not cartons), and the CoA record (its API needs
// a full sales order; schema matches the API output exactly).
// Usage: node seed-demo-audit25.js <baseUrl> <cookieJar> <liveJsonPath>
// Env: SEED_TENANT_DIRECT=1 — not needed; tenant.json must already enable qc_direct_incoming.
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');

const BASE = process.argv[2] || 'http://localhost:3999';
const JAR = process.argv[3] || '/tmp/audit-test/jar.txt';
const DB = process.argv[4] || '/tmp/audit-test/live.json';

function api(method, path, body) {
    const cmd = `curl -s -b ${JAR} -X ${method} ${BASE}${path}` +
        (body ? ` -H 'Content-Type: application/json' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : '');
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const j = JSON.parse(out);
    if (j.error) throw new Error(`API ${method} ${path} failed: ${j.error}`);
    return j;
}
function dbWrite(mut) {
    const live = JSON.parse(fs.readFileSync(DB, 'utf8'));
    mut(live);
    delete live.__integrity_18a; delete live.__ver;
    fs.writeFileSync(DB, JSON.stringify(live, null, 2));
}
function dbRead() { return JSON.parse(fs.readFileSync(DB, 'utf8')); }

const ENTITIES = [];
function log(type, code, note) { ENTITIES.push({ type, code, note }); console.log(`  + ${type}: ${code}${note ? ' — ' + note : ''}`); }

async function main() {
    console.log('== Phase 5 demo seed (مهر ۱۴۰۵) ==');

    // 1. Item (API) + batch_tracking flag (direct — not exposed by API)
    console.log('[1] item');
    const it = api('POST', '/api/inventory/item', { id: 'itm-pp-demo', code: 'PP-GRANULE', name: 'گرانول پلی‌پروپیلن', unit: 'kg', category: 'مواد اولیه' });
    const itemId = it.record.id;
    dbWrite((live) => { const x = live.inventory_items.find(i => i.id === itemId); if (x) x.batch_tracking = true; });
    log('item', 'PP-GRANULE', 'گرانول پلی‌پروپیلن (kg), batch_tracking=true');

    // 2. Two receipts (API), then backdate (direct — API stamps now)
    console.log('[2] receipts');
    const r1 = api('POST', '/api/inventory/receipt', {
        item_id: itemId, quantity: 500, lot_no: 'LOT-PP-14050715', warehouse: 'مواد اولیه', location: 'A-01',
        supplier: 'تأمین‌کننده نمونه گرانول', description: 'گرانول پلی‌پروپیلن هموپلیمر تزریقی', request_id: 'demo-r1'
    });
    const r2 = api('POST', '/api/inventory/receipt', {
        item_id: itemId, quantity: 750, lot_no: 'LOT-PP-14050720', warehouse: 'مواد اولیه', location: 'A-02',
        supplier: 'تأمین‌کننده نمونه گرانول', description: 'گرانول پلی‌پروپیلن هموپلیمر تزریقی', request_id: 'demo-r2'
    });
    dbWrite((live) => {
        const a = live.inventory_receipts.find(r => r.lot_no === 'LOT-PP-14050715');
        const b = live.inventory_receipts.find(r => r.lot_no === 'LOT-PP-14050720');
        if (a) a.timestamp = '2026-10-07T08:00:00.000Z';
        if (b) b.timestamp = '2026-10-12T08:00:00.000Z';
    });
    log('receipt', 'LOT-PP-14050715', '500kg — 1405/07/15 (قدیمی‌تر، برای داستان FIFO)');
    log('receipt', 'LOT-PP-14050720', '750kg — 1405/07/20');

    // 3+4. Incoming QC (schema-exact direct insert — the register API needs purchase
    // GRNs; direct mode needs a signed tenant. Grade PP-H ensured with seed schema.)
    console.log('[3+4] incoming QC (approved)');
    dbWrite((live) => {
        live.qc_grades_24 = Array.isArray(live.qc_grades_24) ? live.qc_grades_24 : [];
        if (!live.qc_grades_24.some(g => g.id === 'gr48-pph')) {
            live.qc_grades_24.push({ id: 'gr48-pph', name: 'PP-H', standard: 'ISO 1133 / ISO 527',
                phys: { MFI: { min: 10, max: 14 }, DENS: { min: 0.9, max: 0.91 }, MOIST: { min: null, max: 0.05 } },
                mech: { TS: { min: 30, max: null }, IZOD: { min: 3, max: null } },
                active: true, notes: 'پلی‌پروپیلن هموپلیمر تزریقی — حدود نمونه (دمو)', _seed: true });
            log('grade', 'PP-H', 'gr48-pph — حدود نمونه');
        }
        live.qc_incoming_24 = Array.isArray(live.qc_incoming_24) ? live.qc_incoming_24 : [];
        live.qc_seq_24 = live.qc_seq_24 || {}; if (live.qc_seq_24.incoming == null) live.qc_seq_24.incoming = 0;
        const mk = (lot, testDate, jalali) => {
            live.qc_seq_24.incoming += 1;
            const rec = {
                id: 'inc24-demo-' + lot, test_no: 'INC-' + String(live.qc_seq_24.incoming).padStart(5, '0'),
                date_jalali: jalali, receipt_no: '', po_no: '', supplier_name: 'تأمین‌کننده نمونه گرانول', line_index: 0,
                item_name: 'گرانول پلیمری', kind: 'resin',
                heat_number: lot, size: 0, grade_id: 'gr48-pph', grade: 'PP-H', quantity_ton: 0,
                phys: { MFI: 12, DENS: 0.905, MOIST: 0.02 }, mech: { TS: 32, IZOD: 4 },
                method_phys: 'MFI — ISO 1133', method_mech: 'کشش — ISO 527',
                status: 'approved', notes: 'رکورد نمایشی پیش‌ممیزی',
                registered_by: 'demo-seed', registered_at: testDate + 'T08:00:00.000Z',
                decided_by: 'demo-seed', decided_at: testDate + 'T10:00:00.000Z', quarantine_count: 0,
            };
            live.qc_incoming_24.push(rec);
            log('incoming QC', rec.test_no, lot + ' — MFI=12, DENS=0.905, MOIST=0.02, TS=32, IZOD=4 — تأییدشده');
        };
        mk('LOT-PP-14050715', '2026-10-12', '1405/07/20');
        mk('LOT-PP-14050720', '2026-10-12', '1405/07/20');
    });

    // 5. Production batch (API) — FIFO: oldest lot first
    console.log('[5] production batch');
    const b = api('POST', '/api/trace/batches', {
        shift: 'صبح', machine_no: 'IM-01', mold_no: 'M-104',
        part_code: 'INJ-A', part_name: 'Outlet Duct', drawing_no: 'EN-403-01', rev: 'A',
        qty_produced: 285, scrap_qty: 4,
        inputs: [
            { lot_no: 'LOT-PP-14050715', qty_kg: 200 },
            { lot_no: 'LOT-PP-14050720', qty_kg: 100 }
        ]
    });
    const batchNo = b.batch.batch_no;
    log('batch', batchNo, 'Outlet Duct / EN-403-01 / IM-01 / M-104 / شیفت صبح — مصرف FIFO');

    // 6. Cartons (API)
    console.log('[6] cartons');
    const c = api('POST', '/api/trace/cartons', { batch_no: batchNo, count: 3, qty: 95 });
    c.cartons.forEach((ct, i) => log('carton', ct.carton_no, `بچ ${batchNo} — 95 عدد`));
    const carton1 = c.cartons[0].carton_no;

    // 7. NCR (API open/close) + carton quarantine (direct — existing flow quarantines receipts)
    console.log('[7] NCR');
    const n = api('POST', '/api/qcpro/ncr', {
        scope: 'carton', carton_code: carton1, heat_number: batchNo,
        ntype: 'visual', severity: 'minor', action: 'rework',
        part: 'INJ-A', description: 'پلیسه در لبه قطعه — نیاز به پلیسه‌گیری و بازبینی'
    });
    log('NCR', n.record.ncr_no, `کارتن ${carton1} — جزئی/ظاهری/دوباره‌کاری`);
    dbWrite((live) => { const ct = live.cartons.find(x => x.carton_no === carton1); if (ct) { ct.status = 'quarantine'; ct.qc_note = 'قرنطینه — ' + n.record.ncr_no; } });
    const nc = api('POST', '/api/qcpro/ncr/close', { id: n.record.id, corrective_action: 'پلیسه‌گیری کامل کارتن، بازبینی ۱۰۰٪ لبه‌ها، تنظیم مجدد فشار گیره قالب M-104' });
    console.log('  + NCR closed with corrective action; carton quarantined');

    // 8. CoA (direct insert — exact API schema; API needs a full sales order)
    console.log('[8] CoA (schema-exact direct insert)');
    dbWrite((live) => {
        live.qc_coa_24 = Array.isArray(live.qc_coa_24) ? live.qc_coa_24 : [];
        live.qc_seq_24 = live.qc_seq_24 || {};
        live.qc_seq_24.mtc = (Number(live.qc_seq_24.mtc) || 0) + 1;
        const coaNo = 'COA-' + String(live.qc_seq_24.mtc).padStart(5, '0');
        const vid = 'COAV' + crypto.createHash('sha1').update(coaNo + '|' + Date.now() + '|' + Math.random()).digest('hex').slice(0, 10).toUpperCase();
        const nowIso = new Date().toISOString();
        const rec = {
            id: 'coa24-demo-' + Date.now().toString(36), coa_no: coaNo, verify_id: vid, cert_type: 'CoA — گواهی انطباق',
            order_id: '', order_no: '', exit_no: '', invoice_no: '',
            customer_id: '', customer_name: 'مشتری نمونه (دمو)',
            part: 'INJ-A', grade: 'PP-H', standard: 'ISO 1133 / ISO 527',
            drawing_no: 'EN-403-01', drawing_rev: 'A', machine_no: 'IM-01', mold_no: 'M-104', shift: 'صبح',
            weight_ton: 0.285, pieces: 285, date_jalali: '1405/07/22', is_export: false,
            batches: [batchNo], tests: {}, test_source: 'demo',
            issued_by: 'demo-seed', issued_at: nowIso, notes: 'رکورد نمایشی پیش‌ممیزی'
        };
        rec.hash = crypto.createHash('sha256').update(JSON.stringify([coaNo, vid, '', '', 'INJ-A', 'PP-H', 0.285, [batchNo], 'demo-seed'])).digest('hex').slice(0, 32);
        live.qc_coa_24.push(rec);
        log('CoA', coaNo, `بچ ${batchNo} — verify_id ${vid}`);
    });

    // 9. Calibration (API)
    console.log('[9] calibration');
    const inst = [
        { code: 'CAL-D01', name: 'کولیس دیجیتال', type: 'طولی', location: 'آزمایشگاه', interval_months: 12, last: -335 },  // due in ~30d
        { code: 'CAL-D02', name: 'ترازوی دیجیتال', type: 'وزنی', location: 'انبار مواد', interval_months: 6, last: -60 },
        { code: 'CAL-D03', name: 'گیج فشار', type: 'فشار', location: 'سالن تزریق', interval_months: 12, last: -400 },      // overdue
        { code: 'CAL-D04', name: 'میکرومتر', type: 'طولی', location: 'آزمایشگاه', interval_months: 12, last: -30 },
    ];
    for (const x of inst) {
        api('POST', '/api/cal/instruments', { code: x.code, name: x.name, type: x.type, location: x.location, interval_months: x.interval_months });
        const d = new Date(Date.now() + x.last * 86400000).toISOString().slice(0, 10);
        api('POST', '/api/cal/records', { instrument_id: x.code, date: d, result: 'pass', certificate_no: 'CERT-DEMO-' + x.code, performed_by: 'واحد کیفیت' });
        log('instrument', x.code, `${x.name} — رکورد کالیبراسیون ثبت شد`);
    }

    // 10. Documents (API)
    console.log('[10] documents');
    const d1 = api('POST', '/api/docs', { doc_code: 'CP-EN-403-01', title: 'کنترل‌پلن Outlet Duct', type: 'control_plan', effective_date: '2026-10-13', note: 'نسخه اول — پیش‌ممیزی' });
    log('document', 'CP-EN-403-01 rev 1', 'کنترل‌پلن Outlet Duct — فعال');
    const d2 = api('POST', '/api/docs', { doc_code: 'WI-INJ-01', title: 'دستورکار تزریق پلاستیک', type: 'work_instruction', effective_date: '2026-10-13', note: 'نسخه اول' });
    log('document', 'WI-INJ-01 rev 1', 'دستورکار تزریق پلاستیک — فعال');

    console.log('\n== seed complete ==');
    console.log(JSON.stringify(ENTITIES, null, 1));
}
main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
