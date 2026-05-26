export const INJECTIVE_EXPLORER_URL = 'https://tcx.inj.so';

export function txExplorerUrl(txHash) {
  return `${INJECTIVE_EXPLORER_URL}/transaction/${encodeURIComponent(txHash)}`;
}

export function shortTxHash(txHash) {
  if (!txHash) return '';
  return `${txHash.slice(0, 12)}...`;
}
