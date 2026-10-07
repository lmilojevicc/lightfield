import type { BackgroundInstance } from "./contracts";

export class ActiveInstanceSlot {
  private current: BackgroundInstance | null = null;

  replace(next: BackgroundInstance | null): void {
    if (this.current === next) return;
    const previous = this.current;
    this.current = next;
    previous?.destroy();
  }

  update(update: Parameters<BackgroundInstance["update"]>[0]): void {
    this.current?.update(update);
  }

  configure(
    settings: import("../../shared/local-image").LocalImageSettings,
  ): void {
    this.current?.configure?.(settings);
  }

  resize(): void {
    this.current?.resize();
  }

  clear(): void {
    this.replace(null);
  }
}
