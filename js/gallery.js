/* ============================================================
   gallery.js — Pawsona
   Pure localStorage — all cats are local to this device.
   play.html and shelter.html both read from the same store.
============================================================ */

const STORAGE_KEY = 'pawsona_cats_v1';

window.loadCatsFromStorage = function () {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
};

window.addCatToGallery = function (catData) {
  try {
    const cats = window.loadCatsFromStorage();
    cats.push({
      name:  catData.name,
      parts: catData.parts,
      date:  catData.date || new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cats));
  } catch (e) { console.warn('Pawsona: save failed', e); }
};

window.clearAllCats = function () {
  localStorage.removeItem(STORAGE_KEY);
};