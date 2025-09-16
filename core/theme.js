// =====================
// File: core/theme.js
// =====================
import { Keys } from './storage.js';

export const Theme = { DARK: 'dark', LIGHT: 'light' };

export function getTheme(){
  return localStorage.getItem(Keys.THEME) || Theme.DARK; // default dark
}

export function applyTheme(){
  const t = getTheme();
  const body = document.body;
  body.classList.remove('theme-dark','theme-light');
  body.classList.add(t === Theme.DARK ? 'theme-dark' : 'theme-light');
  body.setAttribute('data-theme', t);
  // sinkron posisi switch (jika ada)
  const input = document.getElementById('theme-switch-input');
  if (input) input.checked = (t === Theme.DARK);
}

export function setTheme(t){
  const v = (t === Theme.LIGHT) ? Theme.LIGHT : Theme.DARK;
  localStorage.setItem(Keys.THEME, v);
  applyTheme();
}

// Pasang toggle di header kanan atas
export function mountThemeToggle(){
  const header = document.querySelector('.app-header');
  if (!header) return;

  let host = document.getElementById('theme-toggle-host');
  if (!host){
    host = document.createElement('div');
    host.id = 'theme-toggle-host';
    host.className = 'theme-toggle-host';
    header.appendChild(host);
  }

host.innerHTML = `
  <div class="theme-toggle-inline">
    <span class="role-badge">Tema</span>
    <label class="switch" title="Dark / Light">
      <input type="checkbox" id="theme-switch-input" ${getTheme()===Theme.DARK?'checked':''}>
      <span class="slider"></span>
    </label>
  </div>
`;


  const input = host.querySelector('#theme-switch-input');
  input.addEventListener('change', ()=>{
    setTheme(input.checked ? Theme.DARK : Theme.LIGHT);
  });
}
