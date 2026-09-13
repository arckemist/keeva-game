/* ── game.js ── Quiz Game Mode state machine + fight loop (5-wave multi-boss) */

let GAME = null;
let STATE = null;
let QUESTION_POOL = [];

/* ── DISPLAY HELPERS ──
   Question data stores the domain as a machine key (e.g. `sila_nilai_penerapan`) — handy for
   stats bookkeeping, but it must never reach the screen with its underscores showing. Map the
   known keys to readable labels and fall back to Title-Casing anything unrecognised, so a
   regenerated game_data.json cannot leak raw keys into a kid's UI. */
const DOMAIN_LABELS = {
  // Kept for future subjects whose question data stores domains as snake_case machine keys
  // (the Pancasila set used e.g. `sila_nilai_penerapan`). The current English Language Arts
  // set ships human-readable domain names, so this map is empty and the Title-Case fallback
  // below is the only thing doing work — it stays as the guard against a raw key reaching the UI.
};

function domainLabel(d) {
  if (!d) return 'Umum';
  if (DOMAIN_LABELS[d]) return DOMAIN_LABELS[d];
  return String(d).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* The subtitle template used to hard-prefix "Grade ", so a data value of "Grade 5" rendered
   as "Grade Grade 5". Only add the prefix when the value does not already carry it. */
function gradeLabel() {
  const g = (GAME && GAME.grade) || '?';
  return /grade/i.test(String(g)) ? String(g) : `Grade ${g}`;
}

/* ── AUDIO MANAGER ──
   Two channels (BGM + SFX) with separate gain nodes so the kid can hear SFX over BGM.
   Init is LAZY — must be triggered by a user gesture (click) to satisfy iOS Safari
   autoplay policy. We call initAudio() on the Start button click.
   Mute state persists in localStorage so kid doesn't have to re-mute each visit.
   NOTE: named `AudioManager` (NOT `Audio`) to avoid shadowing the global HTMLAudioElement
   constructor. We use `new Audio(BGM_FILE)` inside the methods, which must refer to
   the browser's built-in HTMLAudioElement, not this module's IIFE. */
const AudioManager = (() => {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let sfxGain = null;
  let bgmAudioEl = null;
  let muted = false;

  const SFX_FILES = {
    correct: 'assets/sfx/collect1.mp3',
    wrong:   'assets/sfx/hit1.mp3',
    skill:   'assets/sfx/Powerup.mp3',
    boss:    'assets/sfx/boss_growl.mp3',
    win:     'assets/sfx/bonus.mp3',
    lose:    'assets/sfx/fail.mp3'
  };
  const BGM_FILE = 'assets/sfx/bgm_battle.mp3';

  // Hydrate mute preference from localStorage on module load
  try {
    muted = localStorage.getItem('keeva-game-muted') === '1';
  } catch (e) { /* localStorage may be disabled — fall back to unmuted */ }

  function init() {
    if (ctx) return;  // already initialised
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(ctx.destination);

      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.4;   // BGM quieter than SFX
      bgmGain.connect(masterGain);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.7;   // SFX louder so they cut through BGM
      sfxGain.connect(masterGain);

      // iOS Safari creates context in 'suspended' state; resume on first gesture
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      console.warn('AudioContext init failed:', e);
    }
  }

  function playBGM() {
    if (!ctx) return;
    if (bgmAudioEl) return;  // already playing
    bgmAudioEl = new Audio(BGM_FILE);
    bgmAudioEl.loop = true;
    bgmAudioEl.volume = 1;  // gain handled by bgmGain node
    // Route through WebAudio so we can mix with SFX
    const source = ctx.createMediaElementSource(bgmAudioEl);
    source.connect(bgmGain);
    bgmAudioEl.play().catch(e => console.warn('BGM play failed:', e));
  }

  function stopBGM() {
    if (bgmAudioEl) {
      bgmAudioEl.pause();
      bgmAudioEl.currentTime = 0;
      bgmAudioEl = null;
    }
  }

  function playSFX(name) {
    if (!ctx) return;
    const src = SFX_FILES[name];
    if (!src) return;
    const el = new Audio(src);
    const source = ctx.createMediaElementSource(el);
    source.connect(sfxGain);
    el.play().catch(e => console.warn(`SFX ${name} play failed:`, e));
    // Clean up after playback ends
    el.addEventListener('ended', () => {
      source.disconnect();
    }, { once: true });
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 1;
    try { localStorage.setItem('keeva-game-muted', muted ? '1' : '0'); } catch (e) {}
    return muted;
  }

  function isMuted() { return muted; }

  return { init, playBGM, stopBGM, playSFX, toggleMute, isMuted };
})();

