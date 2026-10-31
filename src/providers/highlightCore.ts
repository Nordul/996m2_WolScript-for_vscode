export const WORD_PATTERN_SOURCE = '(-?\\d*\\.\\d\\w*)|([^`~!@#%^&*()\\-=+\\[\\]{}\\\\|;:\'",.<>/?\\s]+)';

export interface WordMatch {
  start: number;
  end: number;
}

export function findWordMatches(text: string, word: string): WordMatch[] {
  if (!word) return [];
  const needle = word.toLowerCase();
  const pattern = new RegExp(WORD_PATTERN_SOURCE, 'gi');
  const out: WordMatch[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m[0].toLowerCase() === needle) {
      out.push({ start: m.index!, end: m.index! + m[0].length });
    }
  }
  return out;
}
