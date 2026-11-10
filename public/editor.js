(() => {
  const data = JSON.parse(document.getElementById('quote-data').textContent);
  const itemsEl = document.getElementById('items');
  const stateEl = document.getElementById('save-state');
  let items = data.items.map((it) => ({ ...it }));
  let timer = null, saving = null, dirty = false;

  const money = (n) => new Intl.NumberFormat(data.locale, { style: 'currency', currency: data.currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n || 0);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const val = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === true) node.setAttribute(k, ''); else if (v !== false && v != null) node.setAttribute(k, v); }
    if (text != null) node.textContent = text;
    return node;
  };

  function renderItems() {
    itemsEl.replaceChildren();
    if (!items.length) itemsEl.append(el('p', { class: 'muted' }, 'No lines yet. Add one, or ask Claude to write the quote.'));
    items.forEach((it, i) => {
      const row = el('div', { class: 'e-line' });
      const field = (key, label, attrs = {}) => {
        const wrap = el('label', { class: `e-${key}` });
        wrap.append(el('span', {}, label));
        const input = el(key === 'detail' ? 'textarea' : 'input', { 'aria-label': `${label}, line ${i + 1}`, disabled: data.locked, ...attrs });
        if (key === 'detail') input.rows = 2;
        input.value = it[key] ?? '';
        input.addEventListener('input', () => {
          it[key] = attrs.type === 'number' ? val(input.value) : input.value;
          recalc(); queueSave();
        });
        wrap.append(input);
        return wrap;
      };
      row.append(field('description', 'Work', { placeholder: 'What is the work?' }));
      if (!data.locked) {
        const rm = el('button', { type: 'button', class: 'e-remove', 'aria-label': `Remove line ${i + 1}`, title: 'Remove line' }, '\u00d7');
        rm.addEventListener('click', () => { items.splice(i, 1); renderItems(); queueSave(); });
        row.append(rm);
      } else row.append(el('span'));
      const amt = el('div', { class: 'e-amount' });
      amt.append(el('output', { 'data-amount': i }));
      row.append(
        field('detail', 'Scope note', { placeholder: 'Scope note for the client (optional)' }),
        field('qty', 'Qty', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'Qty' }),
        field('unit', 'Unit', { placeholder: 'Unit' }),
        field('rate', 'Rate', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'Rate' }),
        amt,
      );
      itemsEl.append(row);
    });
    recalc();
  }

  function recalc() {
    let subtotal = 0;
    items.forEach((it, i) => {
      const amount = round2(val(it.qty) * val(it.rate));
      subtotal += amount;
      const out = itemsEl.querySelector(`[data-amount="${i}"]`);
      if (out) out.textContent = money(amount);
    });
    subtotal = round2(subtotal);
    const discount = Math.min(val(document.querySelector('[data-field="discount"]').value), subtotal);
    const taxPct = val(document.querySelector('[data-field="tax_pct"]').value);
    const tax = round2((subtotal - discount) * taxPct / 100);
    document.getElementById('s-subtotal').textContent = money(subtotal);
    document.getElementById('s-tax').textContent = money(tax);
    document.getElementById('s-total').textContent = money(round2(subtotal - discount + tax));
  }

  function payload() {
    const body = { items };
    document.querySelectorAll('[data-field]').forEach((f) => { body[f.dataset.field] = f.hasAttribute('data-num') ? val(f.value) : f.value; });
    return body;
  }

  function queueSave() {
    if (data.locked) return;
    dirty = true;
    stateEl.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  }

  async function save() {
    clearTimeout(timer);
    if (saving) { await saving; }
    if (!dirty) return true;
    dirty = false;
    saving = fetch(`/api/quotes/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save.');
        stateEl.textContent = dirty ? 'Saving…' : 'All changes saved';
        stateEl.classList.remove('bad');
        return true;
      })
      .catch((e) => { dirty = true; stateEl.textContent = `${e.message} Check your connection and edit again to retry.`; stateEl.classList.add('bad'); return false; })
      .finally(() => { saving = null; });
    return saving;
  }

  document.querySelectorAll('[data-field]').forEach((f) => f.addEventListener('input', () => { recalc(); queueSave(); }));
  window.addEventListener('beforeunload', (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });

  const on = (id, fn) => { const node = document.getElementById(id); if (node) node.addEventListener(node.tagName === 'SELECT' ? 'change' : 'click', fn); };
  on('add-line', () => { items.push({ description: '', detail: '', qty: 1, unit: 'sq ft', rate: 0 }); renderItems(); itemsEl.querySelector('.e-line:last-child input')?.focus(); });
  on('add-rate', (e) => {
    const r = data.rates[e.target.value];
    e.target.value = '';
    if (!r) return;
    items.push({ description: r.name, detail: '', qty: 1, unit: r.unit, rate: r.rate });
    renderItems(); queueSave();
    itemsEl.querySelector('.e-line:last-child .e-qty input')?.select();
  });
  on('send', async (e) => {
    e.target.disabled = true;
    if (!(await save())) { e.target.disabled = false; return; }
    const r = await fetch(`/api/quotes/${data.id}/send`, { method: 'POST' });
    if (r.ok) location.reload(); else { e.target.disabled = false; stateEl.textContent = 'Could not send. Try again.'; }
  });
  on('duplicate', async () => {
    await save();
    const r = await fetch(`/api/quotes/${data.id}/duplicate`, { method: 'POST' });
    if (r.ok) location.href = `/app/quotes/${(await r.json()).id}`;
  });
  on('delete', async () => {
    if (!confirm('Delete this quote? The client link stops working and this cannot be undone.')) return;
    dirty = false;
    const r = await fetch(`/api/quotes/${data.id}`, { method: 'DELETE' });
    if (r.ok) location.href = '/app';
  });

  renderItems();
})();
