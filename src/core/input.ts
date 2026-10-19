// 键盘与鼠标输入。射击只在鼠标按在游戏画面上时生效（避免点击界面时误射）。

export class InputState {
  keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  fire: [boolean, boolean] = [false, false];
  pressed: string[] = []; // 本帧按下的按键（一次性）
  hasMouse = false;
  private gameEl: HTMLElement;

  constructor(gameEl: HTMLElement) {
    this.gameEl = gameEl;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = [false, false]; });
    window.addEventListener('pointermove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.hasMouse = true; });
    gameEl.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.fire[0] = true;
      if (e.button === 2) this.fire[1] = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.fire[0] = false;
      if (e.button === 2) this.fire[1] = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  consume(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  moveVector(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    return { x, y };
  }

  releaseFire(): void {
    this.fire = [false, false];
  }

  get element(): HTMLElement {
    return this.gameEl;
  }
}