/* Difficulty presets — length only (small_per_wave). HP/skill/boss structure unchanged. */
const DIFFICULTY_PRESETS = {
  easy:   { small_per_wave: 3,  totalFights: 20, label: 'Easy',   emoji: '🌱', desc: '20 fights · 5 waves · 5 bosses' },
  normal: { small_per_wave: 5,  totalFights: 30, label: 'Normal', emoji: '⚔️',  desc: '30 fights · 5 waves · 5 bosses' },
  master: { small_per_wave: 9,  totalFights: 50, label: 'Master', emoji: '👑', desc: '50 fights · 5 waves · 5 bosses' }
};
let SELECTED_DIFFICULTY = null;

/* 5 bosses — each has unique name + sprite + theme */
const BOSS_THEMES = [
  { name: 'Forest Beast',    sprite: 'assets/enemies/enemy_boss_forest_beast.png', emoji: '🌳' },
  { name: 'Cave Troll',      sprite: 'assets/enemies/enemy_boss_cave_troll.png',   emoji: '🪨' },
  { name: 'Ice Wyrm',        sprite: 'assets/enemies/enemy_boss_ice_wyrm.png',     emoji: '❄️' },
  { name: 'Dark Knight',     sprite: 'assets/enemies/enemy_boss_dark_knight.png',  emoji: '⚔️' },
  { name: 'Demon King',      sprite: 'assets/enemies/enemy_boss_demon_king.png',   emoji: '👑' }
];

const SMALL_NAMES = ['Slime', 'Bat', 'Goblin', 'Skeleton', 'Wolf', 'Spider', 'Rat', 'Imp', 'Wisp', 'Mimic'];
const SMALL_SPRITES = [
  'assets/enemies/enemy_slime.png', 'assets/enemies/enemy_bat.png',
  'assets/enemies/enemy_goblin.png', 'assets/enemies/enemy_skeleton.png',
  'assets/enemies/enemy_wolf.png', 'assets/enemies/enemy_spider.png',
  'assets/enemies/enemy_rat.png', 'assets/enemies/enemy_imp.png',
  'assets/enemies/enemy_wisp.png', 'assets/enemies/enemy_mimic.png'
];

