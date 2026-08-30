
        const API = '';
        const cache = {};
        const fa = (n) => { if (n === null || n === undefined || n === '') return '-'; return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d))); };
        const groupFa = (n) => { if (n === null || n === undefined || n === '') return '-'; const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return s.replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d))); };
        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const toFaDigits = (s) => String(s == null ? '' : s).replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d)));
        const REASON_FA = { 'roll_change': 'تعویض غلتک / قفسه', 'billet_jam': 'کوبیدگی شمش', 'furnace_temp': 'دمای کوره', 'shear_adjust': 'تنظیم قیچی', 'mech_elec': 'خرابی مکانیکی / برقی', 'crop-ends': 'کراپ دو سر', 'bearing': 'شکستگی بلبرینگ', 'roll': 'شکستگی/پوشش غلتک', 'shear_blade': 'تیغه قیچی', 'electrical': 'خرابی برقی', 'hydraulic': 'خرابی هیدرولیک', 'furnace': 'مشعل/نسوز کوره', 'leak-failed': 'نشت در تست فشار', 'deformed-body': 'دفرمگی بدنه', 'scratch-lining': 'خراش لاینینگ', 'weld-defect': 'عیب جوش درز', 'seam-wheel-change': 'تعویض چرخ درزبند', 'paint-booth-cleaning': 'تمیزکاری اتاق رنگ', 'forming-adjust': 'تنظیم دستگاه فرمینگ', 'coil-feed-jam': 'گیرش ورق در فیدر', 'other': 'سایر' };
        const reasonFa = (v) => REASON_FA[String(v || '')] || (v ? String(v) : '-');
        let WEB_USER = null;
        const AUTO_REFRESH_MS = 15000;
        let autoRefreshOn = true, refreshTimer = null, clockTimer = null, lastOkAt = null, currentTab = 'summary', autoTick = false;
        const loaders = {
            summary: loadSummary,
            analytics: loadAnalytics,
            production: loadProduction,
            waste: loadWaste,
            downtime: loadDowntime,
            quality: loadQuality,
            maintenance: loadMaintenance,
            warehouse: loadInventory
        };

        const STATIONS = { 'st-cut': 'برش ورق', 'st-form': 'فرمینگ بدنه', 'st-weld': 'جوش درز', 'st-seam': 'درزبند/سرزنی', 'st-rib': 'دنده‌زنی', 'st-test': 'تست نشت/فشار', 'st-lin': 'لاینینگ/رنگ', 'st-pack': 'بسته‌بندی/پالت', 'st-ends': 'پرس درب/ته' };
        const stationFa = (v) => STATIONS[String(v || '')] || (v ? String(v) : '-');
        const WTYPE_FA = { 'sheet': 'ورق', 'body': 'بدنه', 'ends': 'درب/ته', 'full': 'بشکهٔ کامل' };
        const wtypeFa = (v) => WTYPE_FA[String(v || '')] || (v ? String(v) : '-');
        const fmtDate = (iso) => { if (!iso) return '-'; try { const d = new Date(iso); if (isNaN(d.getTime())) return esc(iso); return d.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return esc(iso); } };
        async function getJson(path) { const r = await fetch(API + path, { cache: 'no-store' }); if (r.status === 401) { window.location.href = '/login'; throw new Error('unauthorized'); } if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
        const COLS = {
            production: [{ label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'محصول', key: 'product_id' }, { label: 'شیفت', key: 'shift_id' }, { label: 'تعداد سالم', key: 'good_quantity', num: 1 }, { label: 'پالت', key: 'pallet_count', num: 1 }, { label: 'ایستگاه', key: 'machine_id', station: 1 }, { label: 'منبع', key: 'source', src: 1 }, { label: 'زمان', key: 'timestamp', date: 1 }],
            waste: [{ label: 'ایستگاه کشف', key: 'machine_id', station: 1 }, { label: 'نوع ضایعات', key: 'waste_type', wt: 1 }, { label: 'علت', key: 'reason_id' }, { label: 'تعداد', key: 'quantity', num: 1 }, { label: 'شیفت', key: 'shift_id' }, { label: 'توضیحات', key: 'description' }, { label: 'زمان', key: 'timestamp', date: 1 }],
            downtime: [{ label: 'علت توقف', key: 'reason_id' }, { label: 'ایستگاه', key: 'machine_id', station: 1 }, { label: 'مدت (دقیقه)', key: 'duration_minutes', num: 1 }, { label: 'نوع', key: 'is_unplanned', chip: 1 }, { label: 'شروع', key: 'start_time', date: 1 }, { label: 'پایان', key: 'end_time', date: 1 }, { label: 'توضیحات', key: 'description' }],
            quality: [{ label: 'کد بچ', key: 'heat_number' }, { label: 'حجم (لیتر)', key: 'rebar_size', num: 1 }, { label: 'فشار هیدرواستاتیک (kPa)', key: 'yield_strength', num: 1 }, { label: 'ضخامت لاینینگ (µm)', key: 'tensile_strength', num: 1 }, { label: 'تست سقوط (m)', key: 'elongation_percent', num: 1 }, { label: 'تست نشت', key: 'bend_test_passed', chip: 1 }, { label: 'بازرسی درز', key: 'visual_inspection', chip: 1 }, { label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'توضیحات', key: 'description' }, { label: 'زمان', key: 'timestamp', date: 1 }],
        };
        const DATE_FIELD = { production: 'timestamp', waste: 'timestamp', downtime: 'start_time', quality: 'timestamp' };
        const HAS_SHIFT = { production: 1, waste: 1, downtime: 1, quality: 0 };
        const HAS_MACHINE = { production: 1, waste: 1, downtime: 1, quality: 0 };
        const LIST_TABS = ['production', 'waste', 'downtime', 'quality'];
        const view = {};
        LIST_TABS.forEach((t) => { view[t] = { search: '', shift: 'all', machine: 'all', from: '', to: '', sortKey: null, sortDir: 1, page: 0, pageSize: 50 }; });
        let activeFilter = { from: '', to: '', shift: 'all', product: 'all' };
        function div(a, b) { return ~~(a / b); }
        function mod(a, b) { return a - ~~(a / b) * b; }
        function jalCal(jy) {
            var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
            var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0], jm2, jump, leap, leapG, march, n, i;
            for (i = 1; i < bl; i += 1) { jm2 = breaks[i]; jump = jm2 - jp; if (jy < jm2) break; leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm2; }
            n = jy - jp; leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
            if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
            leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150; march = 20 + leapJ - leapG;
            if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33; leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
            return { leap: leap, gy: gy, march: march };
        }
        function g2d(gy, gm, gd) {
            var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
            d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752; return d;
        }
        function j2d(jy, jm, jd) { var r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; }
        function d2g(jdn) {
            var j = 4 * jdn + 139361631; j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
            var i = div(mod(j, 1461), 4) * 5 + 308; var gd = div(mod(i, 153), 5) + 1; var gm = mod(div(i, 153), 12) + 1; var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
            return { gy: gy, gm: gm, gd: gd };
        }
        const toEnDigits = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
        function jalaliToDate(dateStr) {
            const m = toEnDigits(dateStr).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if (!m) return null;
            const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
            if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
            const g = d2g(j2d(jy, jm, jd)); return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 0, 0, 0));
        }
        function parseJalaliDateTime(dateStr, timeStr) {
            const m = toEnDigits(dateStr).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if (!m) return null;
            const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
            if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
            const g = d2g(j2d(jy, jm, jd)); const tm = toEnDigits(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
            const hh = tm ? Number(tm[1]) : 0, mm = tm ? Number(tm[2]) : 0; if (hh > 23 || mm > 59) return null;
            return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, hh, mm, 0));
        }
        function jalaliDateInputHTML(p, cur) {
            return '<input type="text" inputmode="numeric" data-jp="' + p + '" placeholder="۱۴۰۵/۰۵/۱۶" value="' + esc(toFaDigits(cur || '')) + '" style="width:110px;text-align:center" />';
        }
        function readJalaliValue(root, p) {
            const el = root.querySelector('input[data-jp="' + p + '"]'); if (!el) return '';
            const v = toEnDigits(el.value).trim(); return /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.test(v) ? v : '';
        }
        let inventoryData = null;

        function invEsc(v) {
            return String(v == null ? '' : v)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function invNum(v) {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        }

        function invQty(v) {
            const n = Number(v);
            return Number.isFinite(n)
                ? n.toLocaleString('fa-IR')
                : '۰';
        }

        function invWarehouseLabel(code) {
            const map = {
                raw: 'مواد خام',
                product: 'محصول',
                spare: 'قطعات یدکی',
                quarantine: 'قرنطینه'
            };
            return map[String(code || '')] || String(code || '-');
        }

        function invTxLabel(type) {
            const map = {
                receipt: 'رسید',
                issue: 'حواله',
                transfer: 'انتقال',
                adjustment: 'اصلاح'
            };
            return map[String(type || '')] || String(type || '-');
        }

        function invStatusChip(status) {
            if (status === 'low') return '<span class="chip no">کمبود موجودی</span>';
            if (status === 'warn') return '<span class="chip wait">نزدیک نقطه سفارش</span>';
            return '<span class="chip ok">موجودی کافی</span>';
        }

        function invNormalizeData(data) {
            const d = data && typeof data === 'object' ? data : {};
            return {
                items: Array.isArray(d.items) ? d.items : [],
                stock: Array.isArray(d.stock) ? d.stock : [],
                stockview: Array.isArray(d.stockview) ? d.stockview : [],
                receipts: Array.isArray(d.receipts) ? d.receipts : [],
                issues: Array.isArray(d.issues) ? d.issues : [],
                transfers: Array.isArray(d.transfers) ? d.transfers : [],
                adjustments: Array.isArray(d.adjustments) ? d.adjustments : [],
                transactions: Array.isArray(d.transactions) ? d.transactions : [],
                summary: d.summary && typeof d.summary === 'object'
                    ? d.summary
                    : {
                        item_count: 0,
                        available_quantity: 0,
                        quarantine_quantity: 0,
                        low_stock_count: 0
                    }
            };
        }

        function attachJalaliMasks(root) {
            root.querySelectorAll('input[data-jp]').forEach((el) => {
                if (el.dataset.masked) return;
                el.dataset.masked = '1';

                el.addEventListener('input', () => {
                    let v = toEnDigits(el.value || '');
                    v = v.replace(/[^\d/]/g, '');

                    const parts = v.split('/').slice(0, 3);

                    if (parts[0]) parts[0] = parts[0].slice(0, 4);
                    if (parts[1]) parts[1] = parts[1].slice(0, 2);
                    if (parts[2]) parts[2] = parts[2].slice(0, 2);

                    el.value = toFaDigits(parts.join('/'));
                });
            });
        }

        async function loadInventory() {
            try {
                const data = await getJson('/api/inventory');
                inventoryData = invNormalizeData(data);
                invRender();
                lastOkAt = Date.now();
                setLiveStatus(true);
                return true;
            } catch (error) {
                console.error('[INV] loadInventory failed:', error);
                inventoryData = invNormalizeData(null);

                const kpis = document.getElementById('invKpis');
                if (kpis) kpis.innerHTML = '<div class="empty">خطا در دریافت اطلاعات انبار</div>';

                const stockTable = document.getElementById('tbl-inv-stock');
                if (stockTable) stockTable.innerHTML = '<tbody><tr><td class="empty">خطا در دریافت اطلاعات</td></tr></tbody>';

                const itemsTable = document.getElementById('tbl-inv-items');
                if (itemsTable) itemsTable.innerHTML = '<tbody><tr><td class="empty">خطا در دریافت اطلاعات</td></tr></tbody>';

                const txTable = document.getElementById('tbl-inv-tx');
                if (txTable) txTable.innerHTML = '<tbody><tr><td class="empty">خطا در دریافت اطلاعات</td></tr></tbody>';

                const cardexTable = document.getElementById('tbl-inv-cardex');
                if (cardexTable) cardexTable.innerHTML = '<tbody><tr><td class="empty">خطا در دریافت اطلاعات</td></tr></tbody>';

                setLiveStatus(false);
                return false;
            }
        }

        loaders.inventory = loadInventory;

        function invRender() {
            if (!inventoryData) return;

            invFillCardexSelect();
            invRenderStock();
            invRenderItems();
            invRenderTx();
            invRenderCardex();

            const s = inventoryData.summary || {};
            const box = document.getElementById('invKpis');
            if (!box) return;

            box.innerHTML = [
                { l: 'تعداد اقلام فعال', v: invQty(s.item_count), c: '' },
                { l: 'موجودی قابل مصرف', v: invQty(s.available_quantity), c: 'green' },
                { l: 'موجودی قرنطینه', v: invQty(s.quarantine_quantity), c: 'amber' },
                { l: 'اقلام زیر نقطه سفارش', v: invQty(s.low_stock_count), c: s.low_stock_count ? 'red' : 'green' }
            ].map(k => '<div class="kpi ' + k.c + '"><div class="v">' + k.v + '</div><div class="l">' + invEsc(k.l) + '</div></div>').join('');
        }

        function invRenderStock() {
            const table = document.getElementById('tbl-inv-stock');
            if (!table) return;

            const wh = (document.getElementById('invWhFilter') || {}).value || '';
            const rows = (inventoryData?.stockview || []).filter(x => !wh || x.warehouse === wh);

            let html = '<thead><tr><th>کد کالا</th><th>نام کالا</th><th>گروه</th><th>واحد</th><th>انبار</th><th>فیزیکی</th><th>رزرو</th><th>قابل مصرف</th><th>حداقل</th><th>نقطه سفارش</th><th>وضعیت</th></tr></thead><tbody>';

            if (!rows.length) {
                html += '<tr><td colspan="11" class="empty">موجودی ثبت نشده است.</td></tr>';
            } else {
                rows.forEach(r => {
                    html += '<tr>' +
                        '<td>' + invEsc(r.code) + '</td>' +
                        '<td>' + invEsc(r.name) + '</td>' +
                        '<td>' + invEsc(r.category || '-') + '</td>' +
                        '<td>' + invEsc(r.unit || '-') + '</td>' +
                        '<td>' + invEsc(invWarehouseLabel(r.warehouse)) + '</td>' +
                        '<td>' + invQty(r.physical) + '</td>' +
                        '<td>' + invQty(r.reserved) + '</td>' +
                        '<td>' + invQty(r.available) + '</td>' +
                        '<td>' + invQty(r.min_stock) + '</td>' +
                        '<td>' + invQty(r.reorder_point) + '</td>' +
                        '<td>' + invStatusChip(r.status) + '</td>' +
                        '</tr>';
                });
            }

            table.innerHTML = html + '</tbody>';
        }

        function invRenderItems() {
            const table = document.getElementById('tbl-inv-items');
            if (!table) return;

            const items = inventoryData?.items || [];
            let html = '<thead><tr><th>کد</th><th>نام</th><th>دسته</th><th>واحد</th><th>نقطه سفارش</th><th>حداقل</th><th>حداکثر</th><th>رهگیری بچ</th></tr></thead><tbody>';

            if (!items.length) {
                html += '<tr><td colspan="8" class="empty">کالایی تعریف نشده است.</td></tr>';
            } else {
                items.forEach(item => {
                    html += '<tr>' +
                        '<td>' + invEsc(item.code) + '</td>' +
                        '<td>' + invEsc(item.name) + '</td>' +
                        '<td>' + invEsc(item.category || '-') + '</td>' +
                        '<td>' + invEsc(item.unit || '-') + '</td>' +
                        '<td>' + invQty(item.reorder_point) + '</td>' +
                        '<td>' + invQty(item.min_stock) + '</td>' +
                        '<td>' + invQty(item.max_stock) + '</td>' +
                        '<td>' + (item.batch_tracking ? '<span class="chip ok">بله</span>' : 'خیر') + '</td>' +
                        '</tr>';
                });
            }

            table.innerHTML = html + '</tbody>';
        }

        function invRenderTx() {
            const table = document.getElementById('tbl-inv-tx');
            if (!table) return;

            const txs = inventoryData?.transactions || [];
            let html = '<thead><tr><th>نوع تراکنش</th><th>شماره سند</th><th>کالا</th><th>مقدار</th><th>انبار / مبدا</th><th>مقصد</th><th>لات / بچ</th><th>تاریخ</th></tr></thead><tbody>';

            if (!txs.length) {
                html += '<tr><td colspan="8" class="empty">تراکنشی ثبت نشده است.</td></tr>';
            } else {
                txs.forEach(row => {
                    const docNo = row.receipt_no || row.issue_no || row.transfer_no || row.adjustment_no || '-';
                    const location = row.warehouse || row.from_warehouse || '-';
                    const destination = row.to_warehouse || row.destination || '-';
                    const qty = row.tx_type === 'adjustment' ? row.delta_quantity : row.quantity;

                    html += '<tr>' +
                        '<td>' + invEsc(invTxLabel(row.tx_type)) + '</td>' +
                        '<td>' + invEsc(docNo) + '</td>' +
                        '<td>' + invEsc(invItemName(row.item_id)) + '</td>' +
                        '<td>' + invQty(qty) + '</td>' +
                        '<td>' + invEsc(invWarehouseLabel(location)) + '</td>' +
                        '<td>' + invEsc(invWarehouseLabel(destination)) + '</td>' +
                        '<td>' + invEsc(row.lot_no || '-') + '</td>' +
                        '<td>' + invEsc(fmtDate(row.timestamp)) + '</td>' +
                        '</tr>';
                });
            }

            table.innerHTML = html + '</tbody>';
        }

        function invItemName(itemId) {
            const item = (inventoryData?.items || []).find(x => String(x.id) === String(itemId));
            return item ? ((item.code || '-') + ' — ' + (item.name || '-')) : '-';
        }

        function invFillCardexSelect() {
            const sel = document.getElementById('invCardexItem');
            if (!sel) return;

            const items = inventoryData?.items || [];
            const prev = sel.value || '';

            let html = '<option value="">همه کالاها</option>';
            items.forEach(item => {
                html += '<option value="' + invEsc(item.id) + '">' + invEsc((item.code || '') + ' — ' + (item.name || '')) + '</option>';
            });

            sel.innerHTML = html;

            if (prev && items.some(x => String(x.id) === String(prev))) {
                sel.value = prev;
            }
        }

        function invRenderCardex() {
            const table = document.getElementById('tbl-inv-cardex');
            if (!table) return;

            const txs = inventoryData?.transactions || [];
            const itemId = (document.getElementById('invCardexItem') || {}).value || '';

            const filtered = itemId
                ? txs.filter(t => String(t.item_id) === String(itemId))
                : txs;

            let html = '<thead><tr><th>نوع</th><th>سند</th><th>کالا</th><th>مقدار</th><th>انبار / مبدا</th><th>مقصد</th><th>لات / بچ</th><th>تاریخ</th></tr></thead><tbody>';

            if (!filtered.length) {
                html += '<tr><td colspan="8" class="empty">کارتکس خالی است.</td></tr>';
            } else {
                filtered.forEach(row => {
                    const docNo = row.receipt_no || row.issue_no || row.transfer_no || row.adjustment_no || '-';
                    const location = row.warehouse || row.from_warehouse || '-';
                    const destination = row.to_warehouse || row.destination || '-';
                    const qty = row.tx_type === 'adjustment' ? row.delta_quantity : row.quantity;

                    html += '<tr>' +
                        '<td>' + invEsc(invTxLabel(row.tx_type)) + '</td>' +
                        '<td>' + invEsc(docNo) + '</td>' +
                        '<td>' + invEsc(invItemName(row.item_id)) + '</td>' +
                        '<td>' + invQty(qty) + '</td>' +
                        '<td>' + invEsc(invWarehouseLabel(location)) + '</td>' +
                        '<td>' + invEsc(invWarehouseLabel(destination)) + '</td>' +
                        '<td>' + invEsc(row.lot_no || '-') + '</td>' +
                        '<td>' + invEsc(fmtDate(row.timestamp)) + '</td>' +
                        '</tr>';
                });
            }

            table.innerHTML = html + '</tbody>';
        }

        document.getElementById('invCardexItem')?.addEventListener('change', invRenderCardex);

        async function loadInventory() {
            try {
                const data = await getJson('/api/inventory');

                inventoryData = data || {
                    items: [],
                    stock: [],
                    transactions: [],
                    cardex: [],
                    kpis: {}
                };

                invRender();

                lastOkAt = Date.now();
                setLiveStatus(true);

            } catch (error) {
                console.error('Inventory load error:', error);

                inventoryData = {
                    items: [],
                    stock: [],
                    transactions: [],
                    cardex: [],
                    kpis: {}
                };

                const targets = [
                    'invKpis',
                    'tbl-inv-stock',
                    'tbl-inv-items',
                    'tbl-inv-tx',
                    'tbl-inv-cardex'
                ];

                targets.forEach((id) => {
                    const el = document.getElementById(id);
                    if (!el) return;

                    if (id === 'invKpis') {
                        el.innerHTML =
                            '<div class="empty">خطا در دریافت اطلاعات انبار</div>';
                    } else {
                        el.innerHTML =
                            '<tr><td class="empty">خطا در دریافت اطلاعات</td></tr>';
                    }
                });

                throw error;
            }
        }


        async function invPost(
            path,
            body,
            msgId,
            formId
        ) {

            const button =
                document.querySelector(
                    '#' +
                    formId +
                    ' button[data-save]'
                );


            if (button)
                button.disabled = true;


            try {

                const response =
                    await fetch(
                        path,
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            body:
                                JSON.stringify({

                                    ...body,

                                    request_id:
                                        invNewRequestId(
                                            'web'
                                        )
                                })
                        }
                    );


                const json =
                    await response.json();


                if (!response.ok) {

                    invMsg(
                        msgId,
                        json.error ||
                        'خطا در ثبت',
                        false
                    );

                    return false;
                }


                invMsg(
                    msgId,
                    'ثبت با موفقیت انجام شد ✓',
                    true
                );


                document.getElementById(
                    formId
                ).classList.add(
                    'hidden'
                );


                await loadInventory();


                lastOkAt =
                    Date.now();

                setLiveStatus(true);


                return true;


            } catch (e) {

                invMsg(
                    msgId,
                    'خطا در ارتباط با سرور',
                    false
                );

                return false;


            } finally {

                if (button)
                    button.disabled = false;
            }
        }


        // =========================================================
        // OPEN FORMS
        // =========================================================

        document
            .getElementById(
                'btnAddInventoryItem'
            )
            ?.addEventListener(
                'click',
                () =>
                    document
                        .getElementById(
                            'invItemForm'
                        )
                        .classList
                        .toggle('hidden')
            );


        document
            .getElementById(
                'btnInventoryReceipt'
            )
            ?.addEventListener(
                'click',
                () =>
                    document
                        .getElementById(
                            'invReceiptForm'
                        )
                        .classList
                        .toggle('hidden')
            );


        document
            .getElementById(
                'btnInventoryIssue'
            )
            ?.addEventListener(
                'click',
                () =>
                    document
                        .getElementById(
                            'invIssueForm'
                        )
                        .classList
                        .toggle('hidden')
            );


        document
            .getElementById(
                'btnInventoryTransfer'
            )
            ?.addEventListener(
                'click',
                () =>
                    document
                        .getElementById(
                            'invTransferForm'
                        )
                        .classList
                        .toggle('hidden')
            );


        document
            .getElementById(
                'btnInventoryAdjust'
            )
            ?.addEventListener(
                'click',
                () =>
                    document
                        .getElementById(
                            'invAdjustForm'
                        )
                        .classList
                        .toggle('hidden')
            );


        // =========================================================
        // ITEM
        // =========================================================

        document
            .getElementById(
                'invItemSave'
            )
            ?.addEventListener(
                'click',
                () =>

                    invPost(

                        '/api/inventory/item',

                        {

                            code:
                                document
                                    .getElementById(
                                        'invItemCode'
                                    )
                                    .value,

                            name:
                                document
                                    .getElementById(
                                        'invItemName'
                                    )
                                    .value,

                            category:
                                document
                                    .getElementById(
                                        'invItemCategory'
                                    )
                                    .value,

                            unit:
                                document
                                    .getElementById(
                                        'invItemUnit'
                                    )
                                    .value,

                            reorder_point:
                                Number(
                                    document
                                        .getElementById(
                                            'invItemROP'
                                        )
                                        .value
                                ) || 0,

                            min_stock:
                                Number(
                                    document
                                        .getElementById(
                                            'invItemMin'
                                        )
                                        .value
                                ) || 0,

                            max_stock:
                                Number(
                                    document
                                        .getElementById(
                                            'invItemMax'
                                        )
                                        .value
                                ) || 0,

                            batch_tracking:
                                document
                                    .getElementById(
                                        'invItemBatch'
                                    )
                                    .checked,

                            description:
                                document
                                    .getElementById(
                                        'invItemDesc'
                                    )
                                    .value

                        },

                        'invItemMsg',

                        'invItemForm'
                    )
            );


        // =========================================================
        // RECEIPT
        // =========================================================

        document
            .getElementById(
                'invReceiptSave'
            )
            ?.addEventListener(
                'click',
                () =>

                    invPost(

                        '/api/inventory/receipt',

                        {

                            item_id:
                                document
                                    .getElementById(
                                        'irItem'
                                    )
                                    .value,

                            quantity:
                                Number(
                                    document
                                        .getElementById(
                                            'irQty'
                                        )
                                        .value
                                ),

                            lot_no:
                                document
                                    .getElementById(
                                        'irLot'
                                    )
                                    .value,

                            warehouse:
                                document
                                    .getElementById(
                                        'irWarehouse'
                                    )
                                    .value,

                            location:
                                document
                                    .getElementById(
                                        'irLocation'
                                    )
                                    .value,

                            stock_status:
                                document
                                    .getElementById(
                                        'irStatus'
                                    )
                                    .value,

                            receipt_type:
                                document
                                    .getElementById(
                                        'irType'
                                    )
                                    .value,

                            supplier:
                                document
                                    .getElementById(
                                        'irSupplier'
                                    )
                                    .value,

                            document_no:
                                document
                                    .getElementById(
                                        'irDoc'
                                    )
                                    .value,

                            source_ref:
                                document
                                    .getElementById(
                                        'irSource'
                                    )
                                    .value,

                            heat_number:
                                document
                                    .getElementById(
                                        'irHeat'
                                    )
                                    .value,

                            description:
                                document
                                    .getElementById(
                                        'irDesc'
                                    )
                                    .value

                        },

                        'invReceiptMsg',

                        'invReceiptForm'
                    )
            );


        // =========================================================
        // ISSUE
        // =========================================================

        document
            .getElementById(
                'invIssueSave'
            )
            ?.addEventListener(
                'click',
                () =>

                    invPost(

                        '/api/inventory/issue',

                        {

                            item_id:
                                document
                                    .getElementById(
                                        'iiItem'
                                    )
                                    .value,

                            quantity:
                                Number(
                                    document
                                        .getElementById(
                                            'iiQty'
                                        )
                                        .value
                                ),

                            lot_no:
                                document
                                    .getElementById(
                                        'iiLot'
                                    )
                                    .value,

                            warehouse:
                                document
                                    .getElementById(
                                        'iiWarehouse'
                                    )
                                    .value,

                            location:
                                document
                                    .getElementById(
                                        'iiLocation'
                                    )
                                    .value,

                            destination:
                                document
                                    .getElementById(
                                        'iiDest'
                                    )
                                    .value,

                            destination_ref:
                                document
                                    .getElementById(
                                        'iiDestRef'
                                    )
                                    .value,

                            work_order:
                                document
                                    .getElementById(
                                        'iiWO'
                                    )
                                    .value,

                            description:
                                document
                                    .getElementById(
                                        'iiDesc'
                                    )
                                    .value

                        },

                        'invIssueMsg',

                        'invIssueForm'
                    )
            );


        // =========================================================
        // TRANSFER
        // =========================================================

        document
            .getElementById(
                'invTransferSave'
            )
            ?.addEventListener(
                'click',
                () =>

                    invPost(

                        '/api/inventory/transfer',

                        {

                            item_id:
                                document
                                    .getElementById(
                                        'itItem'
                                    )
                                    .value,

                            quantity:
                                Number(
                                    document
                                        .getElementById(
                                            'itQty'
                                        )
                                        .value
                                ),

                            lot_no:
                                document
                                    .getElementById(
                                        'itLot'
                                    )
                                    .value,

                            from_warehouse:
                                document
                                    .getElementById(
                                        'itFromWarehouse'
                                    )
                                    .value,

                            from_location:
                                document
                                    .getElementById(
                                        'itFromLocation'
                                    )
                                    .value,

                            to_warehouse:
                                document
                                    .getElementById(
                                        'itToWarehouse'
                                    )
                                    .value,

                            to_location:
                                document
                                    .getElementById(
                                        'itToLocation'
                                    )
                                    .value,

                            description:
                                document
                                    .getElementById(
                                        'itDesc'
                                    )
                                    .value

                        },

                        'invTransferMsg',

                        'invTransferForm'
                    )
            );


        // =========================================================
        // ADJUSTMENT
        // =========================================================

        document
            .getElementById(
                'invAdjustSave'
            )
            ?.addEventListener(
                'click',
                () =>

                    invPost(

                        '/api/inventory/adjustment',

                        {

                            item_id:
                                document
                                    .getElementById(
                                        'iaItem'
                                    )
                                    .value,

                            delta_quantity:
                                Number(
                                    document
                                        .getElementById(
                                            'iaDelta'
                                        )
                                        .value
                                ),

                            lot_no:
                                document
                                    .getElementById(
                                        'iaLot'
                                    )
                                    .value,

                            warehouse:
                                document
                                    .getElementById(
                                        'iaWarehouse'
                                    )
                                    .value,

                            location:
                                document
                                    .getElementById(
                                        'iaLocation'
                                    )
                                    .value,

                            stock_status:
                                document
                                    .getElementById(
                                        'iaStatus'
                                    )
                                    .value,

                            reason:
                                document
                                    .getElementById(
                                        'iaReason'
                                    )
                                    .value,

                            description:
                                document
                                    .getElementById(
                                        'iaDesc'
                                    )
                                    .value

                        },

                        'invAdjustMsg',

                        'invAdjustForm'
                    )
            );


        // =========================================================
        // EXPORT STOCK
        // =========================================================

        document
            .getElementById(
                'expInventoryStock'
            )
            ?.addEventListener(
                'click',
                () => {

                    const rows =
                        (
                            inventoryData?.stock ||
                            []
                        )

                            .map(row => {

                                const item =
                                    invItem(
                                        row.item_id
                                    );


                                return {

                                    code:
                                        item?.code ||
                                        row.item_id,

                                    name:
                                        item?.name ||
                                        '',

                                    unit:
                                        item?.unit ||
                                        '',

                                    warehouse:
                                        INV_WAREHOUSES[
                                        row.warehouse
                                        ] ||
                                        row.warehouse,

                                    location:
                                        row.location,

                                    lot:
                                        row.lot_no ||
                                        '',

                                    status:
                                        INV_STATUS_FA[
                                        row.stock_status
                                        ] ||
                                        row.stock_status,

                                    qty:
                                        row.quantity
                                };

                            });


                    downloadCsv(

                        'موجودی_انبار_صنعتی_فای',

                        [

                            {
                                label:
                                    'کد کالا',
                                key:
                                    'code'
                            },

                            {
                                label:
                                    'نام کالا',
                                key:
                                    'name'
                            },

                            {
                                label:
                                    'واحد',
                                key:
                                    'unit'
                            },

                            {
                                label:
                                    'انبار',
                                key:
                                    'warehouse'
                            },

                            {
                                label:
                                    'محل',
                                key:
                                    'location'
                            },

                            {
                                label:
                                    'لات/بچ',
                                key:
                                    'lot'
                            },

                            {
                                label:
                                    'وضعیت',
                                key:
                                    'status'
                            },

                            {
                                label:
                                    'موجودی',
                                key:
                                    'qty'
                            }

                        ],

                        rows,

                        'گزارش موجودی انبار'
                    );

                }
            );


        // =========================================================
        // EXPORT TRANSACTIONS
        // =========================================================

        document
            .getElementById(
                'expInventoryTx'
            )
            ?.addEventListener(
                'click',
                () => {

                    const rows =
                        (
                            inventoryData?.transactions ||
                            []
                        )

                            .map(row => ({

                                type:
                                    INV_TX_FA[
                                    row.tx_type
                                    ] ||
                                    row.tx_type,

                                doc:
                                    row.receipt_no ||
                                    row.issue_no ||
                                    row.transfer_no ||
                                    row.adjustment_no ||
                                    '',

                                item:
                                    invItemName(
                                        row.item_id
                                    ),

                                qty:
                                    row.tx_type ===
                                        'adjustment'
                                        ? row.delta_quantity
                                        : row.quantity,

                                lot:
                                    row.lot_no ||
                                    '',

                                date:
                                    fmtDate(
                                        row.timestamp
                                    ),

                                description:
                                    row.description ||
                                    ''

                            }));


                    downloadCsv(

                        'گردش_انبار_صنعتی_فای',

                        [

                            {
                                label:
                                    'نوع',
                                key:
                                    'type'
                            },

                            {
                                label:
                                    'سند',
                                key:
                                    'doc'
                            },

                            {
                                label:
                                    'کالا',
                                key:
                                    'item'
                            },

                            {
                                label:
                                    'مقدار',
                                key:
                                    'qty'
                            },

                            {
                                label:
                                    'لات/بچ',
                                key:
                                    'lot'
                            },

                            {
                                label:
                                    'تاریخ',
                                key:
                                    'date'
                            },

                            {
                                label:
                                    'شرح',
                                key:
                                    'description'
                            }

                        ],

                        rows,

                        'گردش انبار'
                    );

                }
            );


        function setLiveStatus(ok) { const d = document.getElementById('liveDot'); if (d) d.className = 'dot ' + (ok ? 'ok' : 'err'); }
        function updateAgo() { const el = document.getElementById('liveAgo'); if (!el) return; if (!lastOkAt) { el.textContent = 'هنوز بروزرسانی نشده'; return; } const s = Math.floor((Date.now() - lastOkAt) / 1000); el.textContent = autoRefreshOn ? (s < 60 ? fa(s) + ' ثانیه پیش' : fa(Math.floor(s / 60)) + ' دقیقه پیش') : 'خودکار خاموش'; }
        async function refreshCurrentTab() {
            try {
                autoTick = true;
                if (currentTab === 'genealogy') { if (document.getElementById('heatInput').value.trim()) await loadGenealogy(); }
                else if (currentTab === 'balance') { if (document.getElementById('balanceHeat').value.trim()) await loadBalance(); }
                else if (loaders[currentTab]) { await loaders[currentTab](); }
                autoTick = false; lastOkAt = Date.now(); setLiveStatus(true);
            } catch (e) { autoTick = false; setLiveStatus(false); }
        }
        function startAutoRefresh() { stopAutoRefresh(); if (autoRefreshOn) refreshTimer = setInterval(refreshCurrentTab, AUTO_REFRESH_MS); }
        function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }
        document.getElementById('nav').addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-tab]'); if (!btn) return;
            document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('active')); btn.classList.add('active');
            currentTab = btn.dataset.tab; document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
            document.getElementById('tab-' + currentTab).classList.remove('hidden');
            applyRoleUI();
            if (loaders[currentTab]) { try { await loaders[currentTab](); lastOkAt = Date.now(); setLiveStatus(true); } catch (err) { setLiveStatus(false); } }
            startAutoRefresh();
        });
        document.getElementById('btnGenealogy').addEventListener('click', loadGenealogy);
        document.getElementById('btnBalance').addEventListener('click', loadBalance);
        document.getElementById('liveToggle').addEventListener('click', () => {
            autoRefreshOn = !autoRefreshOn; const b = document.getElementById('liveToggle');
            b.textContent = autoRefreshOn ? 'بروزرسانی خودکار: روشن' : 'بروزرسانی خودکار: خاموش';
            b.className = 'livebtn' + (autoRefreshOn ? '' : ' off'); if (autoRefreshOn) startAutoRefresh(); else { stopAutoRefresh(); updateAgo(); }
        });
        document.getElementById('expSummary').addEventListener('click', () => {
            const s = cache.summary || {};
            downloadCsv('خلاصه_شاخص‌ها', [{ label: 'شاخص', key: 'k' }, { label: 'مقدار', key: 'v' }], [
                { k: 'تولید بشکه سالم', v: s.production_good_quantity }, { k: 'بشکه صادرشده', v: s.bundle_count }, { k: 'وزن محصول (kg)', v: s.bundle_weight_kg }, { k: 'ضایعات', v: s.waste_quantity }, { k: 'توقف (دقیقه)', v: s.downtime_minutes }, { k: 'راندمان مواد ٪', v: s.yield_rate_percent },
            ], 'خلاصه شاخص‌های یکپارچه');
        });
        document
            .getElementById(
                'expMaintenance'
            )
            .addEventListener(
                'click',
                () => {

                    const logs =
                        maintenanceLogsInRange();

                    const plans =
                        cache.mntPlans || [];

                    if (
                        !logs.length &&
                        !plans.length
                    ) {

                        alert(
                            'داده‌ای برای خروجی وجود ندارد.'
                        );

                        return;
                    }

                    // -----------------------------
                    // گزارش تعمیرات
                    // -----------------------------

                    downloadCsv(

                        'تعمیرات_نگهداری',

                        [
                            {
                                label: 'تاریخ',
                                key: 'work_date'
                            },
                            {
                                label: 'ایستگاه',
                                key: 'machine'
                            },
                            {
                                label: 'نوع کار',
                                key: 'type'
                            },
                            {
                                label: 'اولویت',
                                key: 'priority'
                            },
                            {
                                label: 'تکنسین',
                                key: 'technician'
                            },
                            {
                                label: 'مدت (دقیقه)',
                                key: 'duration'
                            },
                            {
                                label: 'هزینه (ریال)',
                                key: 'cost'
                            },
                            {
                                label: 'قطعات',
                                key: 'parts'
                            },
                            {
                                label: 'علت ریشه‌ای',
                                key: 'root_cause'
                            },
                            {
                                label: 'اقدام انجام‌شده',
                                key: 'action'
                            },
                            {
                                label: 'توضیحات',
                                key: 'description'
                            }
                        ],

                        logs.map(
                            (r) => ({

                                work_date:
                                    toFaDigits(
                                        r.work_date ||
                                        '-'
                                    ),

                                machine:
                                    stationFa(
                                        r.machine_id
                                    ),

                                type:
                                    WORKTYPE_FA[
                                    r.work_type
                                    ] ||
                                    r.work_type ||
                                    '-',

                                priority:
                                    PRIORITY_FA[
                                    r.priority
                                    ] ||
                                    r.priority ||
                                    '-',

                                technician:
                                    r.technician ||
                                    '-',

                                duration:
                                    r.duration_minutes ||
                                    0,

                                cost:
                                    r.cost ||
                                    0,

                                parts:
                                    r.parts ||
                                    '-',

                                root_cause:
                                    r.root_cause ||
                                    '-',

                                action:
                                    r.action_taken ||
                                    '-',

                                description:
                                    r.description ||
                                    '-'
                            })
                        ),

                        'گزارش تعمیرات و نگهداری'
                    );


                    // -----------------------------
                    // گزارش برنامه‌های PM
                    // -----------------------------

                    if (plans.length) {

                        downloadCsv(

                            'برنامه_PM',

                            [
                                {
                                    label: 'ایستگاه',
                                    key: 'machine'
                                },
                                {
                                    label: 'عنوان',
                                    key: 'title'
                                },
                                {
                                    label: 'اولویت',
                                    key: 'priority'
                                },
                                {
                                    label: 'دوره (روز)',
                                    key: 'interval'
                                },
                                {
                                    label: 'آخرین انجام',
                                    key: 'last_done'
                                },
                                {
                                    label: 'سررسید بعدی',
                                    key: 'next_due'
                                },
                                {
                                    label: 'مسئول',
                                    key: 'responsible'
                                },
                                {
                                    label: 'وضعیت',
                                    key: 'status'
                                }
                            ],

                            plans.map(
                                (p) => {

                                    const st =
                                        pmStatus(p);

                                    return {

                                        machine:
                                            stationFa(
                                                p.machine_id
                                            ),

                                        title:
                                            p.title,

                                        priority:
                                            PRIORITY_FA[
                                            p.priority
                                            ] ||
                                            p.priority ||
                                            '-',

                                        interval:
                                            p.interval_days,

                                        last_done:
                                            toFaDigits(
                                                p.last_done ||
                                                '-'
                                            ),

                                        next_due:
                                            toFaDigits(
                                                st.next ||
                                                '-'
                                            ),

                                        responsible:
                                            p.responsible ||
                                            '-',

                                        status:
                                            st.days < 0
                                                ? 'عقب‌افتاده'
                                                : st.days <= 7
                                                    ? 'نزدیک سررسید'
                                                    : 'طبق برنامه'
                                    };
                                }
                            ),

                            'برنامه نگهداری پیشگیرانه PM'
                        );
                    }
                }
            );
        document.querySelectorAll('button[data-exp]').forEach((b) => {
            b.addEventListener('click', () => {
                const k = b.dataset.exp;
                const map = { production: ['تولید_بشکه', 'ثبت تولید سالم', COLS.production], waste: ['ضایعات', 'ضایعات و پرت خط', COLS.waste], downtime: ['توقفات', 'توقفات خط', COLS.downtime], quality: ['کنترل_کیفیت', 'کنترل کیفیت QC', COLS.quality] };
                const m = map[k]; if (m) exportList(k, m[0], m[1], m[2]);
            });
        });
        document.getElementById('expGenealogy').addEventListener('click', () => {
            const g = lastGenealogy; if (!g) { alert('ابتدا استعلام کنید.'); return; }
            const rows = [];
            g.billets.forEach((b) => rows.push({ بخش: 'کویل', کد: b.id, بچ: b.heat_number, سایز: '-', گرید: b.grade, وزن: b.initial_weight_kg, وضعیت: b.status, زمان: fmtDate(b.received_at) }));
            g.furnace_logs.forEach((f) => rows.push({ بخش: 'ایستگاه‌ها', کد: f.id, بچ: f.heat_number, سایز: '-', گرید: '-', وزن: f.residence_time_minutes, وضعیت: 'ماندگاری(دقیقه)', زمان: fmtDate(f.charge_time) }));
            g.rebar_bundles.forEach((r) => rows.push({ بخش: 'بشکه', کد: r.bundle_code, بچ: r.heat_number, سایز: r.rebar_size, گرید: r.rebar_grade, وزن: r.net_weight_kg, وضعیت: r.quality_status, زمان: fmtDate(r.produced_at) }));
            downloadCsv('ردیابی_بچ_' + g.heat_number, [{ label: 'بخش', key: 'بخش' }, { label: 'کد', key: 'کد' }, { label: 'بچ', key: 'بچ' }, { label: 'سایز', key: 'سایز' }, { label: 'گرید', key: 'گرید' }, { label: 'وزن/مقدار', key: 'وزن' }, { label: 'وضعیت', key: 'وضعیت' }, { label: 'زمان', key: 'زمان' }], rows, 'ردیابی بچ تولید ' + g.heat_number);
        });
        document.getElementById('expBalance').addEventListener('click', () => {
            const b = lastBalance; if (!b) { alert('ابتدا محاسبه کنید.'); return; }
            downloadCsv('بالانس_' + b.heat_number, [{ label: 'شرح', key: 'k' }, { label: 'وزن (kg)', key: 'w' }, { label: 'درصد', key: 'p' }], [
                { k: 'ورق ورودی', w: b.input_weight_kg, p: '100٪' }, { k: 'بشکه سالم', w: b.output_weight_kg, p: b.yield_rate_percent + '٪' }, { k: 'پرت ورق', w: b.scale_loss_kg, p: b.scale_loss_percent + '٪' },
            ], 'بالانس ورق بچ ' + b.heat_number);
        });
        async function loadUserBar() {
            try {
                const r = await fetch('/api/auth/me', { cache: 'no-store' }); if (!r.ok) return;
                const j = await r.json();
                if (j.ok && j.user) {
                    document.getElementById('userbar').innerHTML = '<span class="uname">👤 ' + esc(j.user.name || j.user.username) + '</span><button class="ulogout" id="btnLogout">خروج</button>';
                    document.getElementById('btnLogout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
                }
            } catch (e) { /* ignore */ }
        }
        refreshCurrentTab().then(() => { startAutoRefresh(); clockTimer = setInterval(updateAgo, 1000); loadUserBar(); });



    
async function loadSummary() {
  const s = await getJson('/api/summary');
  cache.summary = s;
  const kpiBox = document.getElementById('kpiBox');
  if (kpiBox) {
    kpiBox.innerHTML = [
      { l: 'تولید سالم', v: groupFa(s.production_good_quantity), c: 'green' },
      { l: 'ضایعات', v: groupFa(s.waste_quantity), c: 'red' },
      { l: 'توقف (دقیقه)', v: groupFa(s.downtime_minutes), c: 'amber' },
      { l: 'راندمان ٪', v: fa(s.yield_rate_percent), c: s.yield_rate_percent >= 96 ? 'green' : 'amber' }
    ].map(k => '<div class="kpi ' + k.c + '"><div class="v">' + k.v + '</div><div class="l">' + esc(k.l) + '</div></div>').join('');
  }
}

async function loadAnalytics() { console.log('Analytics - coming soon'); }
async function loadProduction() { console.log('Production - coming soon'); }
async function loadWaste() { console.log('Waste - coming soon'); }
async function loadDowntime() { console.log('Downtime - coming soon'); }
async function loadQuality() { console.log('Quality - coming soon'); }
async function loadMaintenance() { console.log('Maintenance - coming soon'); }
async function loadGenealogy() { console.log('Genealogy - coming soon'); }
async function loadBalance() { console.log('Balance - coming soon'); }

function applyRoleUI() {
  fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    var role = (j && j.ok && j.user) ? String(j.user.role || 'viewer') : 'viewer';
    var admin = (role === 'admin');
    function show(ids, ok) { ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = (admin || ok) ? '' : 'none'; }); }
    show(['btnAddInventoryItem','btnInventoryReceipt','btnInventoryIssue','btnInventoryTransfer','btnInventoryAdjust'], role === 'warehouse');
    show(['btnAddProduction','btnAddWaste'], role === 'operator');
    show(['btnAddDowntime'], role === 'operator' || role === 'engineering');
    show(['btnAddQuality'], role === 'quality' || role === 'qc');
    show(['btnAddMaintenance','btnAddPlan'], role === 'engineering' || role === 'supervisor');
  }).catch(function () {});
}
applyRoleUI();

