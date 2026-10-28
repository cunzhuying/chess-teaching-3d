/**
 * 极简 Web Audio 合成器：不依赖外部音频资源。
 * 三种声音：拿棋、落子、吃子撞击/碎裂。
 */
class SoundEngine {
  enabled = true;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.enabled = window.localStorage.getItem('chess.sound') !== 'off';
      } catch {
        this.enabled = true;
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('chess.sound', enabled ? 'on' : 'off');
      } catch {
        // 隐私模式下 localStorage 可能不可用，音效仍然工作。
      }
    }
    if (!enabled) {
      this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.02);
    } else if (this.master && this.context) {
      this.master.gain.setTargetAtTime(0.55, this.context.currentTime, 0.02);
      void this.context.resume();
    }
  }

  /** 在用户手势里提前解锁 AudioContext，避免动画里的第一声被浏览器拦截。 */
  unlock(): void {
    this.ensure();
  }

  playPick(): void {
    if (!this.ensure()) return;
    const now = this.context!.currentTime;
    this.noiseBurst(0.035, 0.09, 'bandpass', 2600, 1.2, 0, now);
    this.tone(900, 640, 0.045, 0.035, 'triangle', 0, now);
  }

  playPlace(): void {
    if (!this.ensure()) return;
    const now = this.context!.currentTime;
    this.tone(220, 92, 0.13, 0.17, 'sine', 0, now);
    this.tone(420, 180, 0.06, 0.06, 'triangle', 0, now);
    this.noiseBurst(0.05, 0.11, 'lowpass', 900, 0.8, 0, now);
    this.noiseBurst(0.02, 0.05, 'highpass', 2200, 1, 0.004, now);
  }

  playCapture(): void {
    if (!this.ensure()) return;
    const now = this.context!.currentTime;
    // 低频木块撞击 + 中频碎裂 + 高频木屑。
    this.tone(150, 52, 0.26, 0.26, 'sine', 0, now);
    this.noiseBurst(0.2, 0.24, 'lowpass', 1500, 0.7, 0, now);
    this.noiseBurst(0.055, 0.18, 'bandpass', 2400, 0.9, 0.028, now);
    this.noiseBurst(0.04, 0.1, 'highpass', 3600, 1.2, 0.055, now);
    this.tone(92, 48, 0.18, 0.12, 'triangle', 0.02, now);
  }

  private ensure(): boolean {
    if (!this.enabled || typeof window === 'undefined') return false;

    if (!this.context) {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return false;

      this.context = new AudioCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);

      const length = Math.floor(this.context.sampleRate * 0.5);
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
    return true;
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    gainValue: number,
    type: OscillatorType,
    delay: number,
    now: number,
  ): void {
    if (!this.context || !this.master) return;
    const start = now + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noiseBurst(
    duration: number,
    gainValue: number,
    filterType: BiquadFilterType,
    frequency: number,
    q: number,
    delay: number,
    now: number,
  ): void {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const start = now + delay;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.setValueAtTime(q, start);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

export const sound = new SoundEngine();