/* ── INITIALIZATION ── */
async function loadGame() {
  const subtitle = document.getElementById('landing-subtitle');
  const startBtn = document.getElementById('btn-start');
  const errEl = document.getElementById('landing-error');
  const charImg = document.getElementById('character-img');

  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  subtitle.textContent = 'Loading quest…';

  try {
    const res = await fetch('game_data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    GAME = await res.json();

    if (!GAME.questions || GAME.questions.length < 10) {
      throw new Error('Not enough questions in game_data.json');
    }

    // Character portrait mapping
    const charFileMap = {
      'knight': 'keeva_champion.png',
      'warrior': 'keeva_champion.png',
      'champion': 'keeva_champion.png',
      'mage': 'keisha_singer.png',
      'ice_mage': 'keisha_singer.png',
      'singer': 'keisha_singer.png'
    };
    const charKey = GAME.character || 'knight';
    const charFile = `assets/characters/${charFileMap[charKey] || 'keeva_champion.png'}`;
    charImg.src = charFile;
    charImg.onerror = () => { charImg.style.display = 'none'; };

    // Subtitle: total fights count (using Normal preset as default for display until user picks)
    const preset = DIFFICULTY_PRESETS.normal;
    const totalFights = (preset.small_per_wave + 1) * GAME.wave_count;
    subtitle.textContent = `${GAME.subject || 'Quest'} · ${gradeLabel()} · ${GAME.wave_count || 5} waves · 5 bosses`;

    document.querySelector('.game-title').textContent = `⚔️ ${GAME.title}`;

    // Build difficulty selector (3 buttons)
    renderDifficultySelector();

    startBtn.disabled = true;
    startBtn.textContent = '⚔️ Pick a difficulty first';
  } catch (err) {
    console.error('loadGame failed:', err);
    errEl.textContent = `Failed to load: ${err.message}. Please refresh.`;
    errEl.style.display = 'block';
    subtitle.textContent = 'Error loading quest';
    startBtn.textContent = 'Retry';
    startBtn.onclick = loadGame;
  }
}

/* ── DIFFICULTY SELECTOR ── */
function renderDifficultySelector() {
  // Insert container into landing if not already there
  let container = document.getElementById('difficulty-selector');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'difficulty-selector';
  container.className = 'difficulty-selector';

  const heading = document.createElement('p');
  heading.className = 'difficulty-heading';
  heading.textContent = 'Choose your quest length:';
  container.appendChild(heading);

  const btnRow = document.createElement('div');
  btnRow.className = 'difficulty-buttons';
  ['easy', 'normal', 'master'].forEach(key => {
    const preset = DIFFICULTY_PRESETS[key];
    const btn = document.createElement('button');
    btn.className = `btn-difficulty btn-difficulty-${key}`;
    btn.dataset.difficulty = key;
    btn.innerHTML = `
      <span class="diff-emoji">${preset.emoji}</span>
      <span class="diff-label">${preset.label}</span>
      <span class="diff-desc">${preset.desc}</span>
    `;
    btn.onclick = () => selectDifficulty(key);
    btnRow.appendChild(btn);
  });
  container.appendChild(btnRow);

  // Insert before the start button
  const startBtn = document.getElementById('btn-start');
  startBtn.parentNode.insertBefore(container, startBtn);
}

function selectDifficulty(key) {
  if (!DIFFICULTY_PRESETS[key]) return;
  SELECTED_DIFFICULTY = key;

  // Visual: highlight selected
  document.querySelectorAll('.btn-difficulty').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.difficulty === key);
  });

  // Enable start button
  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = false;
  startBtn.textContent = `⚔️ Start ${DIFFICULTY_PRESETS[key].label} Quest`;
  startBtn.onclick = startQuest;
}

/* ── START QUEST ── */
function startQuest() {
  // User gesture (button click) — safe to init audio + start BGM
  AudioManager.init();
  AudioManager.playBGM();

  if (!SELECTED_DIFFICULTY) {
    selectDifficulty('normal');
    return;
  }
  const preset = DIFFICULTY_PRESETS[SELECTED_DIFFICULTY];
  // Override small_per_wave from selected difficulty; keep other config as-is
  const runtimeConfig = { ...GAME.config, small_per_wave: preset.small_per_wave };

  STATE = {
    hero: {
      hp: GAME.config.hero_hp,
      maxHp: GAME.config.hero_hp,
      skill: GAME.config.skill_max,
      maxSkill: GAME.config.skill_max
    },
    wave: 1,             // 1..wave_count
    smallIndex: 0,       // 0..small_per_wave-1 within current wave
    isBoss: false,
    isFinalBoss: false,
    currentEnemy: null,
    currentQuestion: null,
    usedQuestionIds: new Set(),
    correctCount: 0,
    totalAnswered: 0,
    wrongQuestions: [],
    domainStats: {},
    runStartTime: Date.now(),
    difficulty: SELECTED_DIFFICULTY,
    runtimeConfig: runtimeConfig,
    fiftyFiftyApplied: false,   // resets per-fight in renderQuestion
    fiftyFiftyUsedCount: 0      // running tally for end-screen stats
  };

  QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);
  currentBiome = null;
  resetGround();

  showScreen('screen-fight');
  nextFight();
}

