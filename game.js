/* ── game.js ── Quiz Game Mode state machine + fight loop */

let GAME = null;       // game_data.json contents
let STATE = null;      // runtime state
let QUESTION_POOL = []; // shuffled subset for current run

const ENEMY_NAMES = {
  small: ['Slime', 'Bat', 'Goblin', 'Skeleton', 'Wolf', 'Spider', 'Rat', 'Imp'],
  boss: ['Dragon', 'Demon King', 'Dark Wizard', 'Lich Lord']
};

const ENEMY_SPRITES = {
  small: ['assets/enemies/enemy_goblin.svg', 'assets/enemies/enemy_skeleton.svg'],
  boss: ['assets/enemies/enemy_dragon_boss.svg']
};

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

    // Validate
    if (!GAME.questions || GAME.questions.length < 10) {
      throw new Error('Not enough questions in game_data.json');
    }

    // Show character portrait
    // Map character id → file name
    const charFileMap = {
      'knight': 'keeva_warrior.svg',
      'warrior': 'keeva_warrior.svg',
      'mage': 'keisha_ice_mage.svg',
      'ice_mage': 'keisha_ice_mage.svg'
    };
    const charKey = GAME.character || 'knight';
    const charFile = `assets/characters/${charFileMap[charKey] || 'keeva_warrior.svg'}`;
    charImg.src = charFile;
    charImg.onerror = () => {
      charImg.style.display = 'none';
    };

    // Update subtitle
    subtitle.textContent = `${GAME.subject || 'Quest'} · Grade ${GAME.grade || '?'} · ${GAME.questions.length} questions`;

    // Update title
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
  // Initialize state
  STATE = {
    hero: {
      hp: GAME.config.hero_hp,
      maxHp: GAME.config.hero_hp,
      skill: GAME.config.skill_max,
      maxSkill: GAME.config.skill_max
    },
    floor: 1,             // 1..small_count+boss_count (6 total in v1)
    isBoss: false,
    currentEnemy: null,
    currentQuestion: null,
    usedQuestionIds: new Set(),
    correctCount: 0,
    totalAnswered: 0,
    wrongQuestions: [],
    domainStats: {},
    runStartTime: Date.now()
  };

  // Shuffle question pool, mark all as unused
  QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);

  showScreen('screen-fight');
  nextFight();
}

/* ── NEXT FIGHT (small or boss) ── */
function nextFight() {
  const isFinal = STATE.floor === GAME.config.small_count + GAME.config.boss_count;
  const isBoss = isFinal; // in v1, only 1 boss at the end
  STATE.isBoss = isBoss;

  // Pick next question
  STATE.currentQuestion = pickNextQuestion();
  if (!STATE.currentQuestion) {
    // Pool exhausted, reshuffle
    QUESTION_POOL = [...GAME.questions].sort(() => Math.random() - 0.5);
    STATE.usedQuestionIds.clear();
    STATE.currentQuestion = pickNextQuestion();
  }
  STATE.usedQuestionIds.add(STATE.currentQuestion.id);

  // Setup enemy
  const enemyNamePool = isBoss ? ENEMY_NAMES.boss : ENEMY_NAMES.small;
  const enemySpritePool = isBoss ? ENEMY_SPRITES.boss : ENEMY_SPRITES.small;
  const enemyHp = isBoss ? GAME.config.boss_hp : GAME.config.small_enemy_hp;

  STATE.currentEnemy = {
    name: enemyNamePool[Math.floor(Math.random() * enemyNamePool.length)],
    sprite: enemySpritePool[Math.floor(Math.random() * enemySpritePool.length)],
    hp: enemyHp,
    maxHp: enemyHp
  };

  // Update UI
  document.getElementById('enemy-name').textContent = `${isBoss ? '🐉 ' : '👹 '}${STATE.currentEnemy.name}${isBoss ? ' (BOSS)' : ''}`;
  document.getElementById('enemy-progress').textContent = `${STATE.currentEnemy.hp}/${STATE.currentEnemy.maxHp} HP`;
  document.getElementById('enemy-sprite').src = STATE.currentEnemy.sprite;
  document.getElementById('enemy-sprite').classList.remove('defeated');

  // Floor counter
  const totalFloors = GAME.config.small_count + GAME.config.boss_count;  // 5 + 1 = 6
  document.getElementById('floor-counter').textContent = `Floor ${STATE.floor}/${totalFloors}`;

  // Render question
  renderQuestion();

  // Update HUD
  updateHUD();
}

