import { SETTINGS } from "../core/config";
import { AUDIO_KEYS, type AudioKey } from "./AssetRegistry";

export type SoundKey =
  | "launch"
  | "eject"
  | "hijack"
  | "blast"
  | "meltdown"
  | "shot"
  | "shotgun"
  | "claw"
  | "shield"
  | "dash"
  | "hurt"
  | "heartbeat"
  | "uiClick"
  | "uiHover"
  | "denied"
  | "graft"
  | "win"
  | "step"
  | "door"
  | "warning"
  | "whisper";

/** Sounds that may be replaced by a file in `public/assets/audio/`. */
const SAMPLE_FOR: Partial<Record<SoundKey, AudioKey>> = {
  launch: "sfx_launch",
  hijack: "sfx_hijack",
  blast: "sfx_blast",
  shot: "sfx_shot",
  shotgun: "sfx_shotgun",
  claw: "sfx_claw",
};

type Loader = (key: AudioKey, ctx: AudioContext) => Promise<AudioBuffer | null>;

/**
 * All audio is synthesized with the Web Audio API, so the prototype ships with
 * sound and zero binary assets. Dropping a WAV listed in `AssetRegistry` into
 * `public/assets/audio/` overrides the corresponding synth voice on next load.
 *
 * The AudioContext is created lazily on the first user gesture to satisfy
 * browser autoplay policies (and to keep the console clean).
 */
