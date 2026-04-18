/**
 * deBridge DLN inbound: Arbitrum USDC → Injective EVM USDT.
 * User signs approve + bridge tx on Arbitrum via MetaMask.
 */

const DEBRIDGE_API = 'https://dln.debridge.finance/v1.0';
const ARBITRUM_ID = 42161;
const INJECTIVE_DLN = 100000029;

export const BRIDGE_SRC_TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'; // USDC on Arbitrum
export const BRIDGE_DST_TOKEN = '0x88f7f2b685f9692caf8c478f5badf09ee9b1cc13'; // USDT on Injective EVM

function toBase(human, decimals = 6) {
  const f = parseFloat(human);
  if (!isFinite(f) || f <= 0) throw new Error('Invalid amount');
  return BigInt(Math.round(f * 10 ** decimals));
}

function fromBase(base, decimals = 6) {
  return (Number(base) / 10 ** decimals).toFixed(6).replace(/\.?0+$/, '');
}

function encodeApprove(spender, amount) {
  const sel = '095ea7b3';
  const addr = spender.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  const amt = amount.toString(16).padStart(64, '0');
  return `0x${sel}${addr}${amt}`;
}

async function callDln(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, v);
  }
  const url = `${DEBRIDGE_API}/dln/order/create-tx?${qs}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`deBridge API ${resp.status}: ${body}`);
  }
  return resp.json();
}

export async function fetchBridgeQuote(amount, recipientEvm) {
  const srcAmountBase = toBase(amount).toString();
  const raw = await callDln({
    srcChainId: String(ARBITRUM_ID),
    srcChainTokenIn: BRIDGE_SRC_TOKEN,
    srcChainTokenInAmount: srcAmountBase,
    dstChainId: String(INJECTIVE_DLN),
    dstChainTokenOut: BRIDGE_DST_TOKEN,
    dstChainTokenOutRecipient: recipientEvm,
  });
  const est = raw.estimation;
  if (!est) throw new Error('No estimation in deBridge response');
  return {
    srcAmount: amount,
    srcAmountBase,
    dstAmount: fromBase(est.dstChainTokenOut.amount, est.dstChainTokenOut.decimals),
    dstAmountBase: est.dstChainTokenOut.amount,
    protocolFee: raw.protocolFee ?? '0',
    fixFeeWei: raw.fixFee ?? '1000000000000000',
  };
}

async function switchToArbitrum() {
  const chainHex = '0xa4b1';
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    });
  } catch (err) {
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainHex,
          chainName: 'Arbitrum One',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://arb1.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://arbiscan.io'],
        }],
      });
    } else {
      throw err;
    }
  }
}

async function switchBackTo(chainId) {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch {
    // user can switch manually
  }
}

async function waitForReceipt(txHash, maxMs = 90_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const receipt = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    if (receipt) return;
    await new Promise(r => setTimeout(r, 2500));
  }
  throw new Error('Timed out waiting for confirmation');
}

async function sendMM({ from, to, data, value }) {
  const txParams = { from, to, data };
  if (value && value !== '0') txParams.value = '0x' + BigInt(value).toString(16);
  return window.ethereum.request({ method: 'eth_sendTransaction', params: [txParams] });
}

export async function executeBridge(amount, senderEvm, recipientEvm, onProgress) {
  const srcAmountBase = toBase(amount).toString();
  const originalChainId = await window.ethereum.request({ method: 'eth_chainId' });

  onProgress?.('Fetching bridge calldata...');
  const raw = await callDln({
    srcChainId: String(ARBITRUM_ID),
    srcChainTokenIn: BRIDGE_SRC_TOKEN,
    srcChainTokenInAmount: srcAmountBase,
    dstChainId: String(INJECTIVE_DLN),
    dstChainTokenOut: BRIDGE_DST_TOKEN,
    dstChainTokenOutRecipient: recipientEvm,
    srcChainOrderAuthorityAddress: senderEvm,
    dstChainOrderAuthorityAddress: recipientEvm,
  });
  if (!raw.tx?.to || !raw.tx?.data) throw new Error('deBridge did not return transaction calldata');
  const est = raw.estimation;
  if (!est) throw new Error('No estimation in deBridge response');

  const estimation = {
    srcAmount: amount,
    srcAmountBase,
    dstAmount: fromBase(est.dstChainTokenOut.amount, est.dstChainTokenOut.decimals),
    dstAmountBase: est.dstChainTokenOut.amount,
    protocolFee: raw.protocolFee ?? '0',
    fixFeeWei: raw.fixFee ?? '1000000000000000',
  };

  onProgress?.('Switching to Arbitrum...');
  await switchToArbitrum();

  onProgress?.('Step 1 of 2 — Approve USDC');
  const approveData = encodeApprove(raw.tx.to, BigInt(srcAmountBase));
  const approveTxHash = await sendMM({
    from: senderEvm, to: BRIDGE_SRC_TOKEN, data: approveData,
  });

  onProgress?.(`Approval sent (${approveTxHash.slice(0, 10)}...), confirming...`);
  await waitForReceipt(approveTxHash);

  onProgress?.('Step 2 of 2 — Bridge transaction');
  const bridgeTxHash = await sendMM({
    from: senderEvm, to: raw.tx.to, data: raw.tx.data,
    value: raw.tx.value ?? raw.fixFee,
  });

  await switchBackTo(originalChainId);

  return {
    approveTxHash,
    bridgeTxHash,
    orderId: raw.orderId ?? '',
    estimation,
  };
}
