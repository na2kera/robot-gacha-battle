export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export type ToastKind = 'info' | 'ok' | 'warn' | 'danger';

/** DOM 画面。mount で組み立て、update で差分を反映し、unmount で後片付けする */
export interface View {
  mount(root: HTMLElement): void;
  update?(): void;
  unmount(): void;
}
