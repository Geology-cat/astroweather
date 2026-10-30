import type { KeyboardEvent } from 'react';

/**
 * 確定操作としての Enter か。日本語入力（IME）の変換確定に使う Enter は除く
 * （Safari は確定直後の keydown で isComposing が false になるため keyCode 229 も見る）。
 */
export function isSubmitEnter(e: KeyboardEvent<HTMLInputElement>): boolean {
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229;
}