/* ── enemy readout: keep the text and the segmented HP bar in sync ── */
function renderEnemyHp() {
  const e = STATE.currentEnemy;
  if (!e) return;
  const txt = document.getElementById('enemy-progress');
  if (txt) txt.textContent = `${e.hp}/${e.maxHp} HP`;
  const fill = document.getElementById('enemy-hp-fill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, e.hp / e.maxHp)) * 100}%`;
}

/* ── BIOME BACKGROUND + GROUND PAN (Journey-style advance) ──
   One biome per wave, matching the boss theme the code already indexes by wave.
   Panning is driven by --pan-far / --pan-near on .battlefield; the strips are
   background-repeat: repeat-x, so a negative position loops to the right forever. */
const BIOMES = ['forest', 'cave', 'ice', 'castle', 'demon'];
let groundStep = 0;
let currentBiome = null;

function applyBiome(wave, animate) {
  const name = BIOMES[Math.min(Math.max(wave, 1) - 1, BIOMES.length - 1)];
  const far = document.getElementById('bg-far');
  const near = document.getElementById('bg-near');
  if (!far || !near) return;
  if (name === currentBiome && !animate) return;
  currentBiome = name;

  const set = () => {
    far.style.backgroundImage = `url('assets/backgrounds/bg_${name}_far.png')`;
    near.style.backgroundImage = `url('assets/backgrounds/bg_${name}_near.png')`;
  };
  if (!animate) { set(); return; }
  far.classList.add('biome-fade');
  near.classList.add('biome-fade');
  setTimeout(() => {
    set();
    far.classList.remove('biome-fade');
    near.classList.remove('biome-fade');
  }, 270);
}

function resetGround() {
  groundStep = 0;
  const bf = document.getElementById('battlefield');
  if (!bf) return;
  bf.style.setProperty('--pan-far', '0px');
  bf.style.setProperty('--pan-near', '0px');
}

/* Each defeated small enemy nudges the world along. The near strip moves ~2x the far strip,
   which is what creates the sense of depth. */
function advanceGround() {
  const bf = document.getElementById('battlefield');
  if (!bf) return;
  groundStep++;
  bf.style.setProperty('--pan-far', `-${groundStep * 92}px`);
  bf.style.setProperty('--pan-near', `-${groundStep * 186}px`);
}

/* ── ENEMY ATTACK FX (one common orb; bosses get a screen-spanning beam) ── */
function spawnEnemyAttackFx(isBoss) {
  const layer = document.getElementById('fx-layer');
  const bf = document.getElementById('battlefield');
  const vig = document.getElementById('damage-vignette');
  if (!layer) return;

  const add = (cls, src, style, delay) => {
    const img = document.createElement('img');
    img.className = 'fx ' + cls;
    img.src = src;
    img.alt = '';
    Object.entries(style || {}).forEach(([k, v]) => img.style.setProperty(k, v));
    if (delay) img.style.animationDelay = delay + 'ms';
    img.addEventListener('animationend', () => img.remove());
    // Fallback: a cancelled animation (e.g. the element's animation class is replaced)
    // never fires animationend, which would leak the node in the layer forever.
    setTimeout(() => img.remove(), 1600);
    layer.appendChild(img);
  };

  if (vig) {
    vig.classList.add('on');
    setTimeout(() => vig.classList.remove('on'), isBoss ? 1050 : 520);
  }

  if (!isBoss) {
    add('fx-enemy-orb', 'assets/effects/fx_enemy_orb.png', { '--fx-size': '56px' });
    return;
  }

  if (bf) {
    bf.classList.add('shake');
    setTimeout(() => bf.classList.remove('shake'), 460);
  }
  add('fx-boss-flare', 'assets/effects/fx_boss_flare.png', { right: '22%', top: '30%', width: '84px' });
  add('fx-boss-beam', 'assets/effects/fx_boss_beam.png', { right: '15%', width: '72%', top: '31%' }, 170);
  add('fx-boss-ring', 'assets/effects/fx_boss_ring.png', { left: '2%', bottom: '2%', width: '42%' }, 330);
}

function heroHitFx() {
  const el = document.getElementById('hero-sprite');
  if (!el) return;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 460);
}

