// 消息提示音 —— 设计规范 §6：不用素材文件，Web Audio 合成两枚正弦音
// （E5 659.25Hz → B5 987.77Hz，各 ~200ms），「墨滴入砚」。默认关闭。

const SOUND_KEY = 'aether-chat-sound';

let ctx: AudioContext | null = null;

export function getSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** 播放墨滴音。浏览器要求用户手势后才可发声，失败静默。 */
export function playDing(): void {
  try {
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx || new Ctor();
    [659.25, 987.77].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t0 = ctx!.currentTime + i * 0.09;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain);
      gain.connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
  } catch {
    /* 无声失败 */
  }
}
