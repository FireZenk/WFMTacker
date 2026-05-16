/* WFM Tracker — rank utilities (shared by content script and panel) */

function splitByRank(days) {
  if (!days.some(e => e.mod_rank != null)) return null;
  return {
    r0: days.filter(e => e.mod_rank === 0),
    r5: days.filter(e => e.mod_rank === 5),
  };
}

function resolveRank(savedRank, rankSplit90) {
  return savedRank !== null ? savedRank : ((rankSplit90?.r5?.length) ? 5 : 0);
}
