/** Подписи событий над графиком: раскладываем по рядам, чтобы не наезжали друг на друга.
    Что не поместилось в maxRows рядов — остаётся линией без подписи (текст — во всплывающей подсказке). */
export function layoutMarks<T extends { title: string; x: number }>(items: T[], { maxRows = 3, charW = 5.9, maxChars = 24 } = {}) {
  const ends: number[] = [];
  const out = [...items].sort((a, b) => a.x - b.x).map((it) => {
    const label = it.title.length > maxChars ? `${it.title.slice(0, maxChars - 1)}…` : it.title;
    const w = label.length * charW + 10;
    let row = ends.findIndex((end) => end <= it.x);
    if (row === -1 && ends.length < maxRows) { row = ends.length; ends.push(0); }
    if (row === -1) return { ...it, row: -1, label: null as string | null };
    ends[row] = it.x + w;
    return { ...it, row, label: label as string | null };
  });
  return { marks: out, rows: ends.length };
}
