export async function confirmDialog(text){
  return new Promise(res=>{
    const wrap = document.createElement('div');
    wrap.className='card';
    wrap.style.position='fixed';wrap.style.left='50%';wrap.style.top='40%';wrap.style.transform='translate(-50%,-50%)';wrap.style.zIndex='10000';wrap.style.maxWidth='420px';
    wrap.innerHTML = `
      <div style="margin-bottom:12px">${text}</div>
      <div class="row">
        <div class="col"><button class="primary" id="ok">Ya</button></div>
        <div class="col"><button id="no">Batal</button></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#ok').onclick=()=>{ wrap.remove(); res(true); };
    wrap.querySelector('#no').onclick=()=>{ wrap.remove(); res(false); };
  });
}
window.confirmDialog = confirmDialog;