/* ── NEXT FIGHT (small or boss within current wave) ── */
function nextFight() {
  const cfg = STATE.runtimeConfig;
  applyBiome(STATE.wave, false);
  const isLastSmall = STATE.smallIndex === cfg.small_per_wave - 1;
  const isBossTime = isLastSmall; // boss appears after last small in wave
  STATE.isBoss = isBossTime;
  STATE.isFinalBoss = isBossTime && STATE.wave === cfg.wave_count;

  // Pick next question
  STATE.currentQuestion = pickNextQuestion();
  if (!STATE.currentQuestion) {
    QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);
    STATE.usedQuestionIds.clear();
    STATE.currentQuestion = pickNextQuestion();
  }
  STATE.usedQuestionIds.add(STATE.currentQuestion.id);

  // Setup enemy
  if (isBossTime) {
    const themeIndex = Math.min(STATE.wave - 1, BOSS_THEMES.length - 1);
    const theme = BOSS_THEMES[themeIndex];
    STATE.currentEnemy = {
      name: theme.name,
      sprite: theme.sprite,
      hp: cfg.boss_hp,
      maxHp: cfg.boss_hp
    };
    AudioManager.playSFX('boss');
  } else {
    STATE.currentEnemy = {
      name: SMALL_NAMES[Math.floor(Math.random() * SMALL_NAMES.length)],
      sprite: SMALL_SPRITES[Math.floor(Math.random() * SMALL_SPRITES.length)],
      hp: cfg.small_enemy_hp,
      maxHp: cfg.small_enemy_hp
    };
  }

  // Update UI: enemy info
  const isFinal = STATE.isFinalBoss;
  document.getElementById('enemy-name').textContent = STATE.isBoss
    ? `${STATE.currentEnemy.name} (BOSS${isFinal ? ' 👑 FINAL' : ''})`
    : STATE.currentEnemy.name;
  renderEnemyHp();
  document.getElementById('enemy-sprite').src = STATE.currentEnemy.sprite;
  document.getElementById('enemy-sprite').classList.remove('defeated');

  // Wave/floor counter
  document.getElementById('floor-counter').textContent = `Wave ${STATE.wave}/${cfg.wave_count}`;

  // Render question + update HUD
  renderQuestion();
  updateHUD();
}

function pickNextQuestion() {
  for (const q of QUESTION_POOL) {
    if (!STATE.usedQuestionIds.has(q.id)) return q;
  }
  return null;
}

/* ── RENDER QUESTION ── */
function renderQuestion() {
  const q = STATE.currentQuestion;

  document.getElementById('feedback').style.display = 'none';

  // Reset 50/50 state for this fight (kid can re-tap if they used it last fight)
  STATE.fiftyFiftyApplied = false;

  ['A', 'B', 'C', 'D'].forEach(opt => {
    const btn = document.getElementById(`ans-${opt}`);
    btn.disabled = false;
    btn.classList.remove('correct', 'wrong', 'skill-saved', 'fifty-fifty-disabled');
    btn.querySelector('.opt-text').textContent = q.options[opt];
  });

  document.getElementById('question-text').textContent = q.text;
  const imgWrap = document.getElementById('question-image-wrap');
  const imgEl = document.getElementById('question-image');
  if (q.image) {
    imgEl.src = 'assets/questions/' + q.image;
    imgWrap.style.display = 'block';
  } else {
    imgEl.src = '';
    imgWrap.style.display = 'none';
  }
  document.getElementById('question-domain').textContent = domainLabel(q.domain);
  updateHUD();   // re-enable 50/50 button for the new fight
}

/* ── 50/50 SKILL MECHANIC ── */
// Preemptive: kid taps btn-skill-use when stuck. Greys out 2 of 3 wrong options,
// leaves the correct answer + 1 wrong option pickable. Charge consumed on tap.
function applyFiftyFifty() {
  if (!STATE || !STATE.currentQuestion) return;
  if (STATE.fiftyFiftyApplied) return;        // already used this fight
  if (STATE.hero.skill <= 0) return;          // no charge

  const correct = STATE.currentQuestion.answer;  // 'A' | 'B' | 'C' | 'D'
  const wrongOptions = ['A', 'B', 'C', 'D'].filter(o => o !== correct);

  // Randomly pick 2 of the 3 wrong options to disable (ii = random per attempt)
  const shuffled = wrongOptions.sort(() => Math.random() - 0.5);
  const toDisable = shuffled.slice(0, 2);

  toDisable.forEach(opt => {
    const btn = document.getElementById(`ans-${opt}`);
    if (btn) {
      btn.classList.add('fifty-fifty-disabled');
      btn.disabled = true;
    }
  });

  // Consume charge + lock the per-fight flag + tally
  STATE.hero.skill--;
  STATE.fiftyFiftyApplied = true;
  STATE.fiftyFiftyUsedCount++;
  AudioManager.playSFX('skill');
  showFeedback('✨ 50/50 — 2 wrong answers removed!', 'skill-saved');
  updateHUD();
}

