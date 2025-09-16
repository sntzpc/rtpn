export function showToast(msg, type='info'){
const t = document.createElement('div');
t.className = 'toast';
t.textContent = msg;
document.body.appendChild(t);
setTimeout(()=>{ t.remove(); }, 3000);
}
window.showToast = showToast;