export class SfxSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly samples = new Map<AudioKey, AudioBuffer>();
  private samplesStarted = false;
  private hum: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  constructor(private readonly loader: Loader) {}

  /** Call from any user gesture; safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();

      // One shared dynamics stage keeps layered explosions punchy instead of
      // clipped. Every voice, sample and the codex hum pass through it.
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      compressor.connect(this.ctx.destination);
      this.compressor = compressor;

      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterLevel();
      this.master.connect(compressor);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.samplesStarted) {
      this.samplesStarted = true;
      void this.loadSamples();
    }
    if (this.hum) this.hum.gain.gain.setTargetAtTime(0.014, this.ctx.currentTime, 0.1);
  }

  /** Exposed for the settings/debug inspector; audio still flows through it. */
  get dynamics(): DynamicsCompressorNode | null {
    return this.compressor;
  }

  setVolume(volume: number): void {
    SETTINGS.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
    }
  }

  private masterLevel(): number {
    // Hot enough to feel physical, shaped by the compressor above so stacked
    // shots and blasts compress rather than distort.
    return 0.44 * Math.pow(SETTINGS.volume, 0.7);
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      AUDIO_KEYS.map(async (key) => {
        const buffer = await this.loader(key, ctx);
        if (buffer) this.samples.set(key, buffer);
      }),
    );
  }

  play(key: SoundKey): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return;

    const sampleKey = SAMPLE_FOR[key];
    const sample = sampleKey ? this.samples.get(sampleKey) : undefined;
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = 0.97 + Math.random() * 0.06;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(master);
      src.start();
      return;
    }

    const t = ctx.currentTime + 0.005;
    switch (key) {
      case "launch":
        this.noise(t, 0.26, 0.24, 320, 2600, 1.1, "bandpass");
        this.tone("sine", 190, 760, t, 0.22, 0.18);
        this.tone("sine", 240, 90, t, 0.14, 0.12);
        break;
      case "eject":
        this.noise(t, 0.3, 0.3, 2400, 260, 0.7, "lowpass");
        this.tone("sine", 520, 120, t, 0.26, 0.2);
        this.tone("sine", 130, 34, t, 0.4, 0.32);
        break;
      case "hijack":
        this.tone("sine", 130, 42, t, 0.36, 0.5);
        this.noise(t + 0.02, 0.2, 0.2, 1100, 260, 2.4, "lowpass");
        this.tone("triangle", 920, 260, t + 0.03, 0.1, 0.1);
        this.tone("sine", 90, 30, t, 0.45, 0.3);
        break;
      case "blast":
        this.noise(t, 0.75, 0.4, 2200, 90, 0.9, "lowpass");
        this.tone("sine", 140, 28, t, 0.72, 0.7);
        this.tone("square", 190, 55, t, 0.16, 0.1);
        this.tone("sine", 80, 24, t, 0.85, 0.5);
        break;
      case "meltdown":
        this.tone("sawtooth", 420, 38, t, 1.15, 0.2);
        this.noise(t, 0.9, 0.16, 700, 120, 1.2, "lowpass");
        this.tone("sine", 60, 22, t, 1.2, 0.28);
        break;
      case "shot":
        this.tone("square", 820, 230, t, 0.06, 0.11);
        this.noise(t, 0.055, 0.1, 3200, 900, 1, "highpass");
        // Low pitch-envelope gives the rifle body without a long tail.
        this.tone("sine", 170, 52, t, 0.1, 0.14);
        break;
      case "shotgun":
        this.noise(t, 0.26, 0.32, 1800, 140, 0.9, "lowpass");
        this.tone("sine", 150, 42, t, 0.34, 0.3);
        this.tone("sine", 105, 32, t, 0.4, 0.28);
        break;
      case "claw":
        this.tone("sawtooth", 900, 130, t, 0.14, 0.13);
        this.noise(t, 0.12, 0.14, 3400, 700, 4, "bandpass");
        break;
      case "shield":
        this.tone("triangle", 1560, 1180, t, 0.11, 0.12);
        this.noise(t, 0.04, 0.08, 5200, 2600, 1, "highpass");
        break;
      case "dash":
        this.noise(t, 0.15, 0.13, 900, 280, 2, "bandpass");
        this.tone("sine", 280, 720, t, 0.14, 0.08);
        break;
      case "hurt":
        this.tone("sine", 95, 42, t, 0.24, 0.36);
        this.noise(t, 0.14, 0.16, 800, 200, 1.4, "lowpass");
        this.tone("sine", 70, 28, t, 0.3, 0.25);
        break;
      case "heartbeat":
        this.tone("sine", 62, 38, t, 0.16, 0.45);
        this.tone("sine", 58, 34, t + 0.17, 0.13, 0.3);
        break;
      case "uiClick":
        this.tone("square", 900, 900, t, 0.035, 0.06);
        this.tone("sine", 1420, 1200, t, 0.05, 0.03);
        break;
      case "uiHover":
        this.tone("sine", 1180, 1320, t, 0.035, 0.032);
        break;
      case "denied":
        this.tone("square", 165, 120, t, 0.11, 0.09);
        this.tone("square", 118, 96, t + 0.09, 0.1, 0.07);
        break;
      case "graft":
        this.tone("triangle", 380, 560, t, 0.09, 0.1);
        this.tone("triangle", 560, 780, t + 0.1, 0.12, 0.09);
        break;
      case "win":
        this.tone("triangle", 440, 440, t, 0.14, 0.11);
        this.tone("triangle", 554, 554, t + 0.14, 0.14, 0.11);
        this.tone("triangle", 659, 659, t + 0.28, 0.32, 0.12);
        break;
      case "step":
        this.noise(t, 0.05, 0.05, 520, 240, 1.2, "lowpass");
        break;
      case "door":
        // Hydraulic release: a hiss of escaping pressure over a servo drop.
        this.noise(t, 0.42, 0.1, 2600, 700, 0.7, "bandpass");
        this.tone("sawtooth", 118, 48, t + 0.04, 0.5, 0.1);
        this.tone("sine", 62, 34, t + 0.06, 0.6, 0.16);
        break;
      case "warning":
        this.tone("triangle", 280, 950, t, 0.85, 0.09);
        break;
      case "whisper":
        this.noise(t, 0.5, 0.03, 1200, 2600, 1.6, "bandpass");
        this.tone("sine", 1900, 2400, t, 0.28, 0.018);
        break;
    }
  }

  /** Low CRT room tone while the codex is open. */
  startHum(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.hum) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.018, ctx.currentTime, 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    filter.connect(gain).connect(master);

    const osc = [58, 87, 174].map((freq, index) => {
      const node = ctx.createOscillator();
      node.type = index === 2 ? "sine" : "sawtooth";
      node.frequency.value = freq;
      const level = ctx.createGain();
      level.gain.value = index === 2 ? 0.25 : 0.5;
      node.connect(level).connect(filter);
      node.start();
      return node;
    });
    this.hum = { osc, gain };
  }

  stopHum(): void {
    const ctx = this.ctx;
    if (!ctx || !this.hum) return;
    const hum = this.hum;
    this.hum = null;
    hum.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    const stopAt = ctx.currentTime + 0.5;
    for (const osc of hum.osc) osc.stop(stopAt);
  }

  private tone(
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    start: number,
    duration: number,
    gainValue: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), start);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  private noise(
    start: number,
    duration: number,
    gainValue: number,
    freqStart: number,
    freqEnd: number,
    q: number,
    filterType: BiquadFilterType,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const buffer = this.getNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(20, freqStart), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(start, Math.random() * 0.5);
    src.stop(start + duration + 0.02);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.8);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}
