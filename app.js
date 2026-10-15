/* 潮息 Tide Breath */
(function () {
  "use strict";

  const MODES = {
    calm: {
      name: "平静",
      phases: [
        { key: "inhale", label: "吸气", seconds: 4, scaleFrom: 0.72, scaleTo: 1 },
        { key: "exhale", label: "呼气", seconds: 4, scaleFrom: 1, scaleTo: 0.72 },
      ],
      hint: "均匀吸气与呼气，找回此刻的平静",
    },
    box: {
      name: "方盒",
      phases: [
        { key: "inhale", label: "吸气", seconds: 4, scaleFrom: 0.72, scaleTo: 1 },
        { key: "hold", label: "屏息", seconds: 4, scaleFrom: 1, scaleTo: 1 },
        { key: "exhale", label: "呼气", seconds: 4, scaleFrom: 1, scaleTo: 0.72 },
        { key: "hold", label: "屏息", seconds: 4, scaleFrom: 0.72, scaleTo: 0.72 },
      ],
      hint: "方盒呼吸：吸 · 屏 · 呼 · 屏，稳定心绪",
    },
    sleep: {
      name: "安眠",
      phases: [
        { key: "inhale", label: "吸气", seconds: 4, scaleFrom: 0.72, scaleTo: 1 },
        { key: "hold", label: "屏息", seconds: 7, scaleFrom: 1, scaleTo: 1 },
        { key: "exhale", label: "呼气", seconds: 8, scaleFrom: 1, scaleTo: 0.72 },
      ],
      hint: "4-7-8 安眠节律，呼气更长，身体慢慢松开",
    },
  };

  const STORAGE_KEY = "tide-breath-stats-v1";
  const SOUND_KEY = "tide-breath-sound";

  const els = {
    tideWrap: document.getElementById("tideWrap"),
    phaseText: document.getElementById("phaseText"),
    countText: document.getElementById("countText"),
    hintText: document.getElementById("hintText"),
    progressText: document.getElementById("progressText"),
    todayPill: document.getElementById("todayPill"),
    cyclesSelect: document.getElementById("cyclesSelect"),
    btnToggle: document.getElementById("btnToggle"),
    btnReset: document.getElementById("btnReset"),
    btnSound: document.getElementById("btnSound"),
    modeBtns: Array.from(document.querySelectorAll(".mode-btn")),
    ripple: document.getElementById("ripple"),
  };

  const state = {
    mode: "calm",
    running: false,
    paused: false,
    phaseIndex: 0,
    cycle: 0, // completed cycles in this session (0-based current)
    totalCycles: 4, // 0 = unlimited
    phaseStart: 0,
    phaseDuration: 0,
    pauseAccum: 0,
    pauseStarted: 0,
    raf: null,
    soundOn: false,
    audioCtx: null,
    todayRounds: 0,
    todayDate: "",
  };

  /* —— storage —— */
  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      const t = todayStr();
      if (data.date === t) {
        state.todayDate = t;
        state.todayRounds = Number(data.rounds) || 0;
      } else {
        state.todayDate = t;
        state.todayRounds = 0;
        saveStats();
      }
    } catch (e) {
      state.todayDate = todayStr();
      state.todayRounds = 0;
    }
    updateTodayPill();
  }

  function saveStats() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ date: state.todayDate || todayStr(), rounds: state.todayRounds })
      );
    } catch (e) { /* ignore */ }
  }

  function bumpTodayRound() {
    if (state.todayDate !== todayStr()) {
      state.todayDate = todayStr();
      state.todayRounds = 0;
    }
    state.todayRounds += 1;
    saveStats();
    updateTodayPill();
  }

  function updateTodayPill() {
    els.todayPill.textContent = "今日 " + state.todayRounds + " 轮";
  }

  /* —— sound —— */
  function loadSoundPref() {
    try {
      state.soundOn = localStorage.getItem(SOUND_KEY) === "1";
    } catch (e) {
      state.soundOn = false;
    }
    syncSoundUI();
  }

  function syncSoundUI() {
    els.btnSound.setAttribute("aria-pressed", state.soundOn ? "true" : "false");
    els.btnSound.setAttribute("aria-label", state.soundOn ? "提示音开" : "提示音关");
    els.btnSound.title = state.soundOn ? "提示音：开（点击关闭）" : "提示音：关（点击开启）";
    const on = els.btnSound.querySelector(".ico-sound-on");
    const off = els.btnSound.querySelector(".ico-sound-off");
    if (on && off) {
      on.hidden = !state.soundOn;
      off.hidden = state.soundOn;
    }
  }

  function ensureAudio() {
    if (!state.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      state.audioCtx = new AC();
    }
    if (state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(function () {});
    }
    return state.audioCtx;
  }

  function playTone(kind) {
    if (!state.soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    // soft sine chimes — inhale higher, exhale lower, hold mid, done soft sand
    let freq = 392;
    let dur = 0.22;
    let peak = 0.045;
    if (kind === "inhale") {
      freq = 523.25;
      peak = 0.04;
    } else if (kind === "exhale") {
      freq = 329.63;
      peak = 0.038;
    } else if (kind === "hold") {
      freq = 440;
      peak = 0.028;
      dur = 0.16;
    } else if (kind === "done") {
      freq = 349.23;
      peak = 0.05;
      dur = 0.45;
    }

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    if (kind === "done") {
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + dur * 0.6);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /* —— ripple particles (subtle) —— */
  const particles = [];
  let rippleW = 0;
  let rippleH = 0;
  let rippleCtx = null;

  function resizeRipple() {
    const c = els.ripple;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    rippleW = window.innerWidth;
    rippleH = window.innerHeight;
    c.width = Math.floor(rippleW * dpr);
    c.height = Math.floor(rippleH * dpr);
    c.style.width = rippleW + "px";
    c.style.height = rippleH + "px";
    rippleCtx = c.getContext("2d");
    if (rippleCtx) rippleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function initParticles() {
    particles.length = 0;
    const n = Math.min(28, Math.floor((rippleW * rippleH) / 45000) + 12);
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * rippleW,
        y: Math.random() * rippleH,
        r: 0.6 + Math.random() * 1.6,
        a: 0.08 + Math.random() * 0.18,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.05 - Math.random() * 0.12,
        gold: Math.random() < 0.18,
      });
    }
  }

  function drawParticles(t) {
    if (!rippleCtx) return;
    rippleCtx.clearRect(0, 0, rippleW, rippleH);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -4) {
        p.y = rippleH + 4;
        p.x = Math.random() * rippleW;
      }
      if (p.x < -4) p.x = rippleW + 4;
      if (p.x > rippleW + 4) p.x = -4;

      const pulse = 0.75 + 0.25 * Math.sin(t * 0.001 + i);
      rippleCtx.beginPath();
      rippleCtx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
      if (p.gold) {
        rippleCtx.fillStyle = "rgba(196, 165, 116," + (p.a * pulse) + ")";
      } else {
        rippleCtx.fillStyle = "rgba(180, 210, 214," + (p.a * pulse) + ")";
      }
      rippleCtx.fill();
    }
  }

  /* —— breathing engine —— */
  function getMode() {
    return MODES[state.mode] || MODES.calm;
  }

  function setScale(scale, glow) {
    els.tideWrap.style.setProperty("--scale", String(scale));
    if (glow != null) {
      els.tideWrap.style.setProperty("--glow", String(glow));
    }
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function updateProgressUI() {
    const total = state.totalCycles;
    if (!state.running && state.cycle === 0 && state.phaseIndex === 0 && !state.paused) {
      els.progressText.textContent = "未开始";
      return;
    }
    const cur = state.cycle + 1;
    if (total === 0) {
      els.progressText.textContent = "第 " + cur + " 轮 · 不限";
    } else {
      els.progressText.textContent = cur + " / " + total + " 轮";
    }
  }

  function enterPhase(index, playSound) {
    const mode = getMode();
    const phase = mode.phases[index];
    state.phaseIndex = index;
    state.phaseDuration = phase.seconds * 1000;
    state.phaseStart = performance.now();
    state.pauseAccum = 0;
    els.phaseText.textContent = phase.label;
    els.countText.textContent = String(phase.seconds);
    setScale(phase.scaleFrom, phase.key === "inhale" ? 0.55 : phase.key === "exhale" ? 0.28 : 0.42);
    updateProgressUI();
    if (playSound) playTone(phase.key);
  }

  function finishSession() {
    state.running = false;
    state.paused = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    els.cyclesSelect.disabled = false;
    els.modeBtns.forEach(function (b) {
      b.disabled = false;
    });
    els.phaseText.textContent = "完成";
    els.countText.textContent = "✓";
    els.hintText.textContent = "这一潮过去了。今日已记 " + state.todayRounds + " 轮";
    els.btnToggle.textContent = "再来";
    els.btnToggle.setAttribute("aria-label", "再来");
    els.btnToggle.classList.remove("is-running");
    setScale(0.72, 0.4);
    playTone("done");
    updateProgressUI();
    startIdleParticles();
  }

  function advancePhase() {
    const mode = getMode();
    const next = state.phaseIndex + 1;
    if (next < mode.phases.length) {
      enterPhase(next, true);
      return;
    }
    // completed one full cycle
    bumpTodayRound();
    state.cycle += 1;
    if (state.totalCycles > 0 && state.cycle >= state.totalCycles) {
      finishSession();
      return;
    }
    enterPhase(0, true);
  }

  function tick(now) {
    if (!state.running || state.paused) return;

    drawParticles(now);

    const mode = getMode();
    const phase = mode.phases[state.phaseIndex];
    const elapsed = now - state.phaseStart - state.pauseAccum;
    const t = Math.min(1, Math.max(0, elapsed / state.phaseDuration));
    const e = easeInOut(t);
    const scale = phase.scaleFrom + (phase.scaleTo - phase.scaleFrom) * e;
    const glowBase = phase.key === "inhale" ? 0.35 + 0.35 * e : phase.key === "exhale" ? 0.55 - 0.3 * e : 0.42;
    setScale(scale, glowBase);

    const remain = Math.max(0, Math.ceil((state.phaseDuration - elapsed) / 1000));
    els.countText.textContent = String(remain);

    if (elapsed >= state.phaseDuration) {
      advancePhase();
    }

    if (state.running && !state.paused) {
      state.raf = requestAnimationFrame(tick);
    }
  }

  function particleLoop(now) {
    if (!state.running) {
      drawParticles(now);
      state.raf = requestAnimationFrame(particleLoop);
    }
  }

  function startIdleParticles() {
    if (state.raf) cancelAnimationFrame(state.raf);
    function loop(now) {
      if (state.running && !state.paused) return;
      drawParticles(now);
      state.raf = requestAnimationFrame(loop);
    }
    state.raf = requestAnimationFrame(loop);
  }

  function start() {
    const mode = getMode();
    state.totalCycles = Number(els.cyclesSelect.value);
    if (isNaN(state.totalCycles)) state.totalCycles = 4;

    if (state.paused) {
      // resume
      state.paused = false;
      state.running = true;
      state.pauseAccum += performance.now() - state.pauseStarted;
      els.btnToggle.textContent = "暂停";
      els.btnToggle.setAttribute("aria-label", "暂停");
      els.btnToggle.classList.add("is-running");
      els.hintText.textContent = mode.hint;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(tick);
      return;
    }

    // fresh start or restart after complete
    state.running = true;
    state.paused = false;
    state.cycle = 0;
    state.pauseAccum = 0;
    els.cyclesSelect.disabled = true;
    els.modeBtns.forEach(function (b) {
      b.disabled = true;
    });
    els.btnToggle.textContent = "暂停";
    els.btnToggle.setAttribute("aria-label", "暂停");
    els.btnToggle.classList.add("is-running");
    els.hintText.textContent = mode.hint;
    if (state.soundOn) ensureAudio();
    enterPhase(0, true);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!state.running || state.paused) return;
    state.paused = true;
    state.pauseStarted = performance.now();
    els.btnToggle.textContent = "继续";
    els.btnToggle.setAttribute("aria-label", "继续");
    els.btnToggle.classList.remove("is-running");
    els.hintText.textContent = "已暂停 · 点继续接着潮汐";
    els.phaseText.textContent = "暂停";
    startIdleParticles();
  }

  function reset() {
    state.running = false;
    state.paused = false;
    state.phaseIndex = 0;
    state.cycle = 0;
    state.pauseAccum = 0;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    els.cyclesSelect.disabled = false;
    els.modeBtns.forEach(function (b) {
      b.disabled = false;
    });
    els.btnToggle.textContent = "开始";
    els.btnToggle.setAttribute("aria-label", "开始");
    els.btnToggle.classList.remove("is-running");
    els.phaseText.textContent = "准备";
    els.countText.textContent = "—";
    els.hintText.textContent = getMode().hint;
    setScale(0.72, 0.35);
    updateProgressUI();
    startIdleParticles();
  }

  function setMode(id) {
    if (state.running) return;
    if (!MODES[id]) return;
    state.mode = id;
    els.modeBtns.forEach(function (btn) {
      const active = btn.dataset.mode === id;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    els.hintText.textContent = MODES[id].hint;
    reset();
  }

  /* —— events —— */
  els.btnToggle.addEventListener("click", function () {
    if (state.running && !state.paused) {
      pause();
    } else {
      start();
    }
  });

  els.btnReset.addEventListener("click", function () {
    reset();
  });

  els.btnSound.addEventListener("click", function () {
    state.soundOn = !state.soundOn;
    try {
      localStorage.setItem(SOUND_KEY, state.soundOn ? "1" : "0");
    } catch (e) { /* ignore */ }
    syncSoundUI();
    if (state.soundOn) {
      ensureAudio();
      playTone("hold");
    }
  });

  els.modeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setMode(btn.dataset.mode);
    });
  });

  els.cyclesSelect.addEventListener("change", function () {
    if (!state.running) {
      state.totalCycles = Number(els.cyclesSelect.value) || 0;
      updateProgressUI();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT")) return;
    if (e.code === "Space") {
      e.preventDefault();
      els.btnToggle.click();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      reset();
    }
  });

  window.addEventListener("resize", function () {
    resizeRipple();
    initParticles();
  });

  /* —— boot —— */
  loadStats();
  loadSoundPref();
  resizeRipple();
  initParticles();
  els.hintText.textContent = getMode().hint;
  setScale(0.72, 0.35);
  updateProgressUI();
  startIdleParticles();
})();
