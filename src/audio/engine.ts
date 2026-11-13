/**
 * Renders sound recipes and music with Web Audio. One engine per game: it owns
 * the master, effects, and music volume nodes, a shared noise buffer, and the
 * limits that keep busy fights from turning into noise.
 */
import type { Recipe, Voice } from './synth';
import { STEPS, TRACKS, midiToFreq, parsePattern, type NoteEvent, type Track } from './tracks';

const MAX_VOICES = 28;
/** The same sound will not restart within this many seconds. */
const REPEAT_GAP = 0.035;
const LOOKAHEAD = 0.15;
const CROSSFADE = 1.2;

export interface Volumes {
  music: number;
  sfx: number;
  muted: boolean;
}

interface Playing {
  id: string;
  gain: GainNode;
  timer: number;
  nextStep: number;
  nextTime: number;
  notes: { lead: NoteEvent[]; bass: NoteEvent[] };
  track: Track;
}

export class AudioEngine {
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly music: GainNode;
  private readonly noise: AudioBuffer;
  private voiceEnds: number[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private current: Playing | null = null;
  /** Sounds started so far, for headless checks (the workspace cannot listen). */
  played = 0;

  constructor(private readonly ctx: AudioContext, volumes: Volumes) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.setVolumes(volumes);
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  get currentTrack(): string | null {
    return this.current?.id ?? null;
  }

  setVolumes({ music, sfx, muted }: Volumes): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02);
    this.sfx.gain.setTargetAtTime(sfx * 0.7, t, 0.02);
    this.music.gain.setTargetAtTime(music * 0.35, t, 0.05);
  }

  /** Plays a sound effect. `key` groups repeats; `pan` is -1 (left) to 1 (right). */
  play(key: string, recipe: Recipe, pan = 0): void {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < REPEAT_GAP) return;
    this.voiceEnds = this.voiceEnds.filter((end) => end > now);
    if (this.voiceEnds.length + recipe.length > MAX_VOICES) return;
    this.lastPlayed.set(key, now);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.sfx);
    for (const voice of recipe) this.voiceEnds.push(this.voice(voice, now, panner));
    this.played += 1;
  }

  /** Starts a voice and returns when it ends. */
  private voice(v: Voice, now: number, out: AudioNode): number {
    const start = now + (v.delay ?? 0);
    const end = start + v.attack + v.decay;
    const source = this.source(v.wave, v.freq, v.freqEnd, start, end);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.gain), start + v.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    let node: AudioNode = source;
    if (v.filter) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = v.filter.type;
      filter.Q.value = v.filter.q ?? 0.7;
      filter.frequency.setValueAtTime(v.filter.freq, start);
      if (v.filter.freqEnd) filter.frequency.exponentialRampToValueAtTime(v.filter.freqEnd, end);
      node.connect(filter);
      node = filter;
    }
    node.connect(gain).connect(out);
    source.start(start);
    source.stop(end + 0.02);
    return end;
  }

  private source(wave: Voice['wave'], freq: number, freqEnd: number | undefined, start: number, end: number): AudioScheduledSourceNode {
    if (wave === 'noise') {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      return noise;
    }
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, end);
    return osc;
  }

  // ---- music ---------------------------------------------------------------

  /** Crossfades to a track; does nothing if it is already playing. */
  playMusic(id: string): void {
    if (this.current?.id === id) return;
    const track = TRACKS[id];
    this.stopMusic();
    if (!track) return;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(track.level, t + CROSSFADE);
    gain.connect(this.music);
    const playing: Playing = {
      id,
      gain,
      track,
      nextStep: 0,
      nextTime: t + 0.05,
      notes: {
        lead: parsePattern(track.lead, track.root, track.scale),
        bass: parsePattern(track.bass, track.root - 24, track.scale),
      },
      // A timer, not the frame loop, so music keeps time when frames drop.
      timer: window.setInterval(() => this.schedule(playing), 25),
    };
    this.current = playing;
    this.schedule(playing);
  }

  stopMusic(): void {
    const old = this.current;
    if (!old) return;
    window.clearInterval(old.timer);
    const t = this.ctx.currentTime;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), t);
    old.gain.gain.exponentialRampToValueAtTime(0.0001, t + CROSSFADE * 0.6);
    window.setTimeout(() => old.gain.disconnect(), CROSSFADE * 1000);
    this.current = null;
  }

  private schedule(p: Playing): void {
    if (!this.running) {
      p.nextTime = this.ctx.currentTime + 0.05;
      return;
    }
    const stepTime = 60 / p.track.bpm / 4;
    while (p.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      const step = p.nextStep;
      const t = p.nextTime;
      const { track, gain } = p;
      for (const n of p.notes.lead) if (n.step === step) this.tone(gain, track.leadWave, n.midi, t, n.length * stepTime * 0.9, 0.16, 2600);
      for (const n of p.notes.bass) if (n.step === step) this.tone(gain, 'triangle', n.midi, t, n.length * stepTime * 0.95, 0.42, 900);
      if (track.kick[step] === 'x') this.drum(gain, 'kick', t);
      if (track.snare[step] === 'x') this.drum(gain, 'snare', t);
      if (track.hat[step] === 'x') this.drum(gain, 'hat', t);
      p.nextStep = (step + 1) % STEPS;
      p.nextTime += stepTime;
    }
  }

  private tone(out: AudioNode, wave: OscillatorType, midi: number, t: number, length: number, level: number, cutoff: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = midiToFreq(midi);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.setTargetAtTime(level * 0.6, t + 0.02, length * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private drum(out: AudioNode, kind: 'kick' | 'snare' | 'hat', t: number): void {
    const gain = this.ctx.createGain();
    gain.connect(out);
    if (kind === 'kick') {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.2);
      return;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = kind === 'snare' ? 'bandpass' : 'highpass';
    filter.frequency.value = kind === 'snare' ? 1800 : 7000;
    const length = kind === 'snare' ? 0.14 : 0.04;
    gain.gain.setValueAtTime(kind === 'snare' ? 0.35 : 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    noise.connect(filter).connect(gain);
    noise.start(t);
    noise.stop(t + length + 0.02);
  }
}
