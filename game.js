/* ── game.js ── Quiz Game Mode state machine + fight loop (5-wave multi-boss) */

let GAME = null;
let STATE = null;
let QUESTION_POOL = [];

/* 5 bosses — each has unique name + sprite + theme */
const BOSS_THEMES = [
  { name: 'Forest Beast',    sprite: 'assets/enemies/enemy_goblin.svg',     emoji: '🌳' },
  { name: 'Cave Troll',      sprite: 'assets/enemies/enemy_skeleton.svg',   emoji: '🪨' },
  { name: 'Ice Wyrm',        sprite: 'assets/enemies/enemy_dragon_boss.svg', emoji: '❄️' },
  { name: 'Dark Knight',     sprite: 'assets/enemies/enemy_dragon_boss.svg', emoji: '⚔️' },
  { name: 'Demon King',      sprite: 'assets/enemies/enemy_dragon_boss.svg', emoji: '👑' }
];

const SMALL_NAMES = ['Slime', 'Bat', 'Goblin', 'Skeleton', 'Wolf', 'Spider', 'Rat', 'Imp', 'Wisp', 'Mimic'];
const SMALL_SPRITES = ['assets/enemies/enemy_goblin.svg', 'assets/enemies/enemy_skeleton.svg', 'assets/enemies/enemy_slime.svg', 'assets/enemies/enemy_bat.svg'];

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
      'knight': 'keeva_warrior.svg',
      'warrior': 'keeva_warrior.svg',
      'mage': 'keisha_ice_mage.svg',
      'ice_mage': 'keisha_ice_mage.svg'
    };
    const charKey = GAME.character || 'knight';
    const charFile = `assets/characters/${charFileMap[charKey] || 'keeva_warrior.svg'}`;
    charImg.src = charFile;
    charImg.onerror = () => { charImg.style.display = 'none'; };

    // Subtitle: total fights count
    const totalFights = (GAME.config.small_per_wave + GAME.config.boss_per_wave) * GAME.config.wave_count;
    subtitle.textContent = `${GAME.subject || 'Quest'} · Grade ${GAME.grade || '?'} · ${GAME.wave_count || 5} waves · ${totalFights} fights`;

    document.querySelector('.game-title').textContent = `⚔️ ${GAME.title}`;

    startBtn.disabled = false;
    startBtn.textContent = '⚔️ Start Quest';
    startBtn.onclick = startQuest;

  } catch (err) {
    console.error('loadGame failed:', err);
    errEl.textContent = `Failed to load: ${err.message}. Please refresh.`;
    errEl.style.display = 'block';
    subtitle.textContent = 'Error loading quest';
    startBtn.textContent = 'Retry';
    startBtn.onclick = loadGame;
  }
}

/* ── START QUEST ── */
function startQuest() {
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
    runStartTime: Date.now()
  };

  QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);

  showScreen('screen-fight');
  nextFight();
}

/* ── NEXT FIGHT (small or boss within current wave) ── */
function nextFight() {
  const cfg = GAME.config;
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
  document.getElementById('enemy-progress').textContent = `${STATE.currentEnemy.hp}/${STATE.currentEnemy.maxHp} HP`;
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

  ['A', 'B', 'C', 'D'].forEach(opt => {
    const btn = document.getElementById(`ans-${opt}`);
    btn.disabled = false;
    btn.classList.remove('correct', 'wrong', 'skill-saved');
    btn.querySelector('.opt-text').textContent = q.options[opt];
  });

  document.getElementById('question-text').textContent = q.text;
  document.getElementById('question-domain').textContent = q.domain || 'general';
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
    document.getElementById('hero-sprite').classList.add('attack');
    setTimeout(() => document.getElementById('hero-sprite').classList.remove('attack'), 400);
    document.getElementById('enemy-sprite').classList.add('hit');
    setTimeout(() => document.getElementById('enemy-sprite').classList.remove('hit'), 400);
  } else {
    const ansBtn = document.getElementById(`ans-${chosen}`);
    if (STATE.hero.skill > 0) {
      STATE.hero.skill--;
      ansBtn.classList.add('skill-saved');
      trackDomain(q.domain, false);
      showFeedback(`✨ Skill saved you! Correct: ${q.options[q.answer]}`, 'skill-saved');
    } else {
      STATE.hero.hp--;
      ansBtn.classList.add('wrong');
      STATE.wrongQuestions.push({ q, chosen });
      trackDomain(q.domain, false);
      playFloatText(`-1`, 'hero');
      showFeedback(`❌ Wrong! Correct: ${q.options[q.answer]}`, 'wrong');
    }
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
      document.getElementById('enemy-progress').textContent = `${STATE.currentEnemy.hp}/${STATE.currentEnemy.maxHp} HP`;
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
    `You defeated ${STATE.currentEnemy.name}! Wave ${STATE.wave} of ${GAME.config.wave_count} complete. Take a moment to recover.`;

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
  showScreen('screen-fight');
  nextFight();
}

/* ── VICTORY ── */
function showVictory() {
  showScreen('screen-victory');
  document.querySelector('#screen-victory .end-flavor').textContent =
    `You defeated the ${BOSS_THEMES[STATE.wave - 1].name}! All ${GAME.config.wave_count} waves complete!`;
  const stats = computeRunStats();
  document.getElementById('end-stats').innerHTML = stats;
}

function showLose() {
  showScreen('screen-lose');
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
      <p><span>Strongest:</span><strong>${strongest[0]} (${strongest[1].correct}/${strongest[1].total})</strong></p>
      <p><span>Weakest:</span><strong>${weakest[0]} (${weakest[1].correct}/${weakest[1].total})</strong></p>
    `;
  }

  return `
    <p><span>Waves completed:</span><strong>${STATE.wave}/${GAME.config.wave_count}</strong></p>
    <p><span>Accuracy:</span><strong>${accuracy}%</strong></p>
    <p><span>Questions answered:</span><strong>${STATE.totalAnswered}</strong></p>
    <p><span>Time:</span><strong>${mins}m ${secs}s</strong></p>
    <p><span>Final HP:</span><strong>${STATE.hero.hp}/${STATE.hero.maxHp}</strong></p>
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

  const skillSlot = document.getElementById('skill-slot');
  if (STATE.hero.skill > 0) {
    skillSlot.innerHTML = `<span class="skill-active">✨ Ready</span>`;
  } else {
    skillSlot.textContent = 'Empty';
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

window.addEventListener('DOMContentLoaded', () => {
  wireAnswerButtons();
  loadGame();
});
