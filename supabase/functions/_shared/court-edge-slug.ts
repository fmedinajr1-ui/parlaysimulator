// Court.Edge — shared player-name → TennisAbstract slug.

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function playerSlug(name: string): string {
  if (!name) return "";
  const cleaned = stripDiacritics(name).replace(/[^A-Za-z\s'-]/g, "").trim();
  return cleaned
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}