/** URL クエリから読む起動パラメータ */
const params = new URLSearchParams(location.search);

/** ?room=CODE。ホームのコード入力を埋める */
export const URL_ROOM_CODE: string | null = params.get('room')?.trim().toUpperCase() || null;
/** ?debug=1 の時だけデバッグ表示 */
export const DEBUG = params.get('debug') === '1';
