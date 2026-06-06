// =====================
// File: core/auth.js
// Sesi & gerbang login (modal). Dipakai oleh router untuk memaksa login
// sebelum aplikasi dapat digunakan.
// =====================
import { Keys, IStore } from './storage.js';
import { API } from './api.js';

// Hash password (HARUS sama dengan yang dipakai saat login lama di settings.js)
export function hashPlain(p){
  let h = 0;
  for (let i = 0; i < p.length; i++){ h = (h * 31 + p.charCodeAt(i)) | 0; }
  return String(h >>> 0);
}

// ---- Session helpers ----
export function getSession(){
  return {
    role : (localStorage.getItem(Keys.ROLE)  || '').toLowerCase(),
    nik  :  localStorage.getItem(Keys.NIK)   || '',
    name :  localStorage.getItem(Keys.NAME)  || '',
    token:  localStorage.getItem(Keys.TOKEN) || '',
  };
}

export function isLoggedIn(){
  const s = getSession();
  return !!(s.role && s.role !== '-' && s.nik && s.token);
}

export function logout(){
  [Keys.ROLE, Keys.NIK, Keys.NAME, Keys.TOKEN, Keys.USER_DIVISI].forEach(k=>{
    try{ localStorage.removeItem(k); }catch(_){}
  });
}

// expose ringan ke window (beberapa modul memeriksa window.SESSION)
if (typeof window !== 'undefined'){
  window.SESSION = window.SESSION || {};
  window.SESSION.profile = getSession;
  window.SESSION.isLoggedIn = isLoggedIn;
  window.SESSION.logout = logout;
}

// ---- Login (dipakai modal) ----
export async function doLogin({ role, nik, pass }){
  role = (role || '').toLowerCase();
  nik  = (nik || '').trim();
  if (!role || role === '-') throw new Error('Pilih role');
  if (!nik || !pass)         throw new Error('NIK & Password wajib');

  const pass_hash = hashPlain(pass);
  const res = await API.login({ nik, pass_hash, role });
  if (!res || !res.ok) throw new Error(res?.error || 'Login gagal');

  localStorage.setItem(Keys.ROLE,  role);
  localStorage.setItem(Keys.NIK,   nik);
  localStorage.setItem(Keys.NAME,  res.data?.name || (role==='admin'?'Admin':role==='asisten'?'Asisten':role==='advisor'?'Advisor':'Mandor'));
  localStorage.setItem(Keys.TOKEN, pass_hash);

  // Untuk asisten: simpan divisi yang dipegang (bila master sudah ditarik)
  if (role === 'asisten'){
    try{
      const arr = (await IStore.getArr(Keys.MASTER_ASISTEN).catch(()=>[])) || [];
      const me  = arr.find(a => String(a.nik) === String(nik));
      const divList = (me && me.divisi_id) ? [String(me.divisi_id)] : [];
      localStorage.setItem(Keys.USER_DIVISI, JSON.stringify(divList));
    }catch(_){}
  }

  return getSession();
}

// =====================
// Modal Login
// =====================
let _modalEl = null;

export function isLoginModalOpen(){ return !!_modalEl; }

export function closeLoginModal(){
  if (_modalEl){ _modalEl.remove(); _modalEl = null; }
}

// onSuccess: callback setelah login sukses
export function openLoginModal(onSuccess){
  if (_modalEl) return; // sudah terbuka

  const wrap = document.createElement('div');
  wrap.className = 'login-overlay';
  wrap.innerHTML = `
    <div class="login-modal card" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div class="login-brand">
        <span class="login-logo">🌴</span>
        <div>
          <h2 id="login-title" style="margin:0">Pusingan Panen</h2>
          <div class="muted" style="font-size:13px">Masuk untuk melanjutkan</div>
        </div>
      </div>

      <label for="login-role">Role</label>
      <select id="login-role">
        <option value="-">- pilih role -</option>
        <option value="mandor">Mandor</option>
        <option value="asisten">Asisten</option>
        <option value="admin">Admin</option>
        <option value="advisor">Advisor</option>
      </select>

      <label for="login-nik">NIK</label>
      <input id="login-nik" autocomplete="username" placeholder="Masukkan NIK" />

      <label for="login-pass">Password</label>
      <input id="login-pass" type="password" autocomplete="current-password" placeholder="Masukkan password" />

      <div class="login-msg" id="login-msg"></div>

      <button class="primary" id="login-submit" style="margin-top:10px">Masuk</button>
    </div>
  `;
  document.body.appendChild(wrap);
  _modalEl = wrap;

  const $role = wrap.querySelector('#login-role');
  const $nik  = wrap.querySelector('#login-nik');
  const $pass = wrap.querySelector('#login-pass');
  const $btn  = wrap.querySelector('#login-submit');
  const $msg  = wrap.querySelector('#login-msg');

  // prefill role/nik terakhir (kemudahan, tanpa password)
  try{
    const lastRole = (localStorage.getItem(Keys.ROLE) || '').toLowerCase();
    const lastNik  = localStorage.getItem(Keys.NIK) || '';
    if (lastRole && lastRole !== '-') $role.value = lastRole;
    if (lastNik) $nik.value = lastNik;
  }catch(_){}

  function setMsg(text, isErr){
    $msg.textContent = text || '';
    $msg.style.display = text ? 'block' : 'none';
    $msg.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
  }

  async function submit(){
    setMsg('', false);
    $btn.disabled = true;
    const prevLabel = $btn.textContent;
    $btn.textContent = 'Memproses…';
    try{
      const sess = await doLogin({
        role: $role.value, nik: $nik.value, pass: $pass.value
      });
      closeLoginModal();
      try{ window.showToast && window.showToast('Login sukses'); }catch(_){}
      if (typeof onSuccess === 'function') onSuccess(sess);
    }catch(e){
      setMsg(e.message || 'Login gagal', true);
      $btn.disabled = false;
      $btn.textContent = prevLabel;
    }
  }

  $btn.addEventListener('click', submit);
  [$nik, $pass].forEach(inp=>{
    inp.addEventListener('keydown', (ev)=>{ if (ev.key === 'Enter') submit(); });
  });

  // fokus awal
  setTimeout(()=>{ ($role.value === '-' ? $role : $nik).focus(); }, 50);
}
