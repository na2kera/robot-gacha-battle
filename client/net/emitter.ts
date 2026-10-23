type Listener = (...args: unknown[]) => void;

/** 型付きの小さなイベントエミッタ。on は解除関数を返す */
export class Emitter<Events extends Record<string, unknown[]>> {
  private listeners = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const listener = fn as unknown as Listener;
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // 同じ emit の途中で解除されたリスナー（終了した scene など）は呼ばない
    for (const fn of [...set]) if (set.has(fn)) fn(...args);
  }
}
