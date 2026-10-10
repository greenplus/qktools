import { DEFAULT_RULE, RANKS, isFilled, draw, editDeck, addNode, route, exportKifu } from './engine.mjs';
import { SAMPLE } from './sample.mjs';
const $ = id => document.getElementById(id);
const STORAGE = 'primeqk-replay-v1';
let session = null, draft = null, flipped = false, analyzing = false, mode = 'normal', target = 'shown', shown = [], material = [], joker = new Map(), busy = false;
let archives = new Map();
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
let requestId = 0;
const requests = new Map();
worker.onmessage = ({ data }) => { const pending = requests.get(data.id); if (!pending) return; requests.delete(data.id); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result); };
worker.onerror = () => { for (const request of requests.values()) request.reject(new Error('検討処理を開始できませんでした。HTTPサーバーで開き直してください。')); requests.clear(); message('検討処理を開始できませんでした。ページを再読み込みしてください。', true); };
function run(action, data) { return new Promise((resolve, reject) => { const id = ++requestId; requests.set(id, { resolve, reject }); worker.postMessage({ id, action, ...data }); }); }
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function current() { return draft ?? session.nodes[session.current].state; }
function ruleFromUI() { return { penalty: $('penaltyRule').value, returnMode: $('returnMode').value, seed: Number($('seedInput').value) >>> 0, composite: $('compositeRule').checked }; }
function ruleToUI(rule) { $('penaltyRule').value = rule.penalty; $('returnMode').value = rule.returnMode; $('seedInput').value = rule.seed; $('compositeRule').checked = rule.composite; }
function resetSelection() { shown = []; material = []; joker.clear(); }
function snapshot() { return { session, flipped, analyzing, sourceURL: location.href, archives: [...archives].filter(([index]) => index !== session.gameIndex) }; }
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORAGE, JSON.stringify(snapshot())); } catch { message('ブラウザの自動保存容量を超えました。「検討を保存」でファイルに保存してください。', true); } }, 300);
}
async function guard(task) {
  if (busy) return;
  busy = true; document.body.setAttribute('aria-busy', 'true'); renderButtons();
  try { await task(); } catch (error) { message(error.message, true); }
  finally { busy = false; document.body.removeAttribute('aria-busy'); renderButtons(); }
}
async function load(text, gameIndex = 0, rule = ruleFromUI()) {
  const next = await run('create', { text, rule, gameIndex });
  session = next; archives = new Map(); draft = null; analyzing = false; mode = 'normal'; target = 'shown'; resetSelection(); ruleToUI(session.rule); $('kifuInput').value = text;
  $('workspace').hidden = false; $('importPanel').open = false;
  const notes = session.nodes.flatMap(n => n.state.notes).filter(n => n.includes('順序'));
  message(`${session.games.length}局を読み込みました。${notes.length ? '山札の順序補正を含みます。' : '好きな局面から検討できます。'}`);
  render(); persist();
}
function selectNode(id, analysis = !session.nodes[id].main) {
  if (busy) return;
  session.current = id; draft = null; analyzing = analysis; resetSelection(); message(''); render(); persist();
}
function cardElement(card, state, interactive = false) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'playing-card';
  button.classList.toggle('joker', card.rank === 'X');
  button.classList.toggle('chosen', shown.includes(card.id) || material.some(t => t.id === card.id));
  button.classList.toggle('material-chosen', material.some(t => t.id === card.id));
  const rank = document.createElement('span'); rank.textContent = card.rank; button.append(rank);
  const suit = document.createElement('small'); suit.className = 'card-suit'; suit.textContent = card.rank === 'X' ? 'JOKER' : '札'; button.append(suit);
  button.disabled = !interactive || !!state.winner;
  button.setAttribute('aria-label', `${card.rank}${shown.includes(card.id) ? ' 見せ札に選択済み' : material.some(t => t.id === card.id) ? ' 材料に選択済み' : ''}`);
  button.setAttribute('aria-pressed', String(shown.includes(card.id) || material.some(t => t.id === card.id)));
  if (interactive) button.onclick = () => chooseCard(card.id);
  return button;
}
function renderHand(container, player, state) {
  container.replaceChildren(); container.classList.toggle('active-hand', state.turn === player && !state.winner);
  const heading = document.createElement('div'); heading.className = 'hand-heading';
  if (state.turn === player && !state.winner) { const dot = document.createElement('span'); dot.className = 'turn-dot'; heading.append(dot); }
  const name = document.createElement('strong'); name.textContent = player; heading.append(name);
  const count = document.createElement('span'); count.className = 'microcopy'; count.style.marginTop = '0'; count.textContent = `手札 ${state.hands[player].length}枚`; heading.append(count);
  const cards = document.createElement('div'); cards.className = 'cards';
  for (const card of [...state.hands[player]].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank))) cards.append(cardElement(card, state, player === state.turn));
  container.append(heading, cards);
}
function renderSelection() {
  if (!session) return;
  const state = current(), hand = state.hands[state.turn], byId = new Map(hand.map(c => [c.id, c]));
  $('normalMode').classList.toggle('active', mode === 'normal'); $('normalMode').setAttribute('aria-pressed', String(mode === 'normal'));
  $('compositeMode').classList.toggle('active', mode === 'composite'); $('compositeMode').setAttribute('aria-pressed', String(mode === 'composite'));
  $('showTarget').classList.toggle('active', target === 'shown'); $('showTarget').setAttribute('aria-pressed', String(target === 'shown'));
  $('materialTarget').classList.toggle('active', target === 'material'); $('materialTarget').setAttribute('aria-pressed', String(target === 'material'));
  for (const id of ['materialTarget', 'multiplyBtn', 'powerBtn', 'materialLabel', 'materialSelection']) $(id).hidden = mode !== 'composite';
  $('shownSelection').textContent = shown.map(id => byId.get(id)?.rank ?? '').join('') || '—';
  $('materialSelection').textContent = material.map(t => t.op ?? byId.get(t.id)?.rank ?? '').join('') || '—';
  $('jokerAssignments').replaceChildren();
  const ids = [...shown, ...material.filter(t => t.id).map(t => t.id)].filter(id => byId.get(id)?.rank === 'X');
  ids.forEach((id, index) => {
    if (!joker.has(id)) joker.set(id, '11');
    const label = document.createElement('label'); label.textContent = `X${index + 1} =`;
    const select = document.createElement('select'); select.setAttribute('aria-label', `X${index + 1}の代入値`);
    for (let i = 0; i <= 13; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = ({ 1: 'A (1)', 10: 'T (10)', 11: 'J (11)', 12: 'Q (12)', 13: 'K (13)' }[i] ?? String(i)); select.append(option); }
    select.value = joker.get(id); select.onchange = () => joker.set(id, select.value); label.append(select); $('jokerAssignments').append(label);
  });
  $('draftDraw').textContent = state.drawn ? `D(${state.drawn}) ドロー済み` : '';
}
function renderBranches() {
  const list = $('branchList'); list.replaceChildren();
  // Show the complete main line and a compact list of variation roots/leaves.
  const order = [];
  for (let i = 0; i <= session.mainEnd; i++) order.push(session.nodes[i]);
  const variants = session.nodes.filter(n => !n.main);
  if (variants.length) {
    const label = document.createElement('p'); label.className = 'microcopy'; label.textContent = '検討の分岐（クリックで局面を開く）'; list.append(label);
  }
  for (const node of [...order, ...variants]) {
    const row = document.createElement('div'); row.className = 'branch-row';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'branch-button';
    button.classList.toggle('current', node.id === session.current); button.classList.toggle('variation', !node.main);
    const number = document.createElement('span'); number.className = 'branch-index'; number.textContent = node.main ? String(node.depth) : `検討${node.id - session.mainEnd} · ${node.depth}手`;
    const text = document.createElement('span'); text.textContent = node.name ? `${node.name} · ${node.label}` : node.label;
    button.append(number, text);
    const parent = session.nodes[node.parent];
    button.title = node.main ? node.label : `分岐元: ${parent?.name ?? parent?.label ?? '初期局面'}`;
    button.setAttribute('aria-current', node.id === session.current ? 'step' : 'false'); button.onclick = () => selectNode(node.id);
    row.append(button); list.append(row);
  }
}
function renderButtons() {
  $('loadBtn').disabled = busy; $('pasteBtn').disabled = busy; $('sampleBtn').disabled = busy; $('fileInput').disabled = busy;
  if (!session) return;
  const node = session.nodes[session.current], state = current();
  $('gameSelect').disabled = busy || !!draft;
  const ancestor = route(session).filter(n => n.main).at(-1);
  $('startBtn').disabled = busy; $('endBtn').disabled = busy; $('mainBtn').disabled = busy;
  $('backBtn').disabled = busy || (node.parent === null && !draft);
  $('nextBtn').disabled = busy || !node.main || node.id === session.mainEnd || !!draft;
  $('forkBtn').disabled = busy || !!state.winner;
  $('playBtn').disabled = busy || !!state.winner || !shown.length;
  for (const id of ['passBtn', 'inputPlayBtn', 'applyDeckBtn']) $(id).disabled = busy || !!state.winner;
  $('drawBtn').disabled = busy || !!state.winner || !!state.drawn || !state.deck.length;
  $('compositeMode').disabled = busy || !state.rule.composite;
  $('renameBtn').disabled = busy || node.main;
  for (const button of $('branchList').querySelectorAll('button')) button.disabled = busy;
  for (const id of ['flipBtn', 'normalMode', 'showTarget', 'materialTarget', 'multiplyBtn', 'powerBtn', 'undoSelectBtn', 'clearBtn', 'saveSessionBtn', 'shareBtn', 'copyRouteBtn', 'saveRouteBtn', 'copyMainBtn']) $(id).disabled = busy;
  $('turnSlider').value = ancestor?.id ?? 0;
}
function render() {
  if (!session) return;
  const state = current(), node = session.nodes[session.current], players = flipped ? [...state.players].reverse() : state.players;
  $('workspace').hidden = false;
  $('gameSelect').replaceChildren();
  session.games.forEach((game, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `第${index + 1}局 ${game.players.join(' vs ')}`; $('gameSelect').append(option); });
  $('gameSelect').value = String(session.gameIndex);
  $('modeBadge').textContent = analyzing || !node.main ? '検討' : '本譜'; $('modeBadge').classList.toggle('analysis', analyzing || !node.main);
  $('positionLabel').textContent = node.main ? `本譜 ${node.depth}/${session.mainEnd}手` : `検討 ${node.depth}手目`;
  $('turnSlider').max = session.mainEnd;
  renderHand($('upperHand'), players[1], state); renderHand($('lowerHand'), players[0], state);
  $('fieldCards').replaceChildren();
  if (state.field) for (const card of state.field.cards) $('fieldCards').append(cardElement(card, state));
  $('fieldNumber').textContent = state.field ? state.field.number : '場は空です'; $('fieldNumber').classList.toggle('empty', !state.field);
  $('fieldPlayer').textContent = state.field ? `${state.field.player}の出札${state.field.notation.includes('=') ? ` · ${state.field.notation}` : ''}` : '';
  $('reserveCount').textContent = `予備軍 ${state.reserve.length}枚`; $('deckCount').textContent = `山札 ${state.deck.length}枚`;
  $('revolutionBadge').textContent = state.revolution ? '革命中 ↓' : '通常 ↑'; $('revolutionBadge').classList.toggle('revolution', state.revolution);
  $('turnLabel').textContent = state.winner ? `${state.winner}の勝ち` : `${state.turn}の手番${analyzing ? ' · 検討中' : ''}`;
  $('deckCards').replaceChildren();
  state.deck.forEach((card, index) => { const token = document.createElement('span'); token.className = 'deck-card'; token.classList.toggle('filled', isFilled(card)); token.classList.toggle('manual', card.source === '手動設定'); token.textContent = card.rank; token.title = `${index + 1}枚目 · ${card.source}${card.originSource ? `（元: ${card.originSource}）` : ''}`; $('deckCards').append(token); });
  $('deckSourceSummary').textContent = `補完 ${state.deck.filter(isFilled).length}枚 · seed ${state.rule.seed} · ${state.rule.returnMode === 'shuffle' ? '流す札をシャッフル' : '順序保持'}`;
  $('deckInput').value = state.deck.map(c => c.rank).join('');
  $('positionNotes').replaceChildren();
  for (const note of state.notes) { const p = document.createElement('p'); p.textContent = note; $('positionNotes').append(p); }
  const edits = route(session).some(n => !n.line && !n.main);
  $('exportLabel').textContent = `${state.winner ? '終局までの手順' : '検討途中の手順（未終局）'} · rule=通常2人戦 · seed=${state.rule.seed} · leg=検討${edits ? '。山札編集は数譜だけでは再現できません。JSONまたはリンクを使ってください。' : ''}`;
  $('routeText').textContent = exportKifu(session);
  renderSelection(); renderBranches(); renderButtons();
}
function chooseCard(id) {
  if (busy || current().winner) return;
  analyzing = true;
  const existing = shown.indexOf(id), materialIndex = material.findIndex(t => t.id === id);
  if (existing >= 0) shown.splice(existing, 1);
  else if (materialIndex >= 0) material.splice(materialIndex, 1);
  else if (target === 'material' && mode === 'composite') material.push({ id });
  else shown.push(id);
  render();
}
function selectionInput() {
  const hand = new Map(current().hands[current().turn].map(c => [c.id, c]));
  const display = shown.map(id => hand.get(id).rank).join('');
  const expression = mode === 'composite' ? material.map(t => t.op ?? hand.get(t.id).rank).join('') : '';
  if (mode === 'composite' && !expression) throw new Error('材料札を選び、積または累乗の式を作ってください。');
  const ids = [...shown, ...(mode === 'composite' ? material.filter(t => t.id).map(t => t.id) : [])];
  const singleton = display === 'X' && mode === 'normal';
  const assignments = singleton ? '' : ids.filter(id => hand.get(id).rank === 'X').map(id => `|X=${joker.get(id) ?? '11'}`).join('');
  return display + (expression ? `=${expression}` : '') + assignments;
}
async function commit(input) {
  const result = await run('play', { state: current(), input });
  addNode(session, result.state, result.line, result.line); draft = null; analyzing = true; resetSelection();
  message(result.state.notes.at(-1) ?? (result.state.winner ? `${result.state.winner}の勝ちです。` : '検討の着手を保存しました。'));
  render(); persist();
}
function download(text, name, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); message('コピーしました。'); }
  catch {
    const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('コピーできませんでした。本文を選択してコピーしてください。'); message('コピーしました。');
  }
}
function toBase64(bytes) { let str = ''; for (let i = 0; i < bytes.length; i += 8192) str += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(str).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function fromBase64(text) { if (text.length > 8_000_000) throw new Error('検討リンクが大きすぎます。JSONファイルを使ってください。'); const str = atob(text.replaceAll('-', '+').replaceAll('_', '/')); return Uint8Array.from(str, c => c.charCodeAt(0)); }
async function pack(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') return `z${toBase64(new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()))}`;
  return `j${toBase64(bytes)}`;
}
async function unpack(text) {
  let bytes = fromBase64(text.slice(1));
  if (text[0] === 'z') { if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザでは圧縮リンクを開けません。検討JSONを読み込んでください。'); const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')); const reader = stream.getReader(), chunks = []; let size = 0; for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 32_000_000) { await reader.cancel(); throw new Error('検討データが大きすぎます。'); } chunks.push(item.value); } bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } }
  else if (text[0] !== 'j') throw new Error('検討リンクの形式が不正です。');
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function restore(data) {
  const restored = await run('restore', { session: data.session ?? data });
  const saved = new Map();
  for (const [index, archived] of data.archives ?? []) {
    if (!Number.isInteger(index) || archived.text !== restored.text || archived.gameIndex !== index) throw new Error('保存された別対局の情報が不正です。');
    saved.set(index, await run('restore', { session: archived }));
  }
  session = restored; archives = saved; flipped = !!data.flipped; analyzing = data.analyzing ?? !session.nodes[session.current].main; draft = null; mode = 'normal'; target = 'shown'; resetSelection();
  ruleToUI(session.rule); $('kifuInput').value = session.text; $('importPanel').open = false; render(); persist(); message('検討を復元しました。');
}
$('loadBtn').onclick = () => guard(() => load($('kifuInput').value));
$('sampleBtn').onclick = () => guard(() => load(SAMPLE));
$('pasteBtn').onclick = () => guard(async () => { let text; try { text = await navigator.clipboard.readText(); } catch { throw new Error('クリップボードを読めませんでした。数譜欄に貼り付けて「読み込む」を押してください。'); } await load(text); });
$('fileInput').onchange = () => guard(async () => { const file = $('fileInput').files[0]; if (!file) return; if (file.size > 32_000_000) throw new Error('ファイルは32MB以内にしてください。'); const text = await file.text(); if (file.name.toLowerCase().endsWith('.json')) await restore(JSON.parse(text)); else await load(text); $('fileInput').value = ''; });
$('gameSelect').onchange = () => guard(async () => {
  const index = Number($('gameSelect').value);
  archives.set(session.gameIndex, session);
  const next = archives.get(index) ?? await run('create', { text: session.text, rule: session.rule, gameIndex: index });
  session = next; draft = null; analyzing = !session.nodes[session.current].main; resetSelection(); render(); persist(); message('対局を切り替えました。各局の検討は保持しています。');
});
$('startBtn').onclick = () => selectNode(0);
$('endBtn').onclick = () => selectNode(session.mainEnd);
$('backBtn').onclick = () => { if (draft) { draft = null; resetSelection(); render(); message('ドローを取り消しました。'); } else if (session.nodes[session.current].parent !== null) selectNode(session.nodes[session.current].parent, analyzing); };
$('nextBtn').onclick = () => { const node = session.nodes[session.current]; if (node.main && node.id < session.mainEnd) selectNode(node.id + 1); };
$('mainBtn').onclick = () => { const ancestor = route(session).filter(n => n.main).at(-1); selectNode(ancestor.id); };
$('turnSlider').oninput = () => selectNode(Number($('turnSlider').value));
$('forkBtn').onclick = () => { analyzing = true; render(); message(`${current().turn}の札を選んで着手できます。`); $('movePanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
$('flipBtn').onclick = () => { flipped = !flipped; render(); persist(); };
$('normalMode').onclick = () => { mode = 'normal'; target = 'shown'; resetSelection(); render(); };
$('compositeMode').onclick = () => { mode = 'composite'; resetSelection(); render(); };
$('showTarget').onclick = () => { target = 'shown'; renderSelection(); };
$('materialTarget').onclick = () => { target = 'material'; renderSelection(); };
for (const [id, op] of [['multiplyBtn', '*'], ['powerBtn', '^']]) $(id).onclick = () => { if (!material.length || material.at(-1).op) { message('演算子の前に材料札を選んでください。', true); return; } material.push({ op }); target = 'material'; renderSelection(); };
$('undoSelectBtn').onclick = () => { if (target === 'material') material.pop(); else shown.pop(); render(); };
$('clearBtn').onclick = () => { resetSelection(); render(); };
$('playBtn').onclick = () => guard(() => commit(selectionInput()));
$('inputPlayBtn').onclick = () => guard(() => commit($('moveInput').value));
$('moveInput').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); guard(() => commit($('moveInput').value)); } };
$('passBtn').onclick = () => guard(() => commit('%'));
$('drawBtn').onclick = () => guard(async () => { draft = draw(current()); analyzing = true; resetSelection(); render(); message(draft.notes.at(-1) ?? `D(${draft.drawn})。続けて出札かパスを選んでください。`); });
$('applyDeckBtn').onclick = () => guard(async () => { if (draft) throw new Error('ドロー後は出札・パスをするか、「戻る」でドローを取り消してから山札を編集してください。'); const state = editDeck(current(), $('deckInput').value); addNode(session, state, '山札を編集'); analyzing = true; resetSelection(); render(); persist(); message('山札を編集した検討を保存しました。'); });
$('renameBtn').onclick = () => { $('branchName').value = session.nodes[session.current].name ?? ''; $('nameDialog').showModal(); };
$('nameDialog').onclose = () => { if ($('nameDialog').returnValue === 'save') { session.nodes[session.current].name = $('branchName').value.trim(); renderBranches(); persist(); } };
function committedSnapshot() { if (draft) throw new Error('ドロー後に出札・パスをするか、ドローを取り消してから保存・共有してください。'); return snapshot(); }
$('saveSessionBtn').onclick = () => guard(async () => download(JSON.stringify(committedSnapshot()), 'primeqk-analysis.json', 'application/json'));
function routeDocument(id = session.current) { const state = session.nodes[id].state; return `# ${state.winner ? '終局までの手順' : '検討途中・未終局'} | rule=std-${session.games[session.gameIndex].initial[state.players[0]].length}-${{ normal: 'n', one: '1', field: 'f' }[state.rule.penalty]}${state.rule.composite ? '-c' : ''} | seed=${state.rule.seed}（山札補完） | leg=${session.nodes[id].main ? '本譜' : '検討'}\n${exportKifu(session, id)}`; }
$('copyRouteBtn').onclick = () => guard(async () => { committedSnapshot(); await copy(routeDocument()); });
$('saveRouteBtn').onclick = () => guard(async () => { committedSnapshot(); download(routeDocument(), 'primeqk-variation.txt'); });
$('copyMainBtn').onclick = () => guard(() => copy(routeDocument(session.mainEnd)));
$('shareBtn').onclick = () => guard(async () => { const packed = await pack(committedSnapshot()); const url = new URL(location.href); url.search = ''; url.hash = `analysis=${packed}`; $('shareInput').value = url.href; $('shareNote').textContent = url.href.length > 20_000 ? 'リンクが長いため、環境によって共有できない場合があります。「検討を保存」のJSONも使えます。' : '現在の局面と、山札・すべての検討分岐を含むリンクです。'; $('shareDialog').showModal(); });
$('copyShareBtn').onclick = () => guard(() => copy($('shareInput').value));
async function receiveURL() {
  const fragment = new URLSearchParams(location.hash.slice(1)), query = new URLSearchParams(location.search);
  if (fragment.has('analysis')) { await restore(await unpack(fragment.get('analysis'))); return true; }
  const text = fragment.get('kifu') ?? query.get('kifu');
  if (text !== null) { const rule = { ...DEFAULT_RULE }; const penalty = fragment.get('penalty') ?? query.get('penalty'); if (['normal', 'one', 'field'].includes(penalty)) rule.penalty = penalty; const returnMode = fragment.get('returnMode') ?? query.get('returnMode'); if (['ordered', 'shuffle'].includes(returnMode)) rule.returnMode = returnMode; const seed = fragment.get('seed') ?? query.get('seed'); if (seed !== null && /^\d+$/.test(seed)) rule.seed = Number(seed) >>> 0; await load(text, 0, rule); return true; }
  return false;
}
window.addEventListener('hashchange', () => guard(receiveURL));
await guard(async () => {
  let saved; try { saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); } catch { /* Storage may be unavailable or invalid. */ }
  if (saved?.sourceURL === location.href) { try { await restore(saved); return; } catch { /* Fall back to the incoming original record. */ } }
  if (await receiveURL()) return;
  if (saved) { try { await restore(saved); return; } catch { message('前回の検討を復元できませんでした。数譜を読み直してください。', true); } }
  $('kifuInput').value = SAMPLE;
});
