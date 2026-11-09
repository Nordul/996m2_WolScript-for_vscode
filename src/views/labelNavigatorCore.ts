export interface ScriptLabel {
  name: string;
  line: number;
  start: number;
  end: number;
}

const LABEL_RE = /^(\s*)\[@([A-Za-z0-9_\-一-鿿]+)\]/;

export function parseScriptLabels(text: string): ScriptLabel[] {
  const labels: ScriptLabel[] = [];
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    const match = lines[line].match(LABEL_RE);
    if (!match) continue;
    labels.push({
      name: match[2],
      line,
      start: match[1].length,
      end: match[0].length,
    });
  }
  return labels;
}

export function filterScriptLabels(labels: readonly ScriptLabel[], query: string): ScriptLabel[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...labels];
  return labels.filter((label) => {
    const name = label.name.toLowerCase();
    return terms.every((term) => name.includes(term.replace(/^@+/, '')));
  });
}
