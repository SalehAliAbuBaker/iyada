/* Durable account-scoped storage. No patient data is put in the service-worker cache. */
(() => {
  'use strict';
  let opening;
  const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('clinic-private-v1', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('keys'); req.result.createObjectStore('documents'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('أغلق نوافذ التطبيق القديمة لتهيئة التخزين المحلي.'));
    });
    return opening;
  }
  async function read(store, key) { const db = await database(); return request(db.transaction(store).objectStore(store).get(key)); }
  async function keyFor(uid) {
    const existing = await read('keys', uid); if (existing) return existing;
    const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
    const db = await database();
    await new Promise(resolve => { const tx = db.transaction('keys','readwrite'); tx.objectStore('keys').add(key,uid); tx.oncomplete = resolve; tx.onabort = resolve; });
    const persisted = await read('keys', uid); if (!persisted) throw new Error('تعذر حفظ مفتاح التخزين المحلي.'); return persisted;
  }
  async function decode(uid, envelope) {
    if (!envelope) return null;
    const text = await crypto.subtle.decrypt({name:'AES-GCM',iv:envelope.iv},await keyFor(uid),envelope.cipher);
    return JSON.parse(new TextDecoder().decode(text));
  }
  async function encode(uid, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyFor(uid),new TextEncoder().encode(JSON.stringify(value)));
    return {iv,cipher};
  }
  function documentKey(uid, name) { if (!uid || !name) throw new Error('حساب التخزين غير محدد.'); return uid + ':' + name; }
  async function load(uid, name) { return decode(uid,await read('documents',documentKey(uid,name))); }
  async function mutate(uid, name, change) {
    const id = documentKey(uid,name), db = await database();
    // Compare-and-swap retries preserve changes made by another open tab.
    for (let attempt=0;attempt<30;attempt++) {
      const previous = await read('documents',id), revision = previous?.revision || 0;
      const value = await change(await decode(uid,previous));
      const envelope = {...await encode(uid,value),revision:revision+1};
      const committed = await new Promise((resolve,reject) => {
        const tx=db.transaction('documents','readwrite'), store=tx.objectStore('documents'); let match=false;
        const req=store.get(id); req.onsuccess=()=>{ if((req.result?.revision||0)===revision) {match=true;store.put(envelope,id);} };
        tx.oncomplete=()=>resolve(match);tx.onabort=()=>reject(tx.error||new Error('فشل الحفظ المحلي.'));
      });
      if(committed) { window.dispatchEvent(new CustomEvent('clinic-storage-saved',{detail:{uid,name}}));return value; }
    }
    throw new Error('التخزين مشغول؛ أعد المحاولة.');
  }
  window.clinicStore = {load,mutate,save:(uid,name,value)=>mutate(uid,name,()=>value),async ready(){await database();}};
})();
