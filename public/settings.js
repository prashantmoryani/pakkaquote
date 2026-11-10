(() => {
  let rates = JSON.parse(document.getElementById('rates-data').textContent).map((r) => ({ ...r }));
  const rowsEl = document.getElementById('rate-rows');
  const stateEl = document.getElementById('save-state');

  function render() {
    rowsEl.replaceChildren();
    rates.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'r-line';
      const field = (key, label, type) => {
        const wrap = document.createElement('label');
        wrap.className = `r-${key}`;
        const span = document.createElement('span'); span.textContent = label;
        const input = document.createElement('input');
        if (type) { input.type = type; input.min = '0'; input.step = 'any'; }
        input.value = r[key] ?? '';
        input.addEventListener('input', () => { r[key] = type ? parseFloat(input.value) || 0 : input.value; stateEl.textContent = 'Unsaved rate changes'; });
        wrap.append(span, input);
        return wrap;
      };
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'e-remove'; rm.textContent = '×'; rm.title = 'Remove item';
      rm.setAttribute('aria-label', `Remove ${r.name || 'item'}`);
      rm.addEventListener('click', () => { rates.splice(i, 1); render(); stateEl.textContent = 'Unsaved rate changes'; });
      row.append(field('name', 'Item'), field('unit', 'Unit'), field('rate', 'Rate', 'number'), field('notes', 'Notes for Claude'), rm);
      rowsEl.append(row);
    });
  }

  document.getElementById('add-rate-row').addEventListener('click', () => {
    rates.push({ name: '', unit: 'sq ft', rate: 0, notes: '' });
    render();
    rowsEl.querySelector('.r-line:last-child input')?.focus();
  });
  document.getElementById('save-rates').addEventListener('click', async () => {
    stateEl.textContent = 'Saving…';
    const r = await fetch('/api/rate-card', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: rates }) });
    if (r.ok) { rates = (await r.json()).rates; render(); stateEl.textContent = 'Rate card saved'; }
    else stateEl.textContent = 'Could not save the rate card. Try again.';
  });
  render();
})();
