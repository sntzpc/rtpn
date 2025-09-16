const sp = document.createElement('div');
sp.className = 'spinner';
sp.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
document.body.appendChild(sp);
export function spinner(show){ sp.style.display = show? 'flex':'none'; }
window.spinner = spinner;