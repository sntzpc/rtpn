// =====================
// File: core/progress.js
// =====================
export const Progress = (() => {
  let el, bar, pctEl, titleEl, subEl, isDeterministic = false;
  let total = 0, current = 0;

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'progress-modal';
    el.className = 'progress-modal';
    el.innerHTML = `
      <div class="progress-card">
        <div class="progress-title">Memproses…</div>
        <div class="progress-sub"></div>
        <div class="progress-bar"><div></div></div>
        <div class="progress-percent">0%</div>
        <div class="progress-actions">
          <button type="button" id="progress-close" style="display:none">Tutup</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    bar     = el.querySelector('.progress-bar > div');
    pctEl   = el.querySelector('.progress-percent');
    titleEl = el.querySelector('.progress-title');
    subEl   = el.querySelector('.progress-sub');
    el.querySelector('#progress-close')?.addEventListener('click', close);
  }

  function open({ title='Memproses…', subtitle='', total: tot=null } = {}) {
    ensure();
    titleEl.textContent = title;
    subEl.textContent   = subtitle || '';
    el.style.display    = 'flex';
    current = 0;

    const barWrap = el.querySelector('.progress-bar');
    if (tot != null && Number(tot) > 0) {
      isDeterministic = true;
      total = Number(tot);
      pctEl.style.display = 'block';
      barWrap.classList.remove('indeterminate');
      set(0);
    } else {
      isDeterministic = false;
      total = 0;
      pctEl.style.display = 'none';
      barWrap.classList.add('indeterminate');
      bar.style.width = '30%';
    }
  }

  function set(pct) {
    if (!el || !isDeterministic) return;
    const v = Math.max(0, Math.min(100, pct));
    bar.style.width = v + '%';
    pctEl.textContent = v.toFixed(0) + '%';
  }

  function tick(i=null, tot=null) {
    if (!isDeterministic) return;
    if (tot != null) total = Number(tot);
    if (i != null) current = Number(i); else current++;
    if (total > 0) set((current/total) * 100);
  }

  function update(subtitle='') {
    if (!el) return;
    subEl.textContent = subtitle || '';
  }

  function close() {
    if (!el) return;
    el.style.display = 'none';
  }

  // Optional: switch mode setelah open (indeterminate -> determinate)
  function switchToDeterminate(tot) {
    ensure();
    isDeterministic = true;
    total = Number(tot)||0; current = 0;
    const barWrap = el.querySelector('.progress-bar');
    barWrap.classList.remove('indeterminate');
    pctEl.style.display = 'block';
    set(0);
  }

  return { open, set, tick, update, close, switchToDeterminate };
})();
