// Copy buttons: <button data-copy="#input-id">
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const input = document.querySelector(btn.dataset.copy);
  if (!input) return;
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
  const label = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = label; }, 1400);
});
