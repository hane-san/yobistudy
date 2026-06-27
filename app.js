(async () => {
  'use strict';
  let data = null;
  let cards = [];
  async function loadCardData() {
    const files = window.CARD_FILES || ['cards/company.json'];
    const loaded = [];
    for (const file of files) {
      const res = await fetch(file, {cache:'no-store'});
      if (!res.ok) throw new Error(`${file} を読み込めませんでした`);
      const json = await res.json();
      const subject = json.subject || json.title || file.replace(/^.*\//, '').replace(/\.json$/, '');
      for (const card of (json.cards || [])) loaded.push({...card, subject: card.subject || subject});
    }
    data = {title:'六法ねこカード', subject:'総合', cards: loaded};
    cards = data.cards;
  }
  await loadCardData();
  cards.forEach(c => { if (!c.subject) c.subject = data.subject || '会社法'; });

  function toHalfNumber(s) {
    return String(s || '').replace(/[０-９]/g, d => '０１２３４５６７８９'.indexOf(d));
  }

  function parseArticleRef(ref) {
    const s = String(ref || '');
    const law = s.replace(/第?[0-9０-９]+条.*$/, '').replace(/第$/, '') || 'その他';
    const n = x => x ? Number(toHalfNumber(x)) : 0;
    const m = s.match(/第?([0-9０-９]+)条(?:の([0-9０-９]+))?(?:第?([0-9０-９]+)項)?(?:第?([0-9０-９]+)号)?/);
    return {
      law,
      article: m ? n(m[1]) : 999999,
      branch: m && m[2] ? n(m[2]) : 0,
      paragraph: m && m[3] ? n(m[3]) : 0,
      item: m && m[4] ? n(m[4]) : 0,
      raw: s
    };
  }

  function compareArticleRefs(a, b) {
    const A = parseArticleRef(a), B = parseArticleRef(b);
    return A.law.localeCompare(B.law, 'ja')
      || A.article - B.article
      || A.branch - B.branch
      || A.paragraph - B.paragraph
      || A.item - B.item
      || A.raw.localeCompare(B.raw, 'ja', {numeric:true});
  }

  function isArticleRef(ref) {
    return /条/.test(String(ref || '')) && !/(最判|東京高判|判)/.test(String(ref || ''));
  }

  const subjects = [...new Set(cards.map(c => c.subject || data.subject || '会社法'))];

  const contentCategories = (data.categories || [...new Set(cards.map(c => c.category))])
    .filter(cat => cards.some(c => c.category === cat));
  const contentCategoryMap = Object.fromEntries(contentCategories.map(cat => [cat, cards.filter(c => c.category === cat)]));
  const subjectContentCategoryMap = Object.fromEntries(subjects.map(sub => [
    sub,
    contentCategories.filter(cat => cards.some(c => (c.subject || data.subject || '会社法') === sub && c.category === cat))
  ]));

  const articleCategories = [...new Set(cards.flatMap(c => (c.refs || []).filter(isArticleRef)))].sort(compareArticleRefs);
  const articleCategoryMap = Object.fromEntries(articleCategories.map(ref => [ref, cards.filter(c => (c.refs || []).includes(ref))]));
  const subjectArticleCategoryMap = Object.fromEntries(subjects.map(sub => [
    sub,
    articleCategories.filter(ref => cards.some(c => (c.subject || data.subject || '会社法') === sub && (c.refs || []).includes(ref)))
  ]));

  let filterMode = 'article';
  let categories = articleCategories;
  let categoryMap = articleCategoryMap;
  let subjectCategoryMap = subjectArticleCategoryMap;

  function applyFilterCollections() {
    if (filterMode === 'category') {
      categories = contentCategories;
      categoryMap = contentCategoryMap;
      subjectCategoryMap = subjectContentCategoryMap;
    } else if (filterMode === 'random') {
      categories = ['全カード'];
      categoryMap = {'全カード': cards};
      subjectCategoryMap = Object.fromEntries(subjects.map(sub => [sub, ['全カード']]));
    } else {
      categories = articleCategories;
      categoryMap = articleCategoryMap;
      subjectCategoryMap = subjectArticleCategoryMap;
    }
  }

  function keyForCard(card) {
    if (!card) return null;
    if (filterMode === 'random') return '全カード';
    if (filterMode === 'category') return card.category;
    const refs = (card.refs || []).filter(isArticleRef).sort(compareArticleRefs);
    return refs[0] || null;
  }

  function subjectOf(key) {
    if (filterMode === 'random') return currentSubject || data.subject || '会社法';
    const found = filterMode === 'category'
      ? cards.find(c => c.category === key)
      : cards.find(c => (c.refs || []).includes(key));
    return (found && found.subject) || data.subject || '会社法';
  }

  function categoryLabel(key) {
    if (filterMode === 'random') return `全カード ${cards.length}`;
    const count = categoryMap[key] ? categoryMap[key].length : 0;
    return `${key} ${count}`;
  }

  const categoryView = document.getElementById('categoryView');
  const randomView = document.getElementById('randomView');
  const categoryBtn = document.getElementById('categoryBtn');
  const articleBtn = document.getElementById('articleBtn');
  const randomBtn = document.getElementById('randomBtn');
  const subjectSelect = document.getElementById('subjectSelect');
  const categorySelect = document.getElementById('categorySelect');
  const filterLabel = document.getElementById('filterLabel');
  const randomCard = document.getElementById('randomCard');
  let currentRandom = null, lastRandomId = null, touchStartX = 0, touchStartY = 0, touchStartTime = 0, voices = [];
  applyFilterCollections();
  let currentSubject = subjects[0] || null, currentCategory = (subjectCategoryMap[currentSubject] || categories)[0] || null, currentCategoryIndex = 0;
  let pagerCardEl = null, pagerCountEl = null, pagerTitleEl = null, shrinkBtnCategory = null, shrinkBtnRandom = null;
  let pagerTouchStartX = 0, pagerTouchStartY = 0, pagerTouchStartTime = 0;

  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function renderText(s) { return escapeHTML(s).replace(/(（[^）]*）|\([^)]*\))/g, '<span class="paren">$1<\/span>'); }
  function speechText(s) { return String(s).replace(/（[^）]*）|\([^)]*\)/g, '').replace(/[「」『』]/g, '').replace(/\s+/g, ' ').trim(); }
  function renderRefs(refs) { if (!refs || !refs.length) return ''; return `<div class="refs"><div class="refLabel">条文<\/div>${refs.map(ref => `<span class="ref">${escapeHTML(ref)}<\/span>`).join('')}<\/div>`; }
  function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function pickVoice() { if (!voices.length) loadVoices(); return voices.find(v => /ja-JP|Japanese|日本語/i.test((v.lang || '') + ' ' + (v.name || ''))) || voices[0] || null; }
  function speak(card, el) {
    if (!('speechSynthesis' in window)) { alert('このブラウザでは音声読み上げが使えません。'); return; }
    speechSynthesis.cancel(); document.querySelectorAll('.playing').forEach(x => x.classList.remove('playing')); if (el) el.classList.add('playing');
    const utter = new SpeechSynthesisUtterance(speechText(card.text)); const v = pickVoice(); if (v) utter.voice = v; utter.lang = 'ja-JP'; utter.rate = 1.62; utter.pitch = 0.74; utter.volume = 1; utter.onend = utter.onerror = () => { if (el) el.classList.remove('playing'); }; speechSynthesis.speak(utter);
  }
  function createCard(card) {
    const article = document.createElement('article'); article.className = 'card'; article.setAttribute('role','button'); article.tabIndex = 0;
    article.innerHTML = `<div class="cardBody"><span class="num">${card.id}<\/span>${renderText(card.text)}<\/div><div class="tagDock">${renderRefs(card.refs)}<div class="metaRow"><span class="mark">${escapeHTML(card.category)}<\/span><\/div><\/div>`;
    article.addEventListener('click', () => speak(card, article)); article.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); speak(card, article); } }); return article;
  }


  function bindHoldToShrink(btn, onStart, onEnd) {
    if (!btn) return;
    let active = false;
    const start = e => { if (e) e.preventDefault(); if (active) return; active = true; onStart(); };
    const end = () => { if (!active) return; active = false; onEnd(); };
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, {passive:false});
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
    btn.addEventListener('touchend', end);
    btn.addEventListener('touchcancel', end);
    btn.addEventListener('blur', end);
  }

  function renderCategorySelectors() {
    if (!subjectSelect || !categorySelect) return;
    applyFilterCollections();
    if (filterLabel) filterLabel.textContent = filterMode === 'category' ? 'カテゴリ' : (filterMode === 'random' ? 'ランダム範囲' : '条文番号');

    subjectSelect.innerHTML = subjects.map(sub => `<option value="${escapeHTML(sub)}">${escapeHTML(sub)}<\/option>`).join('');
    subjectSelect.value = currentSubject;

    const cats = subjectCategoryMap[currentSubject] || [];
    categorySelect.innerHTML = cats.map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(categoryLabel(cat))}<\/option>`).join('');
    if (!cats.includes(currentCategory)) {
      currentCategory = cats[0] || categories[0] || null;
      currentCategoryIndex = 0;
    }
    categorySelect.value = currentCategory || '';

    subjectSelect.onchange = () => {
      currentSubject = subjectSelect.value;
      const cats2 = subjectCategoryMap[currentSubject] || [];
      currentCategory = cats2[0] || categories[0] || null;
      currentCategoryIndex = 0;
      renderCategorySelectors();
      paintCategoryCard();
    };
    categorySelect.onchange = () => {
      currentCategory = categorySelect.value;
      currentSubject = subjectOf(currentCategory);
      currentCategoryIndex = 0;
      renderCategorySelectors();
      paintCategoryCard();
    };
  }

  function setFilterMode(mode) {
    filterMode = mode === 'category' ? 'category' : (mode === 'random' ? 'random' : 'article');
    applyFilterCollections();

    if (filterMode === 'random') {
      currentCategory = '全カード';
      currentSubject = currentSubject || subjects[0] || data.subject || '会社法';
      currentCategoryIndex = Math.floor(Math.random() * Math.max(cards.length, 1));
    } else {
      const cats = subjectCategoryMap[currentSubject] || [];
      if (!cats.includes(currentCategory)) {
        currentCategory = cats[0] || categories[0] || null;
        currentCategoryIndex = 0;
      }
    }

    renderCategorySelectors();
    if (pagerCardEl) paintCategoryCard();
    categoryBtn.classList.toggle('active', filterMode === 'category' && categoryView && !categoryView.hidden);
    articleBtn.classList.toggle('active', filterMode === 'article' && categoryView && !categoryView.hidden);
    randomBtn.classList.toggle('active', filterMode === 'random' && categoryView && !categoryView.hidden);
  }

  function syncSelectorsToCurrentCard(card) {
    if (!card) return;
    const key = keyForCard(card);
    if (!key) return;
    currentCategory = key;
    currentSubject = subjectOf(currentCategory);
    const list = categoryMap[currentCategory] || [];
    const idx = list.findIndex(c => c.id === card.id);
    currentCategoryIndex = idx >= 0 ? idx : 0;
    renderCategorySelectors();
  }

  function buildCategoryPager() {
    categoryView.innerHTML = `
      <div class="pagerWrap">
        <div class="sectionHead pagerHead"><h2 id="pagerCategoryTitle"></h2><span id="pagerCount" class="count"></span></div>
        <div class="pagerStage" id="pagerStage"></div>
        <div class="controls">
          <button id="shrinkBtnCategory" class="mini shrinkBtn" type="button">長押しで全文表示</button>
        </div>
      </div>`;
    pagerCountEl = document.getElementById('pagerCount');
    pagerTitleEl = document.getElementById('pagerCategoryTitle');
    pagerCardEl = document.getElementById('pagerStage');
    shrinkBtnCategory = document.getElementById('shrinkBtnCategory');
    bindHoldToShrink(shrinkBtnCategory, () => categoryView.classList.add('is-shrunk'), () => categoryView.classList.remove('is-shrunk'));
    pagerCardEl.addEventListener('touchstart', e => {
      pagerTouchStartX = e.changedTouches[0].clientX;
      pagerTouchStartY = e.changedTouches[0].clientY;
      pagerTouchStartTime = Date.now();
    }, {passive:true});
    pagerCardEl.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - pagerTouchStartX;
      const dy = e.changedTouches[0].clientY - pagerTouchStartY;
      const dt = Date.now() - pagerTouchStartTime;
      const action = getFlickDirection(dx, dy, dt);
      if (!action) return;
      const currentCard = (categoryMap[currentCategory] || [])[currentCategoryIndex];

      if (action === 'nextCard') { moveCategoryCard(1); return; }
      if (action === 'prevCard') { moveCategoryCard(-1); return; }
      if (action === 'randomCategory') {
        const next = pickRandomFrom(categoryMap[currentCategory], currentCard && currentCard.id);
        showSpecificCard(next, 1);
        return;
      }
      if (action === 'randomAll') {
        const next = pickRandomFrom(cards, currentCard && currentCard.id);
        showSpecificCard(next, 1);
      }
    }, {passive:true});
  }

  function paintCategoryCard(direction = 0) {
    const list = categoryMap[currentCategory] || [];
    if (!list.length) { pagerCardEl.innerHTML = ''; return; }
    const card = list[currentCategoryIndex];
    pagerTitleEl.textContent = filterMode === 'random' ? '全カードランダム' : (currentCategory || (filterMode === 'category' ? 'カテゴリ' : '条文番号'));
    pagerCountEl.textContent = `${currentCategoryIndex + 1} / ${list.length}枚`;
    pagerCardEl.innerHTML = '';
    const el = createCard(card);
    el.classList.add('pagerCard');
    if (direction > 0) el.classList.add('slide-next');
    if (direction < 0) el.classList.add('slide-prev');
    pagerCardEl.appendChild(el);
  }

  function moveCategoryCard(delta) {
    const list = categoryMap[currentCategory] || [];
    if (!list.length) return;
    currentCategoryIndex = (currentCategoryIndex + delta + list.length) % list.length;
    paintCategoryCard(delta);
  }

  function initCategoryView() {
    renderCategorySelectors();
    buildCategoryPager();
    paintCategoryCard();
  }


  function getScrollBox(cardOrBody) {
    if (!cardOrBody) return null;
    if (cardOrBody.classList && (cardOrBody.classList.contains('cardBody') || cardOrBody.classList.contains('randomBody'))) return cardOrBody;
    return cardOrBody.querySelector ? cardOrBody.querySelector('.cardBody, .randomBody') : null;
  }

  function scrollPageIfNeeded(box, direction) {
    if (!box) return false;
    const max = box.scrollHeight - box.clientHeight;
    if (max <= 4) return false;

    const atTop = box.scrollTop <= 6;
    const atBottom = box.scrollTop >= max - 6;
    const amount = Math.max(150, box.clientHeight * 0.78);

    if (direction > 0 && !atBottom) {
      box.scrollBy({ top: amount, behavior: 'smooth' });
      return true;
    }
    if (direction < 0 && !atTop) {
      box.scrollBy({ top: -amount, behavior: 'smooth' });
      return true;
    }
    return false;
  }

  function getFlickDirection(dx, dy, dt) {
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const dist = Math.max(absX, absY);
    const duration = Math.max(dt || 0, 1);
    const velocity = dist / duration;
    if (dist < 26) return 0;

    const isQuick = duration <= 280 && velocity >= 0.22;
    if (!isQuick && dist < 42) return 0;

    if (absY >= absX * 0.72) return dy < 0 ? 'nextCard' : 'prevCard';
    if (absX >= absY * 0.58) return dx < 0 ? 'randomAll' : 'randomCategory';
    return 0;
  }

  function pickRandomFrom(list, avoidId) {
    const pool = (list || []).filter(Boolean);
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    let next;
    do { next = pool[Math.floor(Math.random() * pool.length)]; } while (next && next.id === avoidId);
    return next || pool[0];
  }

  function showSpecificCard(card, direction = 1) {
    if (!card) return;
    syncSelectorsToCurrentCard(card);
    paintCategoryCard(direction);
  }

  function setMode(mode) {
    const isRandom = mode === 'random';
    categoryView.hidden = false;
    randomView.hidden = true;
    categoryBtn.classList.toggle('active', !isRandom && filterMode === 'category');
    articleBtn.classList.toggle('active', !isRandom && filterMode === 'article');
    randomBtn.classList.toggle('active', isRandom || filterMode === 'random');
  }

  function chooseRandom() { if (cards.length === 1) return cards[0]; let next; do { next = cards[Math.floor(Math.random() * cards.length)]; } while (next.id === lastRandomId); lastRandomId = next.id; return next; }
  function paintRandom(card) {
    currentRandom = card;
    randomCard.innerHTML = `<div class="randomBody"><span class="num">${card.id}<\/span>${renderText(card.text)}<\/div><div class="tagDock"><div class="randomRefs">${card.refs && card.refs.length ? `${card.refs.map(ref => `<span class="ref">${escapeHTML(ref)}<\/span>`).join('')}` : ''}<\/div><div class="metaRow"><span class="mark">${escapeHTML(card.category)}<\/span><\/div><\/div>`;
  }
  function nextRandom(animated = true) { const card = chooseRandom(); if (!animated) { paintRandom(card); return; } randomCard.classList.add('fly'); setTimeout(() => { randomCard.classList.remove('fly'); randomCard.classList.add('enter'); paintRandom(card); requestAnimationFrame(() => randomCard.classList.remove('enter')); }, 190); }
  randomCard.addEventListener('click', () => { if (currentRandom) speak(currentRandom, randomCard); });
  randomCard.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && currentRandom) { e.preventDefault(); speak(currentRandom, randomCard); } });
  randomCard.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
    touchStartTime = Date.now();
  }, {passive:true});
  randomCard.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dt = Date.now() - touchStartTime;
    const action = getFlickDirection(dx, dy, dt);
    if (!action) return;

    if (action === 'nextCard') {
      const list = categoryMap[currentCategory] || cards;
      const idx = list.findIndex(c => c.id === (currentRandom && currentRandom.id));
      const next = list[(idx + 1 + list.length) % list.length];
      if (next) paintRandom(next);
      return;
    }
    if (action === 'prevCard') {
      const list = categoryMap[currentCategory] || cards;
      const idx = list.findIndex(c => c.id === (currentRandom && currentRandom.id));
      const next = list[(idx - 1 + list.length) % list.length];
      if (next) paintRandom(next);
      return;
    }
    if (action === 'randomCategory') {
      const next = pickRandomFrom(categoryMap[currentCategory], currentRandom && currentRandom.id);
      if (next) { paintRandom(next); randomCard.classList.add('enter'); requestAnimationFrame(() => randomCard.classList.remove('enter')); }
      return;
    }
    if (action === 'randomAll') nextRandom(true);
  }, {passive:true});
  shrinkBtnRandom = document.getElementById('shrinkBtnRandom');
  bindHoldToShrink(shrinkBtnRandom, () => randomView.classList.add('is-shrunk'), () => randomView.classList.remove('is-shrunk'));
  categoryBtn.addEventListener('click', () => { setFilterMode('category'); setMode('category'); });
  articleBtn.addEventListener('click', () => { setFilterMode('article'); setMode('category'); });
  randomBtn.addEventListener('click', () => { setFilterMode('random'); setMode('random'); });

  setFilterMode('article'); initCategoryView(); setMode('category');
})().catch(err => { document.body.innerHTML = `<main style="padding:24px;font-family:sans-serif;line-height:1.8"><h1>カードデータを読み込めませんでした</h1><p>${err.message}</p><p>GitHub Pages上で開くか、ローカルでは簡易サーバーから開いてください。</p></main>`; });