/* ── ATTACK FX: Keeva's fire kick ── */
const FX_FIRE = [
  'assets/effects/fx_flame.png', 'assets/effects/fx_flame_hot.png',
  'assets/effects/fx_flame.png', 'assets/effects/fx_spark.png'
];

function spawnAttackFx() {
  const layer = document.getElementById('fx-layer');
  if (!layer) return;
  for (let i = 0; i < 6; i++) {
    const img = document.createElement('img');
    img.className = 'fx fx-flame';
    img.src = FX_FIRE[i % FX_FIRE.length];
    img.alt = '';
    img.style.setProperty('--fx-size', (24 + Math.random() * 22).toFixed(0) + 'px');
    img.style.left = (28 + Math.random() * 5).toFixed(1) + '%';
    img.style.top = (46 + Math.random() * 24).toFixed(1) + '%';
    img.style.animationDelay = (i * 55) + 'ms';
    img.addEventListener('animationend', () => img.remove());
    // Fallback: a cancelled animation (e.g. the element's animation class is replaced)
    // never fires animationend, which would leak the node in the layer forever.
    setTimeout(() => img.remove(), 1600);
    layer.appendChild(img);
  }
  const burst = document.createElement('img');
  burst.className = 'fx fx-burst';
  burst.src = 'assets/effects/fx_blast.png';
  burst.alt = '';
  burst.style.animationDelay = '270ms';
  burst.addEventListener('animationend', () => burst.remove());
  setTimeout(() => burst.remove(), 1600);
  layer.appendChild(burst);
}

/* ── HANDLE ANSWER ── */
function handleAnswer(chosen) {
  const q = STATE.currentQuestion;
  const correct = chosen === q.answer;

  ['A', 'B', 'C', 'D'].forEach(opt => {
    document.getElementById(`ans-${opt}`).disabled = true;
  });

  STATE.totalAnswered++;

  if (correct) {
    const ansBtn = document.getElementById(`ans-${chosen}`);
    ansBtn.classList.add('correct');
    STATE.currentEnemy.hp--;
    STATE.correctCount++;
    trackDomain(q.domain, true);
    playFloatText(`-1`, 'enemy');
    showFeedback(`✅ Correct! ${q.options[q.answer]}`, 'correct');
    AudioManager.playSFX('correct');
    document.getElementById('hero-sprite').classList.add('attack');
    setTimeout(() => document.getElementById('hero-sprite').classList.remove('attack'), 400);
    spawnAttackFx();
    document.getElementById('enemy-sprite').classList.add('hit');
    setTimeout(() => document.getElementById('enemy-sprite').classList.remove('hit'), 400);
  } else {
    // v1 reactive skill-absorb removed (2026-06-06, v2 skill design).
    // Skill is now preemptive 50/50 — consumed on tap in applyFiftyFifty(),
    // NOT on wrong answer. So a wrong pick always costs 1 HP (no freebies).
    STATE.hero.hp--;
    const ansBtn = document.getElementById(`ans-${chosen}`);
    ansBtn.classList.add('wrong');
    STATE.wrongQuestions.push({ q, chosen });
    trackDomain(q.domain, false);
    playFloatText(`-1`, 'hero');
    showFeedback(`❌ Wrong! Correct: ${q.options[q.answer]}`, 'wrong');
    AudioManager.playSFX('wrong');
    spawnEnemyAttackFx(STATE.isBoss);
    heroHitFx();
  }

  setTimeout(() => {
    if (STATE.currentEnemy.hp <= 0) {
      onEnemyDefeated();
    } else if (STATE.hero.hp <= 0) {
      onHeroDefeated();
    } else {
      // Same enemy, next question
      STATE.currentQuestion = pickNextQuestion();
      if (!STATE.currentQuestion) {
        QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);
        STATE.usedQuestionIds.clear();
        STATE.currentQuestion = pickNextQuestion();
      }
      STATE.usedQuestionIds.add(STATE.currentQuestion.id);
      renderEnemyHp();
      updateHUD();
      renderQuestion();
    }
  }, 1800);
}

function trackDomain(domain, correct) {
  if (!STATE.domainStats[domain]) {
    STATE.domainStats[domain] = { correct: 0, total: 0 };
  }
  STATE.domainStats[domain].total++;
  if (correct) STATE.domainStats[domain].correct++;
}

