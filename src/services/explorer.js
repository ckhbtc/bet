const INJECTIVE_EXPLORER_URL = 'https://tcx.inj.so';

export function txExplorerUrl(txHash) {
  return `${INJECTIVE_EXPLORER_URL}/tx/${encodeURIComponent(txHash)}?network=mainnet&mode=all`;
}

export function shortTxHash(txHash) {
  if (!txHash) return '';
  return `${txHash.slice(0, 12)}...`;
}
