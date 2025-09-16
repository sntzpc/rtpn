import { API } from '../core/api.js';
import { Auth } from '../core/auth.js';

function renderUsers(rows){
  const tb = document.querySelector('#users-table tbody'); if (!tb) return;
  tb.innerHTML = (rows||[]).map(u=>`
    <tr>
      <td>${u.nik}</td>
      <td>${u.name||''}</td>
      <td>${u.role}</td>
      <td>${u.status||'active'}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger" data-reset="${u.nik}">Reset Password</button>
      </td>
    </tr>`).join('');
  tb.querySelectorAll('[data-reset]').forEach(b=> b.addEventListener('click', ()=> onReset(b.getAttribute('data-reset'))));
}

async function onReset(nik){
  if (!confirm(`Reset password untuk ${nik}?`)) return;
  const u = Auth.user();
  const resp = await API.call('users.resetPassword', { token:u.token, org:u.org, nik });
  if (!resp.ok) { alert(resp.error||'Reset gagal'); return; }
  alert('Password direset ke user123');
}

export const Users = (()=>{
  async function list(){
    const u = Auth.user();
    const resp = await API.call('users.list', { token:u.token, org:u.org });
    if (!resp.ok) throw new Error(resp.error||'list failed');
    renderUsers(resp.rows||[]);
    return resp.rows||[];
  }

  async function create(nik, name, role){
    const u = Auth.user();
    const resp = await API.call('users.create', { token:u.token, org:u.org, nik, name, role });
    if (!resp.ok) throw new Error(resp.error||'create failed');
    await list();
    return resp;
  }

  return { list, create };
})();
