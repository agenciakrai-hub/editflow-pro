// Compact visual comparison contract. No synthetic quality scores.
export const BURST_SELECTION_VERSION = "burst-winner-v2";
export async function compareBurstWinner(ids, compare, {maxImages = 8} = {}) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Ráfaga vacía o con identidades repetidas");
  let candidates = [...ids];
  const rounds = [];
  // Every original is seen; each round compares only winners from the previous round.
  do {
    const next = [];
    for (let i = 0; i < candidates.length; i += maxImages) {
      const batch = candidates.slice(i, i + maxImages);
      const result = await compare(batch);
      const seen = result?.compared_ids;
      const winner = result?.winner_id;
      if (!Array.isArray(seen) || seen.length !== batch.length || new Set(seen).size !== batch.length ||
          batch.some(id => !seen.includes(id)) || !batch.includes(winner) ||
          typeof result?.reason !== "string" || !result.reason.trim()) {
        const error = new Error("Comparación incompleta: faltan identificadores comparados, una ganadora válida o su motivo");
        error.failure_kind = "invalid_comparison";
        throw error;
      }
      rounds.push({compared_ids: batch, winner_id: winner, reason: result.reason.slice(0, 600)});
      next.push(winner);
    }
    candidates = next;
  } while (candidates.length > 1);
  const final = rounds.at(-1);
  return {
    decision_contract: BURST_SELECTION_VERSION,
    winner_id: candidates[0], keep_ids: [candidates[0]], category: null,
    reason: final.reason, comparisons: rounds,
    rankings: ids.map(id => ({
      id, rank: id === candidates[0] ? 1 : 2,
      status: id === candidates[0] ? "TOP_PICK" : "REVIEW",
      note: id === candidates[0] ? final.reason : "Alternativa de la misma ráfaga; no seleccionada",
      scores: null, analysis_complete: true, comparison_complete: true,
      missing_dimensions: [], reject_reasons: [], pose_key: null,
    })),
  };
}
