export function shortenError(message, maxLength = 140) {
  const text = message || 'Unknown error';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export function getOpenTradeStatus(result) {
  const tpFailed = result?.takeProfit?.requested && !result.takeProfit?.placed;
  if (tpFailed) {
    return {
      type: 'warning',
      message: `Trade opened, but take-profit failed: ${shortenError(result.takeProfit.error)}`,
    };
  }

  return {
    type: 'success',
    message: `Trade placed! Tx: ${result.txHash.slice(0, 12)}...`,
  };
}