/* ── FLOAT TEXT ANIMATION ── */
function playFloatText(text, target) {
  const floater = document.getElementById('damage-floater');
  floater.textContent = text;
  floater.style.color = target === 'enemy' ? '#fbbf24' : '#ef4444';
  floater.classList.remove('show');
  void floater.offsetWidth;
  floater.classList.add('show');
}

function showFeedback(msg, type) {
  const fb = document.getElementById('feedback');
  fb.textContent = msg;
  fb.className = `feedback ${type}`;
  fb.style.display = 'block';
}

/* ── ENEMY DEFEATED ── */
function onEnemyDefeated() {
  const enemy = document.getElementById('enemy-sprite');
  enemy.classList.add('defeated');

  setTimeout(() => {
    if (STATE.isBoss) {
      // Boss defeated — rest node (or victory if final)
      if (STATE.isFinalBoss) {
        showVictory();
      } else {
        showRest();
      }
    } else {
      // Small defeated — advance to next small in same wave
      STATE.smallIndex++;
      advanceGround();
      nextFight();
    }
  }, 700);
}

/* ── HERO DEFEATED (LOSE) ── */
function onHeroDefeated() {
  showLose();
}

/* ── REST NODE (after non-final boss) ── */
function showRest() {
  showScreen('screen-rest');
  // Update rest flavor
  document.querySelector('.rest-flavor').textContent =
    `You defeated ${STATE.currentEnemy.name}! Wave ${STATE.wave} of ${STATE.runtimeConfig.wave_count} complete. Take a moment to recover.`;

  document.getElementById('btn-heal').onclick = () => {
    STATE.hero.hp = Math.min(STATE.hero.hp + 2, STATE.hero.maxHp);
    proceedAfterRest();
  };
  document.getElementById('btn-skill').onclick = () => {
    STATE.hero.skill = STATE.hero.maxSkill;
    proceedAfterRest();
  };
  document.getElementById('btn-skip-rest').onclick = proceedAfterRest;
}

function proceedAfterRest() {
  // Advance to next wave
  STATE.wave++;
  STATE.smallIndex = 0;
  STATE.isBoss = false;
  STATE.isFinalBoss = false;
  STATE.currentEnemy = null;
  resetGround();
  applyBiome(STATE.wave, true);
  showScreen('screen-fight');
  nextFight();
}

/* ── VICTORY ── */
function showVictory() {
  showScreen('screen-victory');
  AudioManager.stopBGM();
  AudioManager.playSFX('win');
  const preset = DIFFICULTY_PRESETS[STATE.difficulty];
  document.querySelector('#screen-victory .end-flavor').textContent =
    `You defeated the ${BOSS_THEMES[STATE.wave - 1].name}! All ${STATE.runtimeConfig.wave_count} waves complete on ${preset.label} mode!`;
  const stats = computeRunStats();
  document.getElementById('end-stats').innerHTML = stats;
}

function showLose() {
  showScreen('screen-lose');
  AudioManager.stopBGM();
  AudioManager.playSFX('lose');
  const stats = computeRunStats();
  document.getElementById('lose-stats').innerHTML = stats;

  const reviewList = document.getElementById('review-list');
  if (STATE.wrongQuestions.length === 0) {
    reviewList.innerHTML = '<p style="text-align:center;opacity:0.7">No wrong questions to review 🎉</p>';
  } else {
    reviewList.innerHTML = STATE.wrongQuestions.map(({ q, chosen }) => `
      <div class="review-item">
        <div class="q-text">Q${q.id} [${q.domain}]: ${q.text}</div>
        <div class="a-text">Your answer: ${q.options[chosen]} (${chosen})</div>
        <div class="a-text">Correct: ${q.options[q.answer]} (${q.answer})</div>
      </div>
    `).join('');
  }
}

