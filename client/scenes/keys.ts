export const SCENE = {
  boot: 'boot',
  home: 'home',
  status: 'status',
  room: 'room',
  draft: 'draft',
  trial: 'trial',
  reveal: 'reveal',
  battle: 'battle',
  result: 'result',
} as const;

export type SceneKey = (typeof SCENE)[keyof typeof SCENE];