// ===== FIX-INV-1 =====
function invNewRequestId(x){return (x||"web")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}
function invMsg(id,t,ok){var el=document.getElementById(id);if(!el)return;el.textContent=t||"";el.style.color=ok?"#059669":"#dc2626";}
function invItem(id){var it=((inventoryData&&inventoryData.items)||[]).find(function(x){return String(x.id)===String(id);});return it||null;}
var INV_WAREHOUSES={raw:"مواد خام",product:"محصول",spare:"قطعات یدکی",quarantine:"قرنطینه"};
var INV_STATUS_FA={available:"قابل مصرف",quarantine:"قرنطینه",rejected:"مردود"};
var INV_TX_FA={receipt:"رسید",issue:"حواله",transfer:"انتقال",adjustment:"اصلاح"};
var WORKTYPE_FA={breakdown:"تعمیر خرابی اضطراری",repair:"تعمیر برنامه‌ریزی‌شده",pm:"PM پیشگیرانه"};
var PRIORITY_FA={low:"کم",medium:"متوسط",high:"بالا",critical:"بحرانی"};
var lastGenealogy=null,lastBalance=null;
function downloadCsv(csfn,headers,rows,title){var DQ=String.fromCharCode(34);var q=function(v){return DQ+String(v==null?"":v).replace(/"/g,DQ+DQ)+DQ;};var L=[];if(title){L.push(q(title));L.push("");}L.push((headers||[]).map(function(x){return q(x.label);}).join(","));(rows||[]).forEach(function(r){L.push((headers||[]).map(function(x){return q(r[x.key]);}).join(","));});var csv=String.fromCharCode(65279)+L.join(String.fromCharCode(13,10));var bl=new Blob([csv],{type:"text/csv;charset=utf-8;"});var u=URL.createObjectURL(bl);var a=document.createElement("a");a.href=u;a.download=(csfn||"export")+".csv";document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(u);},1500);}
function pmStatus(pl){try{var last=jalaliToDate(pl.last_done||"");if(!last)return{next:"-",days:9999};var nx=new Date(last.getTime()+(Number(pl.interval_days)||0)*86400000);return{next:nx.toLocaleDateString("fa-IR"),days:Math.round((nx.getTime()-Date.now())/86400000)};}catch(e){return{next:"-",days:9999};}}
function maintenanceLogsInRange(){return cache.mntLogs||[];}

// ===== FIX-PROD-1 =====
// FIX-PROD-1
function fpVal(id){var el=document.getElementById(id);return el?el.value:'';}
function fpToggle(id){var el=document.getElementById(id);if(el)el.classList.toggle('hidden');}
function fpHide(id){var el=document.getElementById(id);if(el)el.classList.add('hidden');}
function fpSetMsg(id,t,ok){var el=document.getElementById(id);if(!el)return;el.textContent=t||'';el.style.color=ok?'#059669':'#dc2626';}
function fpUser(){return (typeof WEB_USER!=='undefined'&&WEB_USER)?(WEB_USER.username||''):'';}
async function fpPost(path,body){var r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var j=await r.json().catch(function(){return{};});if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}
function fpFillStations(){['fwStation','fdStation','fmStation','plStation'].forEach(function(id){var el=document.getElementById(id);if(el&&el.options.length===0){var html='';for(var k in STATIONS){html+='<option value="'+k+'">'+STATIONS[k]+'</option>';}el.innerHTML=html;}});}
function fpFillPlans(){var el=document.getElementById('fmPlan');if(!el)return;var plans=(typeof cache!=='undefined'&&cache.mntPlans)||[];var html='<option value="">بدون ارجاع به برنامه PM</option>';plans.forEach(function(pl){html+='<option value="'+pl.id+'">'+(pl.title||'')+'</option>';});el.innerHTML=html;}
function fpCell(c,r){var v=r[c.key];if(c.num)return '<td>'+groupFa(v)+'</td>';if(c.date)return '<td>'+fmtDate(v)+'</td>';if(c.station)return '<td>'+stationFa(v)+'</td>';if(c.wt)return '<td>'+wtypeFa(v)+'</td>';if(c.chip)return '<td>'+(Number(v)?'<span class="chip ok">مطابق</span>':'<span class="chip no">مغایر</span>')+'</td>';if(c.src)return '<td>'+(v==='sensor'?'سنسور':'دستی')+'</td>';return '<td>'+esc(v==null?'':v)+'</td>';}
function fpRenderList(tab,rows){cache['list_'+tab]=rows||[];var t=document.getElementById('tbl-'+tab);if(!t)return;var cols=COLS[tab]||[];var html='<thead><tr>'+cols.map(function(c){return '<th>'+esc(c.label)+'</th>';}).join('')+'</tr></thead><tbody>';if(!rows||!rows.length){html+='<tr><td colspan="'+cols.length+'" class="empty">رکوردی ثبت نشده است.</td></tr>';}else{rows.slice().reverse().forEach(function(r){html+='<tr>'+cols.map(function(c){return fpCell(c,r);}).join('')+'</tr>';});}t.innerHTML=html+'</tbody>';}
function exportList(k,fname,title,cols){downloadCsv(fname,cols,cache['list_'+k]||[],title);}
async function loadProduction(){fpRenderList('production',await getJson('/api/production'));}
async function loadWaste(){fpRenderList('waste',await getJson('/api/waste'));}
async function loadDowntime(){fpRenderList('downtime',await getJson('/api/downtime'));}
async function loadQuality(){fpRenderList('quality',await getJson('/api/quality'));}
async function loadMaintenance(){
var j=await getJson('/api/maintenance-extra');
cache.mntLogs=j.logs||[];cache.mntPlans=j.plans||[];fpFillPlans();
var t=document.getElementById('tbl-mntlogs');
if(t){var html='<thead><tr><th>تاریخ</th><th>ایستگاه</th><th>نوع</th><th>اولویت</th><th>مدت(دقیقه)</th><th>تکنسین</th></tr></thead><tbody>';if(!cache.mntLogs.length)html+='<tr><td colspan="6" class="empty">رکوردی ثبت نشده</td></tr>';cache.mntLogs.slice().reverse().forEach(function(r){html+='<tr><td>'+esc(r.work_date||'-')+'</td><td>'+stationFa(r.machine_id)+'</td><td>'+esc(r.work_type||'-')+'</td><td>'+esc(r.priority||'-')+'</td><td>'+groupFa(r.duration_minutes)+'</td><td>'+esc(r.technician||'-')+'</td></tr>';});t.innerHTML=html+'</tbody>';}
var tp=document.getElementById('tbl-pmplans');
if(tp){var h2='<thead><tr><th>ایستگاه</th><th>عنوان</th><th>دوره(روز)</th><th>آخرین انجام</th></tr></thead><tbody>';if(!cache.mntPlans.length)h2+='<tr><td colspan="4" class="empty">برنامه‌ای تعریف نشده</td></tr>';cache.mntPlans.forEach(function(pl){h2+='<tr><td>'+stationFa(pl.machine_id)+'</td><td>'+esc(pl.title||'')+'</td><td>'+groupFa(pl.interval_days)+'</td><td>'+esc(pl.last_done||'-')+'</td></tr>';});tp.innerHTML=h2+'</tbody>';}
var md=document.getElementById('tbl-maintenance');
if(md){var dl=(cache.mntLogs||[]).slice(0,10);var h3='<thead><tr><th>تاریخ</th><th>ایستگاه</th><th>نوع</th><th>مدت</th></tr></thead><tbody>';if(!dl.length)h3+='<tr><td colspan="4" class="empty">-</td></tr>';dl.forEach(function(r){h3+='<tr><td>'+esc(r.work_date||'-')+'</td><td>'+stationFa(r.machine_id)+'</td><td>'+esc(r.work_type||'-')+'</td><td>'+groupFa(r.duration_minutes)+'</td></tr>';});md.innerHTML=h3+'</tbody>';}
}
(function(){
fpFillStations();
var tmap={btnAddProduction:'formProduction',btnAddWaste:'formWaste',btnAddDowntime:'formDowntime',btnAddQuality:'formQuality',btnAddMaintenance:'formMaintenance',btnAddPlan:'formPlan'};
Object.keys(tmap).forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('click',function(){fpFillStations();if(id==='btnAddMaintenance'){fpFillPlans();}fpToggle(tmap[id]);});});
var cmap={fpCancel:'formProduction',fwCancel:'formWaste',fdCancel:'formDowntime',fqCancel:'formQuality',fmCancel:'formMaintenance',plCancel:'formPlan'};
Object.keys(cmap).forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('click',function(){fpHide(cmap[id]);});});
document.getElementById('fpSave').addEventListener('click',async function(){try{await fpPost('/api/entry/production',{operator_id:fpUser(),product_id:fpVal('fpProduct'),shift_id:fpVal('fpShift'),good_quantity:Number(fpVal('fpQty'))||0,pallet_count:Number(fpVal('fpPallets'))||0,machine_id:'st-pack',description:fpVal('fpDesc')});fpSetMsg('fpMsg','ثبت با موفقیت انجام شد ✓',true);fpHide('formProduction');await loadProduction();}catch(e){fpSetMsg('fpMsg','خطا: '+e.message,false);}});
document.getElementById('fwSave').addEventListener('click',async function(){try{await fpPost('/api/entry/waste',{operator_id:fpUser(),shift_id:fpVal('fwShift'),machine_id:fpVal('fwStation'),reason_id:fpVal('fwReason'),waste_type:fpVal('fwType'),quantity:Number(fpVal('fwQty'))||0,description:fpVal('fwDesc')});fpSetMsg('fwMsg','ثبت با موفقیت انجام شد ✓',true);fpHide('formWaste');await loadWaste();}catch(e){fpSetMsg('fwMsg','خطا: '+e.message,false);}});
document.getElementById('fdSave').addEventListener('click',async function(){try{var fr=document.getElementById('formDowntime');var st=parseJalaliDateTime(readJalaliValue(fr,'fds'),fpVal('fdStartTime'));var en=parseJalaliDateTime(readJalaliValue(fr,'fde'),fpVal('fdEndTime'));if(!st||!en){fpSetMsg('fdMsg','تاریخ شمسی معتبر وارد کنید.',false);return;}await fpPost('/api/entry/downtime',{shift_id:fpVal('fdShift'),machine_id:fpVal('fdStation'),reason_id:fpVal('fdReason'),is_unplanned:Number(fpVal('fdType')),start_time:st.toISOString(),end_time:en.toISOString(),description:fpVal('fdDesc')});fpSetMsg('fdMsg','ثبت با موفقیت انجام شد ✓',true);fpHide('formDowntime');await loadDowntime();}catch(e){fpSetMsg('fdMsg','خطا: '+e.message,false);}});
document.getElementById('fqSave').addEventListener('click',async function(){try{await fpPost('/api/entry/quality',{operator_id:fpUser(),heat_number:fpVal('fqHeat'),rebar_size:Number(fpVal('fqSize'))||0,yield_strength:Number(fpVal('fqPressure'))||0,tensile_strength:Number(fpVal('fqLining'))||0,elongation_percent:Number(fpVal('fqDrop'))||0,bend_test_passed:Number(fpVal('fqLeak')),visual_inspection:Number(fpVal('fqVisual')),description:fpVal('fqDesc')});fpSetMsg('fqMsg','ثبت با موفقیت انجام شد ✓',true);fpHide('formQuality');await loadQuality();}catch(e){fpSetMsg('fqMsg','خطا: '+e.message,false);}});
document.getElementById('fmSave').addEventListener('click',async function(){try{await fpPost('/api/entry/maintenance',{machine_id:fpVal('fmStation'),work_type:fpVal('fmType'),priority:fpVal('fmPriority'),work_date:readJalaliValue(document.getElementById('formMaintenance'),'fmd'),duration_minutes:Number(fpVal('fmDuration'))||0,technician:fpVal('fmTech'),cost:Number(fpVal('fmCost'))||0,parts:fpVal('fmParts'),root_cause:fpVal('fmRootCause'),action_taken:fpVal('fmAction'),description:fpVal('fmDesc'),plan_id:fpVal('fmPlan')});fpSetMsg('fmMsg','ثبت با موفقیت انجام شد ✓',true);fpHide('formMaintenance');await loadMaintenance();}catch(e){fpSetMsg('fmMsg','خطا: '+e.message,false);}});
document.getElementById('plSave').addEventListener('click',async function(){try{await fpPost('/api/pm/plan',{machine_id:fpVal('plStation'),title:fpVal('plTitle'),interval_days:Number(fpVal('plInterval'))||0,last_done:readJalaliValue(document.getElementById('formPlan'),'pllast'),responsible:fpVal('plResp'),priority:fpVal('plPriority'),notes:fpVal('plNotes')});fpSetMsg('plMsg','برنامه PM ثبت شد ✓',true);fpHide('formPlan');await loadMaintenance();}catch(e){fpSetMsg('plMsg','خطا: '+e.message,false);}});
})();
