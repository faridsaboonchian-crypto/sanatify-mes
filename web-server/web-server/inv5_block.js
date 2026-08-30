// ===== FIX-INV-5 (حذف/غیرفعال‌سازی کالا از فهرست فعال‌ها) =====
function invDeleteItem(id) {
  var it = ((inventoryData && inventoryData.items) || []).find(function (x) { return String(x.id) === String(id); });
  if (!it) { alert('کالا یافت نشد.'); return; }
  var phys = ((inventoryData && inventoryData.stockview) || []).filter(function (r) { return String(r.item_id) === String(id); }).reduce(function (s, r) { return s + (Number(r.physical) || 0); }, 0);
  var msg = 'کالای «' + (it.code || '') + ' — ' + (it.name || '') + '» از فهرست فعال‌ها حذف شود؟\nاین کالا از «کارت اقلام» و «موجودی لحظه‌ای» خارج می‌شود؛ سابقهٔ تراکنش‌ها حفظ و بایگانی می‌ماند.';
  if (phys !== 0) { msg += '\n⚠️ توجه: این کالا موجودی غیرصفر (' + phys + ') دارد؛ با حذف، موجودی آن از نماها پنهان می‌شود.'; }
  if (!confirm(msg)) return;
  var body = { id: it.id, code: it.code, name: it.name, category: it.category, unit: it.unit, reorder_point: Number(it.reorder_point) || 0, min_stock: Number(it.min_stock) || 0, max_stock: Number(it.max_stock) || 0, batch_tracking: !!it.batch_tracking, description: it.description || '', active: false, request_id: invNewRequestId('web') };
  fetch('/api/inventory/item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok) { alert('خطا: ' + ((res.j && res.j.error) || 'حذف انجام نشد.')); return; }
      alert('کالا با موفقیت حذف (غیرفعال) شد ✓');
      loadInventory();
    })
    .catch(function (e) { alert('خطا در ارتباط با سرور: ' + e.message); });
}
function invRenderItems() {
  var t = document.getElementById('tbl-inv-items'); if (!t) return;
  var all = (inventoryData && inventoryData.items) || [];
  if (typeof inv2FillCats === 'function') inv2FillCats('inv2ItemsCat', all);
  var q = (window.INV2 && typeof inv2Norm === 'function') ? inv2Norm((INV2.qItems || '').trim()) : '';
  var rows = all.filter(function (it) {
    if (window.INV2 && INV2.catItems && String(it.category || '') !== INV2.catItems) return false;
    if (q && inv2Norm(it.code).indexOf(q) === -1 && inv2Norm(it.name).indexOf(q) === -1) return false;
    return true;
  });
  var html = '<thead><tr><th>کد</th><th>نام</th><th>دسته</th><th>واحد</th><th>نقطه سفارش</th><th>حداقل</th><th>حداکثر</th><th>رهگیری بچ</th><th>عملیات</th></tr></thead><tbody>';
  if (!rows.length) html += '<tr><td colspan="9" class="empty">کالایی مطابق فیلتر یافت نشد.</td></tr>';
  rows.forEach(function (it) {
    html += '<tr><td>' + invEsc(it.code) + '</td><td>' + invEsc(it.name) + '</td><td>' + invEsc(it.category || '-') + '</td><td>' + invEsc(it.unit || '-') + '</td><td>' + invQty(it.reorder_point) + '</td><td>' + invQty(it.min_stock) + '</td><td>' + invQty(it.max_stock) + '</td><td>' + (it.batch_tracking ? '<span class="chip ok">بله</span>' : 'خیر') + '</td><td><button type="button" class="act" data-invdel="' + invEsc(it.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">🗑 حذف</button></td></tr>';
  });
  t.innerHTML = html + '</tbody>';
  var c = document.getElementById('inv2ItemsCount'); if (c) c.textContent = 'تعداد نتایج: ' + invQty(rows.length) + ' از ' + invQty(all.length);
}
(function () {
  if (window.__FIX_INV5__) return; window.__FIX_INV5__ = true;
  var t = document.getElementById('tbl-inv-items');
  if (t) t.addEventListener('click', function (e) { var b = e.target.closest('button[data-invdel]'); if (!b) return; invDeleteItem(b.getAttribute('data-invdel')); });
})();
// ===== END FIX-INV-5 =====