function pickNextQuestion() {
  // Find first unused question
  for (const q of QUESTION_POOL) {
    if (!STATE.usedQuestionIds.has(q.id)) return q;
  }
  return null;
}

/* ── RENDER QUESTION ── */
function renderQuestion() {
  const q = STATE.currentQuestion;

  // Hide feedback from previous question
  document.getElementById('feedback').style.display = 'none';

  // Reset all answer buttons
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
  const ansBtn = document.getElementById(`ans-${chosen}`);
  const fb = document.getElementById('feedback');

  // Disable all answer buttons during feedback
  ['A', 'B', 'C', 'D'].forEach(opt => {
    document.getElementById(`ans-${opt}`).disabled = true;
  });

  STATE.totalAnswered++;

  if (correct) {
    // CORRECT: damage enemy
    ansBtn.classList.add('correct');
    STATE.currentEnemy.hp--;
    STATE.correctCount++;
    STATE.hero.skill = Math.min(STATE.hero.skill + 1, STATE.hero.maxSkill); // restore 1 skill on correct (optional, comment out if not)
    trackDomain(q.domain, true);
    playFloatText(`-1`, 'enemy');
    showFeedback(`✅ Correct! ${q.options[q.answer]}`, 'correct');
    // Animation: hero attacks
    document.getElementById('hero-sprite').classList.add('attack');
    setTimeout(() => document.getElementById('hero-sprite').classList.remove('attack'), 400);
    // Enemy hit
    document.getElementById('enemy-sprite').classList.add('hit');
    setTimeout(() => document.getElementById('enemy-sprite').classList.remove('hit'), 400);
  } else {
    // WRONG: check skill
    if (STATE.hero.skill > 0) {
      // SKILL SAVES
      STATE.hero.skill--;
      ansBtn.classList.add('skill-saved');
      trackDomain(q.domain, false);
      showFeedback(`✨ Skill saved you! Correct: ${q.options[q.answer]}`, 'skill-saved');
    } else {
      // NO SKILL: hero takes damage
      STATE.hero.hp--;
      ansBtn.classList.add('wrong');
      STATE.wrongQuestions.push({ q, chosen });
      trackDomain(q.domain, false);
      playFloatText(`-1`, 'hero');
      showFeedback(`❌ Wrong! Correct: ${q.options[q.answer]}`, 'wrong');
    }
  }

  // After delay, advance
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
      // Re-render same fight (enemy still has HP)
      // Update enemy progress
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
  // Force reflow to restart animation
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
  // Defeat animation
  const enemy = document.getElementById('enemy-sprite');
  enemy.classList.add('defeated');

  setTimeout(() => {
    if (STATE.isBoss) {
      // WIN
      showVictory();
    } else {
      // Next floor
      STATE.floor++;
      nextFight();
    }
  }, 700);
}

/* ── HERO DEFEATED (LOSE) ── */
function onHeroDefeated() {
  showLose();
}

/* ── REST NODE (after boss) ── */
function showRest() {
  showScreen('screen-rest');
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
  // In v1: only 1 boss, so no "next wave" after rest — game ends after boss.
  // Rest node is reserved for v2 (multi-wave).
  // For v1, treat rest as immediate end.
  showVictory();
}

/* ── VICTORY ── */
function showVictory() {
  showScreen('screen-victory');
  const stats = computeRunStats();
  document.getElementById('end-stats').innerHTML = stats;
}

function showLose() {
  showScreen('screen-lose');
  const stats = computeRunStats();
  document.getElementById('lose-stats').innerHTML = stats;

  // Build review list
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
    <p><span>Accuracy:</span><strong>${accuracy}%</strong></p>
    <p><span>Questions answered:</span><strong>${STATE.totalAnswered}</strong></p>
    <p><span>Time:</span><strong>${mins}m ${secs}s</strong></p>
    <p><span>Final HP:</span><strong>${STATE.hero.hp}/${STATE.hero.maxHp}</strong></p>
    ${domainLines}
  `;
}

/* ── HUD UPDATE ── */
function updateHUD() {
  // HP hearts
  const hearts = document.getElementById('hp-hearts');
  hearts.innerHTML = '';
  for (let i = 0; i < STATE.hero.maxHp; i++) {
    const span = document.createElement('span');
    span.textContent = i < STATE.hero.hp ? '❤️' : '🖤';
    span.className = i < STATE.hero.hp ? 'hp-heart-full' : 'hp-heart-empty';
    hearts.appendChild(span);
  }

  // Skill
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
window.addEventListener('DOMContentLoaded', loadGame);
