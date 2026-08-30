// ===== FIX-INV-2 ===== (Phase 1: Material Master + Visibility)
var INV2 = { qItems: '', catItems: '', qStock: '', catStock: '', stockPage: 0, txPage: 0, PAGE: 50 };
function inv2Norm(s) { return String(s == null ? '' : s).toLowerCase(); }
function inv2FillCats(selId, items) {
  var sel = document.getElementById(selId); if (!sel) return;
  var cur = sel.value || '';
  var set = {};
  (items || []).forEach(function (it) { var c = String(it.category || '').trim(); if (c) set[c] = 1; });
  var keys = Object.keys(set).sort();
  var html = '<option value="">همه دسته‌ها</option>';
  keys.forEach(function (k) { html += '<option value="' + invEsc(k) + '">' + invEsc(k) + '</option>'; });
  sel.innerHTML = html;
  sel.value = (cur && set[cur]) ? cur : '';
}
function inv2Chip(r) {
  if ((Number(r.available) || 0) < (Number(r.min_stock) || 0)) return '<span class="chip crit">بحرانی</span>';
  if (r.status === 'warn') return '<span class="chip wait">نزدیک نقطه سفارش</span>';
  if (r.status === 'low') return '<span class="chip no">کمبود موجودی</span>';
  return '<span class="chip ok">موجودی کافی</span>';
}
function invRenderItems() {
  var table = document.getElementById('tbl-inv-items'); if (!table) return;
  var all = (inventoryData && inventoryData.items) || [];
  inv2FillCats('inv2ItemsCat', all);
  var q = inv2Norm((INV2.qItems || '').trim());
  var rows = all.filter(function (it) {
    if (INV2.catItems && String(it.category || '') !== INV2.catItems) return false;
    if (q && inv2Norm(it.code).indexOf(q) === -1 && inv2Norm(it.name).indexOf(q) === -1) return false;
    return true;
  });
  var html = '<thead><tr><th>کد</th><th>نام</th><th>دسته</th><th>واحد</th><th>نقطه سفارش</th><th>حداقل</th><th>حداکثر</th><th>رهگیری بچ</th></tr></thead><tbody>';
  if (!rows.length) html += '<tr><td colspan="8" class="empty">کالایی مطابق فیلتر یافت نشد.</td></tr>';
  rows.forEach(function (item) {
    html += '<tr><td>' + invEsc(item.code) + '</td><td>' + invEsc(item.name) + '</td><td>' + invEsc(item.category || '-') + '</td><td>' + invEsc(item.unit || '-') + '</td><td>' + invQty(item.reorder_point) + '</td><td>' + invQty(item.min_stock) + '</td><td>' + invQty(item.max_stock) + '</td><td>' + (item.batch_tracking ? '<span class="chip ok">بله</span>' : 'خیر') + '</td></tr>';
  });
  table.innerHTML = html + '</tbody>';
  var c = document.getElementById('inv2ItemsCount'); if (c) c.textContent = 'تعداد نتایج: ' + invQty(rows.length) + ' از ' + invQty(all.length);
}