/* ── STATS ── */
function computeRunStats() {
  const totalTime = Math.floor((Date.now() - STATE.runStartTime) / 1000);
  const mins = Math.floor(totalTime / 60);
  const secs = totalTime % 60;
  const accuracy = STATE.totalAnswered > 0
    ? Math.round((STATE.correctCount / STATE.totalAnswered) * 100)
    : 0;

  let domainLines = '';
  const entries = Object.entries(STATE.domainStats);
  if (entries.length > 0) {
    entries.sort((a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total);
    const strongest = entries[0];
    const weakest = entries[entries.length - 1];
    domainLines = `
      <p><span>Strongest:</span><strong>${domainLabel(strongest[0])} (${strongest[1].correct}/${strongest[1].total})</strong></p>
      <p><span>Weakest:</span><strong>${domainLabel(weakest[0])} (${weakest[1].correct}/${weakest[1].total})</strong></p>
    `;
  }

  return `
    <p><span>Waves completed:</span><strong>${STATE.wave}/${STATE.runtimeConfig.wave_count}</strong></p>
    <p><span>Difficulty:</span><strong>${DIFFICULTY_PRESETS[STATE.difficulty].label} (${DIFFICULTY_PRESETS[STATE.difficulty].totalFights} fights)</strong></p>
    <p><span>Accuracy:</span><strong>${accuracy}%</strong></p>
    <p><span>Questions answered:</span><strong>${STATE.totalAnswered}</strong></p>
    <p><span>Time:</span><strong>${mins}m ${secs}s</strong></p>
    <p><span>Final HP:</span><strong>${STATE.hero.hp}/${STATE.hero.maxHp}</strong></p>
    <p><span>50/50 used:</span><strong>${STATE.fiftyFiftyUsedCount} time${STATE.fiftyFiftyUsedCount === 1 ? '' : 's'}</strong></p>
    <p><span>Strategy:</span><strong>${STATE.fiftyFiftyUsedCount === 0 ? '🎯 No hints needed!' : 'Used 50/50 ' + STATE.fiftyFiftyUsedCount + ' time' + (STATE.fiftyFiftyUsedCount === 1 ? '' : 's')}</strong></p>
    ${domainLines}
  `;
}

/* ── HUD UPDATE ── */
function updateHUD() {
  const hearts = document.getElementById('hp-hearts');
  hearts.innerHTML = '';
  for (let i = 0; i < STATE.hero.maxHp; i++) {
    const span = document.createElement('span');
    span.textContent = i < STATE.hero.hp ? '❤️' : '🖤';
    span.className = i < STATE.hero.hp ? 'hp-heart-full' : 'hp-heart-empty';
    hearts.appendChild(span);
  }

  // 50/50 skill button — enabled only when skill>0 AND not already applied this fight
  const skillBtn = document.getElementById('btn-skill-use');
  const skillStatus = document.getElementById('btn-skill-use-status');
  if (skillBtn) {
    const canUse = STATE.hero.skill > 0 && !STATE.fiftyFiftyApplied;
    skillBtn.disabled = !canUse;
    if (!STATE.hero.skill) {
      skillStatus.textContent = 'Empty';
    } else if (STATE.fiftyFiftyApplied) {
      skillStatus.textContent = 'Used';
    } else {
      skillStatus.textContent = 'Ready';
    }
  }
}

/* ── SCREEN SWITCHING ── */
function showScreen(id) {
  ['screen-landing', 'screen-fight', 'screen-rest', 'screen-victory', 'screen-lose'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
}

/* ── BOOT ── */
function wireAnswerButtons() {
  ['A', 'B', 'C', 'D'].forEach(opt => {
    const btn = document.getElementById(`ans-${opt}`);
    if (btn && !btn.dataset.wired) {
      btn.addEventListener('click', () => handleAnswer(opt));
      btn.dataset.wired = 'true';
    }
  });
}

function wireMuteButton() {
  const btn = document.getElementById('btn-mute');
  if (!btn || btn.dataset.wired) return;
  // Sync initial visual state with stored preference
  btn.textContent = AudioManager.isMuted() ? '🔇' : '🔊';
  btn.addEventListener('click', () => {
    const nowMuted = AudioManager.toggleMute();
    btn.textContent = nowMuted ? '🔇' : '🔊';
  });
  btn.dataset.wired = 'true';
}

function wireSkillButton() {
  const btn = document.getElementById('btn-skill-use');
  if (!btn || btn.dataset.wired) return;
  btn.addEventListener('click', applyFiftyFifty);
  btn.dataset.wired = 'true';
}

window.addEventListener('DOMContentLoaded', () => {
  wireAnswerButtons();
  wireMuteButton();
  wireSkillButton();
  loadGame();
});
