/**
 * Efek suara permainan — disintesis via Web Audio API (tanpa file aset).
 * AudioContext hanya bisa berbunyi setelah gestur pengguna; GameTable
 * memanggil resumeAudio() saat pointerdown/keydown pertama.
 */

let audioCtx: AudioContext | null = null;

/** Buat/bangunkan AudioContext. Panggil dari handler gestur pengguna. */
export function resumeAudio() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // lingkungan tanpa Web Audio — abaikan
  }
}

function tone(freq: number, at: number, dur: number, vol = 0.16) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(vol, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** Lonceng dua nada yang cerah — penanda giliran tiba. */
export function playTurnChime() {
  resumeAudio();
  if (!audioCtx || audioCtx.state !== "running") return;
  const t = audioCtx.currentTime;
  tone(659.25, t, 0.16); // E5
  tone(987.77, t + 0.11, 0.3); // B5
}
