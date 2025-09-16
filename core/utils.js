export const $ = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));


export function fmtDateISO(d=new Date()){
const tzOff = d.getTimezoneOffset();
const t = new Date(d.getTime() - tzOff*60000);
return t.toISOString().slice(0,10);
}


export function nowISO(){ return new Date().toISOString(); }


// Simple stable hash (FNV-1a)
export function hash(str){
let h = 0x811c9dc5;
for (let i=0;i<str.length;i++){
h ^= str.charCodeAt(i);
h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
}
return ('0000000'+h.toString(16)).slice(-8);
}


export function rupiah(n){ try{ return new Intl.NumberFormat('id-ID').format(n);}catch(_){return String(n);} }


export function loadSessionRoleBadge(){
const role = localStorage.getItem('session.role') || '-';
const el = document.getElementById('role-badge');
if (el) el.textContent = `Role: ${role}`;
}


export function ensureNumber(v, def=0){ const n = Number(v); return Number.isFinite(n)?n:def; }