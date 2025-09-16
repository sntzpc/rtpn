// Namespaced localStorage helpers
const NS = 'pp2:'; // pusingan panen v2
export const Keys = {
ROLE: NS+'session.role',
NIK: NS+'session.nik',
NAME: NS+'session.name',
TOKEN: NS+'session.token',



MASTER_COMPANY: NS+'master.company',
MASTER_ESTATE: NS+'master.estate',
MASTER_DIVISI: NS+'master.divisi',
MASTER_KADVEL: NS+'master.kadvel',
MASTER_BLOK: NS+'master.blok',
MASTER_MANDOR: NS+'master.mandor',
MASTER_ASISTEN: NS+'master.asisten',


INPUT_RECORDS: NS+'input.records',
SYNC_QUEUE: NS+'sync.queue',
PARAF_LOG: NS+'report.paraf',
THEME: 'pp2:ui.theme'
};


function getArr(key){ try{ return JSON.parse(localStorage.getItem(key)||'[]'); }catch(_){ return []; } }
function setArr(key, arr){ localStorage.setItem(key, JSON.stringify(arr||[])); }
function getObj(key){ try{ return JSON.parse(localStorage.getItem(key)||'{}'); }catch(_){ return {}; } }
function setObj(key, obj){ localStorage.setItem(key, JSON.stringify(obj||{})); }


export const LStore = {
getArr, setArr, getObj, setObj,
get(key){ return localStorage.getItem(key); },
set(key, val){ localStorage.setItem(key, val); },
del(key){ localStorage.removeItem(key); },
clearAll(){ Object.keys(localStorage).filter(k=>k.startsWith(NS)).forEach(k=>localStorage.removeItem(k)); }
};


// Seed minimal arrays if missing
(function init(){
if (!localStorage.getItem(Keys.INPUT_RECORDS)) setArr(Keys.INPUT_RECORDS, []);
if (!localStorage.getItem(Keys.SYNC_QUEUE)) setArr(Keys.SYNC_QUEUE, []);
if (!localStorage.getItem(Keys.PARAF_LOG)) setArr(Keys.PARAF_LOG, []);
})();