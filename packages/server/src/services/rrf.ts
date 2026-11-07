// Reciprocal rank fusion: merge ranked lists from different search channels.
// score(item) = sum over channels of 1 / (k + rank). Items found by several channels rise.

export type Channel = "vector" | "text" | "graph" | "sql";

export type Ranked = { id: string; channel: Channel; rank: number; score: number };

export type Fused = {
  id: string;
  score: number;
  channels: { channel: Channel; rank: number; score: number }[];
};

export function rrf(lists: Ranked[][], k = 60): Fused[] {
  const byId = new Map<string, Fused>();
  for (const list of lists) {
    for (const item of list) {
      const entry = byId.get(item.id) ?? { id: item.id, score: 0, channels: [] };
      entry.score += 1 / (k + item.rank);
      entry.channels.push({ channel: item.channel, rank: item.rank, score: item.score });
      byId.set(item.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}
