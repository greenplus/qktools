// Pure, browser-independent two-player replay and analysis engine.
export const RANKS = 'A23456789TJQKX';
export const DEFAULT_RULE = { penalty: 'normal', returnMode: 'ordered', seed: 20261009, composite: true };
export const clone = value => structuredClone(value);
export const rankValue = rank => ({ A: 1, T: 10, J: 11, Q: 12, K: 13 }[rank] ?? Number(rank));
export const sortedRanks = text => [...text].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b)).join('');
export const isFilled = card => card.source === '補完' || card.originSource === '補完';
const fail = message => { throw new Error(message); };
export function ranks(text, allowEmpty = false) {
  const value = String(text).replace(/\s/g, '').toUpperCase().replaceAll('1', 'A');
  if ((!value && !allowEmpty) || [...value].some(c => !RANKS.includes(c))) fail('札は A23456789TJQKX で指定してください。');
  return value;
}
function random(seed) {
  let x = Number(seed) >>> 0;
  return () => { x += 0x6D2B79F5; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(items, seed) {
  const next = random(seed);
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}
export function parseTurn(player, body, line = 0) {
  const raw = body.trim();
  let value = raw.replace(/\s/g, '');
  const revolution = value.startsWith('[R]');
  if (revolution) value = value.slice(3);
  let draw = '', penalty = null;
  value = value.replace(/^D\(([^)]*)\)/, (_, cards) => { draw = ranks(cards); if (draw.length !== 1) fail('通常ドローは1枚です。'); return ''; });
  value = value.replace(/,P\(([^)]*)\)/, (_, cards) => { penalty = ranks(cards, true); return ''; });
  const jokerValues = [];
  value = value.replace(/\|X=(13|12|11|10|[0-9ATJQK])(?![0-9ATJQK])/gi, (_, token) => { jokerValues.push(String(/^[ATJQK]$/i.test(token) ? rankValue(token.toUpperCase()) : Number(token))); return ''; });
  const tags = [...value.matchAll(/\[(GC|IN|RR)\]/g)].map(m => m[1]);
  value = value.replace(/\[(?:GC|IN|RR)\]/g, '');
  const winner = value.endsWith('#');
  if (winner) value = value.slice(0, -1);
  const timeout = value === '%%', pass = value === '%' || timeout;
  if (pass && (penalty !== null || tags.length || jokerValues.length || winner)) fail('パスの記録が不正です。');
  const parts = value.replaceAll('×', '*').split('=');
  if (parts.length > 2) fail('合成数は 見せ札=材料式 の形で指定してください。');
  const display = pass ? '' : ranks(parts[0]);
  const expression = parts[1] ?? '';
  if (parts.length === 2 && (!expression || !/^[A23456789TJQKX1*^]+$/i.test(expression))) fail('合成数の材料式を確認してください。');
  const material = expression ? ranks(expression.replace(/[*^]/g, '')) : '';
  if (display === 'X' && !expression && !jokerValues.length) tags.push(...(tags.includes('IN') ? [] : ['IN']));
  const all = display + material;
  if (all !== 'X' && [...all].filter(c => c === 'X').length !== jokerValues.length) fail('Xの代入値が不足しています。|X=J などを指定してください。');
  return { player, raw, line, revolution, draw, penalty, jokerValues, tags, winner, pass, timeout, display, expression, material };
}
export function parseKifu(text) {
  if (text.length > 2_000_000) fail('数譜は2MB以内にしてください。');
  const games = [];
  let game = null, header = [];
  for (const [index, input] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const value = input.trim();
    if (!value) continue;
    const match = value.match(/^(.+?)[:：]\s*(.*)$/);
    const initial = match?.[2].match(/^\(([A23456789TJQKX1\s]+)\)$/i);
    if (initial) {
      if (!game || game.turns.length || game.players.length === 2) {
        if (game && !game.turns.length && game.players.length === 2) fail('通常2人戦の初期手札を指定してください。3人以上の数譜には対応していません。');
        game = { players: [], initial: {}, turns: [], header: header.join('\n') }; games.push(game); header = [];
      }
      const player = match[1].trim();
      if (game.players.includes(player)) fail(`${index + 1}行目: プレイヤー名が重複しています。`);
      game.players.push(player); game.initial[player] = ranks(initial[1]);
    } else if (match && game && game.players.includes(match[1].trim())) {
      try { game.turns.push(parseTurn(match[1].trim(), match[2], index + 1)); }
      catch (error) { fail(`${index + 1}行目: ${error.message}`); }
    } else {
      if (match && /^[\[(A23456789TJQKXD%]/.test(match[2])) fail(`${index + 1}行目: 2人のプレイヤー名と数譜の書式を確認してください。`);
      header.push(value);
    }
  }
  if (!games.length) fail('両者の初期手札を含む標準大会数譜を貼り付けてください。');
  for (const entry of games) if (entry.players.length !== 2) fail('通常2人戦の初期手札が必要です。');
  return games;
}
export function numeric(cards, assignments) {
  let j = 0;
  const value = [...cards].map(c => c === 'X' ? assignments[j++] : String(rankValue(c))).join('');
  if (!/^\d+$/.test(value) || value.startsWith('0')) fail('Xは0〜13で指定し、先頭を0にしないでください。');
  return BigInt(value);
}
function modpow(base, exponent, modulus) {
  let value = 1n;
  while (exponent) { if (exponent & 1n) value = value * base % modulus; base = base * base % modulus; exponent >>= 1n; }
  return value;
}
export function primeStatus(value) {
  if (value < 2n) return 'composite';
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) { if (value === p) return 'prime'; if (value % p === 0n) return 'composite'; }
  let d = value - 1n, s = 0;
  while (!(d & 1n)) { d >>= 1n; s++; }
  const bases = value < (1n << 64n) ? [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n] : [...small, 41n, 43n, 47n, 53n];
  for (let a of bases) {
    a %= value; if (!a) continue;
    let x = modpow(a, d, value);
    if (x === 1n || x === value - 1n) continue;
    let passed = false;
    for (let r = 1; r < s; r++) { x = x * x % value; if (x === value - 1n) { passed = true; break; } }
    if (!passed) return 'composite';
  }
  return value < (1n << 64n) ? 'prime' : 'probable';
}
function expressionValue(turn) {
  const expression = turn.expression.toUpperCase().replaceAll('1', 'A');
  if (!/^[A23456789TJQKX]+(?:[*^][A23456789TJQKX]+)+$/.test(expression)) fail('材料式は素数の積・累乗で作ってください。');
  let joker = [...turn.display].filter(c => c === 'X').length;
  const chunks = expression.split('*').map(chunk => chunk.split('^').map(seq => {
    const count = [...seq].filter(c => c === 'X').length;
    const result = numeric(seq, turn.jokerValues.slice(joker, joker + count)); joker += count; return result;
  }));
  for (const chunk of chunks) {
    if (chunk[0] < 2n || chunk.slice(1).some(n => n < 2n)) fail('底は2以上、明示した指数はすべて2以上にしてください。');
  }
  let value = 1n, probable = false;
  for (const chunk of chunks) {
    const status = primeStatus(chunk[0]);
    if (status === 'composite') return { valid: false, probable: false };
    probable ||= status === 'probable';
    let exp = 1n;
    if (chunk.length > 1) {
      exp = chunk.at(-1);
      if (exp > 122n) return { valid: false, probable };
      for (let i = chunk.length - 2; i > 0; i--) {
        if (chunk[i] > 122n) return { valid: false, probable };
        exp = chunk[i] ** exp; if (exp > 122n) return { valid: false, probable };
      }
    }
    // Avoid large unnecessary integers: a valid displayed number has at most 108 digits.
    if (chunk[0].toString().length * Number(exp) > 250) return { valid: false, probable };
    value *= chunk[0] ** exp;
    if (value.toString().length > 150) return { valid: false, probable };
  }
  return { valid: value === numeric(turn.display, turn.jokerValues), probable };
}
function takeCards(hand, text) {
  const copy = [...hand], found = [];
  for (const rank of text) {
    const i = copy.findIndex(card => card.rank === rank);
    if (i < 0) fail(`手札に ${rank} が足りません。見せ札と材料札は別々の札が必要です。`);
    found.push(copy.splice(i, 1)[0]);
  }
  return { remaining: copy, found };
}
export function assertConservation(state) {
  const cards = [...Object.values(state.hands).flat(), ...state.deck, ...state.reserve];
  if (cards.length !== 54 || new Set(cards.map(c => c.id)).size !== 54) fail('札の保存則に違反しています。');
  for (const rank of RANKS) if (cards.filter(c => c.rank === rank).length !== (rank === 'X' ? 2 : 4)) fail(`${rank}の枚数が通常デッキと一致しません。`);
  return true;
}
function newState(game, rule, initialDeck) {
  let id = 0;
  const hands = Object.fromEntries(game.players.map(player => [player, [...game.initial[player]].map(rank => ({ id: `h${id++}`, rank, source: '初期手札' }))]));
  const remaining = [...RANKS].flatMap(rank => Array(rank === 'X' ? 2 : 4).fill(rank));
  for (const card of Object.values(hands).flat()) {
    const index = remaining.indexOf(card.rank);
    if (index < 0) fail(`初期手札に ${card.rank} が多すぎます。通常54枚の数譜を指定してください。`);
    remaining.splice(index, 1);
  }
  const deck = initialDeck ? clone(initialDeck) : remaining.map((_, i) => ({ id: `d${i}`, rank: null, source: '未判明' }));
  const turn = game.turns[0]?.player ?? game.players[0];
  return { state: { players: [...game.players], hands, deck, reserve: [], field: null, turn, revolution: game.turns[0]?.revolution ?? false, rule: { ...DEFAULT_RULE, ...rule }, winner: null, drawn: '', notes: [], flowCount: 0 }, remaining };
}
function other(state, player) { return state.players.find(p => p !== player); }
function flow(state) {
  let returned = state.reserve;
  if (state.rule.returnMode === 'shuffle') returned = shuffle([...returned], Number(state.rule.seed) + state.flowCount);
  state.deck.push(...returned); state.reserve = []; state.field = null; state.flowCount++;
}
function recordedDraw(state, rank, pool, assignments, trace) {
  if (!state.deck.length) fail(`山札が空なのに ${rank} のドローがあります。`);
  let top = state.deck[0];
  if (top.rank === null && pool.includes(rank)) {
    pool.splice(pool.indexOf(rank), 1); top.rank = rank; top.source = '数譜から判明'; assignments.set(top.id, { ...top });
  } else if (top.rank !== rank) {
    let index = state.deck.findIndex(card => card.rank === rank);
    if (index < 0 && pool.includes(rank)) {
      index = state.deck.findIndex(card => card.rank === null);
      if (index >= 0) { pool.splice(pool.indexOf(rank), 1); state.deck[index].rank = rank; state.deck[index].source = '数譜から判明'; assignments.set(state.deck[index].id, { ...state.deck[index] }); }
    }
    if (index < 0) fail(`山札内に記録された ${rank} がありません。札の不足は推測で追加しません。`);
    top = state.deck.splice(index, 1)[0]; state.deck.unshift(top);
    state.notes.push(`山札順序調整: 記録の ${rank} を優先（シャッフル等の可能性）。`);
  }
  const card = state.deck.shift(); trace?.push(card.id); state.hands[state.turn].push(card); return card;
}
function replayTurn(before, turn, pool, assignments, trace) {
  const state = clone(before); state.notes = []; state.drawn = '';
  if (state.winner) fail('終局後に着手があります。');
  if (state.turn !== turn.player) fail(`手番は ${state.turn} ですが、${turn.player} の記録があります。`);
  if (turn.revolution !== state.revolution) fail('[R] と革命状態が一致しません。');
  if (turn.draw) recordedDraw(state, turn.draw, pool, assignments, trace);
  if (turn.pass) { flow(state); state.turn = other(state, turn.player); }
  else if (turn.penalty !== null) {
    takeCards(state.hands[turn.player], turn.display + turn.material);
    for (const rank of turn.penalty) recordedDraw(state, rank, pool, assignments, trace);
    flow(state); state.turn = other(state, turn.player);
  } else {
    const taken = takeCards(state.hands[turn.player], turn.display + turn.material);
    state.hands[turn.player] = taken.remaining;
    const displayCards = taken.found.slice(0, turn.display.length);
    state.reserve.push(...displayCards);
    state.deck.push(...taken.found.slice(turn.display.length));
    if (turn.tags.includes('GC') || turn.tags.includes('IN')) { flow(state); state.turn = turn.player; }
    else {
      state.field = { cards: displayCards, number: numeric(turn.display, turn.jokerValues).toString(), player: turn.player, notation: turn.display + (turn.expression ? `=${turn.expression}` : '') };
      if (turn.tags.includes('RR')) state.revolution = !state.revolution;
      state.turn = other(state, turn.player);
    }
    const finished = !state.hands[turn.player].length;
    if (turn.winner !== finished) fail('上がりの # と残り手札が一致しません。');
    if (finished) state.winner = turn.player;
  }
  return state;
}
export function reconstruct(game, rule = DEFAULT_RULE) {
  game = clone(game);
  const legacyRevolution = !game.turns.some(turn => turn.revolution);
  const first = newState(game, rule), assignments = new Map();
  let state = first.state;
  for (const turn of game.turns) {
    if (legacyRevolution) turn.revolution = state.revolution;
    try { state = replayTurn(state, turn, first.remaining, assignments); }
    catch (error) { fail(`${turn.line}行目: ${error.message}`); }
  }
  const tail = shuffle(first.remaining, rule.seed ?? DEFAULT_RULE.seed);
  const initialDeck = first.state.deck.map(card => assignments.get(card.id) ?? { ...card, rank: tail.shift(), source: '補完' });
  const second = newState(game, rule, initialDeck), frames = [second.state], traces = [];
  state = second.state;
  for (const turn of game.turns) { const trace = []; state = replayTurn(state, turn, [], new Map(), trace); assertConservation(state); frames.push(state); traces.push(trace); }
  if (legacyRevolution && game.turns.some(turn => turn.revolution)) frames[0].notes.push('旧数譜の省略された [R] を [RR] の記録から復元しました。');
  assertConservation(frames[0]);
  // At every position, use future observed draws of cards already in this deck.
  // Returned cards still outside this deck are excluded. This also learns a
  // shuffled returned batch instead of blindly assuming FIFO after a flow.
  for (let f = 0; f < frames.length; f++) {
    const current = frames[f];
    const available = new Set(current.deck.map(c => c.id)), seen = new Set(), ordered = [];
    // A card may cycle through the deck more than once; only its first future draw matters.
    for (let t = f; t < traces.length; t++) for (const id of traces[t]) {
      if (available.has(id) && !seen.has(id)) { seen.add(id); ordered.push(id); }
    }
    const byId = new Map(current.deck.map(c => [c.id, c]));
    const inferred = [...ordered.map(id => byId.get(id)), ...current.deck.filter(c => !seen.has(c.id))];
    if (inferred.some((c, i) => c.id !== current.deck[i].id)) {
      current.notes.push('数譜の後続ドローから、この局面の山札順序を補正しました。');
      current.deck = inferred;
    }
  }
  return { game: clone(game), frames, initialDeck };
}
export function draw(before) {
  const state = clone(before); state.notes = [];
  if (state.winner) fail('すでに終局しています。');
  if (state.drawn) fail('このターンはドロー済みです。');
  if (!state.deck.length) fail('山札が空です。');
  const card = state.deck.shift(); state.hands[state.turn].push(card); state.drawn = card.rank;
  if (isFilled(card)) state.notes.push(`補完した山札から ${card.rank} を引きました。`);
  assertConservation(state); return state;
}
export function notation(turn) {
  const assignment = turn.jokerValues.map(value => `|X=${({ 1: 'A', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' }[value] ?? value)}`).join('');
  return `${turn.player}:${turn.revolution ? '[R]' : ''}${turn.draw ? `D(${turn.draw})` : ''}${turn.pass ? (turn.timeout ? '%%' : '%') : `${turn.display}${turn.expression ? `=${turn.expression}` : ''}${assignment}${turn.tags.map(tag => `[${tag}]`).join('')}${turn.penalty !== null ? `,P(${turn.penalty})` : ''}${turn.winner ? '#' : ''}`}`;
}
export function play(before, input) {
  const state = clone(before); state.notes = [];
  if (state.winner) fail('すでに終局しています。');
  const turn = parseTurn(state.turn, input);
  if (turn.draw || turn.penalty !== null || turn.tags.some(tag => tag !== 'IN') || turn.winner || turn.revolution) fail('検討着手には札・材料式・X代入だけを入力してください。効果とペナルティは自動判定します。');
  turn.draw = state.drawn; turn.revolution = state.revolution; turn.tags = [];
  if (turn.pass) { flow(state); state.turn = other(state, turn.player); }
  else {
    if (turn.expression && !state.rule.composite) fail('合成数なしの設定です。');
    const taken = takeCards(state.hands[turn.player], turn.display + turn.material);
    const singleton = turn.display === 'X' && !turn.expression;
    let number = null, probable = false, valid = true;
    if (singleton) {
      if (state.field && state.field.cards.length !== 1) fail('単独Xは空場か1枚場にだけ出せます。');
    } else {
      number = numeric(turn.display, turn.jokerValues);
      if (state.field) {
        if (turn.display.length !== state.field.cards.length) fail('場と同じ枚数の見せ札を選んでください。');
        const field = BigInt(state.field.number);
        if (state.revolution ? number >= field : number <= field) fail(state.revolution ? '革命中は場より小さい数を出してください。' : '場より大きい数を出してください。');
      }
      if (turn.expression) ({ valid, probable } = expressionValue(turn));
      else if (number !== 57n && number !== 1729n) { const status = primeStatus(number); valid = status !== 'composite'; probable = status === 'probable'; }
    }
    if (!valid) {
      const count = state.rule.penalty === 'one' ? 1 : state.rule.penalty === 'field' ? turn.display.length : turn.display.length + turn.material.length;
      turn.penalty = '';
      for (let i = 0; i < count && state.deck.length; i++) { const card = state.deck.shift(); state.hands[turn.player].push(card); turn.penalty += card.rank; if (isFilled(card)) state.notes.push(`ペナルティ札 ${card.rank} は補完です。`); }
      state.notes.push('数の判定に失敗したため、札を手元に残してペナルティを受けました。');
      flow(state); state.turn = other(state, turn.player);
    } else {
      state.hands[turn.player] = taken.remaining;
      const shown = taken.found.slice(0, turn.display.length);
      state.reserve.push(...shown); state.deck.push(...taken.found.slice(turn.display.length));
      // In ordinary rules, 57/1729 special effects apply to normal play only.
      if (singleton || (!turn.expression && number === 57n)) { turn.tags.push(singleton ? 'IN' : 'GC'); flow(state); state.turn = turn.player; }
      else {
        state.field = { cards: shown, number: number.toString(), player: turn.player, notation: turn.display + (turn.expression ? `=${turn.expression}` : '') };
        if (!turn.expression && number === 1729n) { state.revolution = !state.revolution; turn.tags.push('RR'); }
        state.turn = other(state, turn.player);
      }
      if (probable) state.notes.push('64ビットを超える数は16底のMiller–Rabin検査通過として扱っています（素数の証明ではありません）。');
      if (!state.hands[turn.player].length) { state.winner = turn.player; turn.winner = true; }
    }
  }
  state.drawn = ''; assertConservation(state);
  return { state, turn, line: notation(turn) };
}
export function editDeck(before, text) {
  const state = clone(before), desired = ranks(text, true), pool = [...state.deck], deck = [];
  if (desired.length !== pool.length) fail(`山札は現在の ${pool.length} 枚すべてを指定してください。`);
  for (const rank of desired) { const i = pool.findIndex(card => card.rank === rank); if (i < 0) fail('山札の札の種類・枚数を変えることはできません。順番だけを編集してください。'); const card = pool.splice(i, 1)[0]; deck.push({ ...card, originSource: card.originSource ?? card.source, source: '手動設定' }); }
  state.deck = deck; state.notes = ['山札の順番を手動設定しました。']; assertConservation(state); return state;
}
export function createSession(text, rule = DEFAULT_RULE, gameIndex = 0) {
  const games = parseKifu(text), replay = reconstruct(games[gameIndex] ?? fail('対局がありません。'), rule);
  const nodes = replay.frames.map((state, index) => ({ id: index, parent: index ? index - 1 : null, children: index < replay.frames.length - 1 ? [index + 1] : [], main: true, label: index ? notation(replay.game.turns[index - 1]) : '初期局面', line: index ? notation(replay.game.turns[index - 1]) : '', state, depth: index }));
  return { version: 1, text, rule: { ...DEFAULT_RULE, ...rule }, gameIndex, games, nodes, current: 0, mainEnd: nodes.length - 1 };
}
export function addNode(session, state, label, line = '') {
  const parent = session.nodes[session.current];
  const node = { id: session.nodes.length, parent: parent.id, children: [], main: false, label, line, state, depth: parent.depth + (line ? 1 : 0) };
  parent.children.push(node.id); session.nodes.push(node); session.current = node.id; return node;
}
export function route(session, id = session.current) {
  const path = []; let node = session.nodes[id];
  while (node) { path.unshift(node); node = node.parent === null ? null : session.nodes[node.parent]; }
  return path;
}
export function exportKifu(session, id = session.current) {
  const game = session.games[session.gameIndex];
  return [...game.players.map(p => `${p}:(${sortedRanks(game.initial[p])})`), ...route(session, id).filter(n => n.line).map(n => n.line)].join('\n');
}
export function validateSession(value) {
  if (value?.version !== 1 || typeof value.text !== 'string' || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 20_000) fail('対応した検討ファイルではありません。');
  const fresh = createSession(value.text, value.rule, value.gameIndex);
  if (!Number.isInteger(value.current) || !value.nodes[value.current]) fail('検討局面が不正です。');
  for (let i = 0; i < value.nodes.length; i++) {
    const node = value.nodes[i];
    if (node.id !== i || (i === 0 ? node.parent !== null : !Number.isInteger(node.parent) || node.parent < 0 || node.parent >= i)) fail('分岐の親子関係が不正です。');
    if (!Array.isArray(node.children) || node.children.some(id => !Number.isInteger(id) || id <= i || !value.nodes[id] || value.nodes[id].parent !== i)) fail('分岐の接続が不正です。');
    if (i && !value.nodes[node.parent].children.includes(i)) fail('親局面に分岐がありません。');
    if (!node.state || !Array.isArray(node.state.players) || node.state.players.join('\0') !== fresh.nodes[0].state.players.join('\0') || !node.state.players.includes(node.state.turn)) fail('検討状態が不正です。');
    for (const p of node.state.players) if (!Array.isArray(node.state.hands?.[p])) fail('手札が不正です。');
    if (!Array.isArray(node.state.deck) || !Array.isArray(node.state.reserve)) fail('山札が不正です。');
    assertConservation(node.state);
    if (node.state.drawn || !['normal', 'one', 'field'].includes(node.state.rule?.penalty) || !['ordered', 'shuffle'].includes(node.state.rule?.returnMode) || !Number.isInteger(node.state.rule?.seed) || typeof node.state.rule?.composite !== 'boolean' || !Array.isArray(node.state.notes) || node.state.notes.some(n => typeof n !== 'string')) fail('検討ルール・状態が不正です。');
    if (node.state.field && (!Array.isArray(node.state.field.cards) || !/^\d{1,108}$/.test(node.state.field.number) || node.state.field.cards.some(c => !node.state.reserve.some(r => r.id === c.id)))) fail('場が不正です。');
    if (typeof node.line !== 'string' || typeof node.label !== 'string') fail('着手が不正です。');
  }
  value.games = fresh.games; value.mainEnd = fresh.mainEnd;
  if (value.nodes.length <= value.mainEnd || value.nodes.slice(0, value.mainEnd + 1).some((node, i) => node.line !== fresh.nodes[i].line || !node.main)) fail('本譜の記録が不正です。');
  return value;
}
