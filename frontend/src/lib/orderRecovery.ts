export interface Transaction {
  id: string;
  txHash: string;
  fromNetwork: string;
  toNetwork: string;
  fromToken: string;
  toToken: string;
  amount: string;
  estimatedAmount: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  timestamp: number;
  direction: 'eth-to-xlm' | 'xlm-to-eth';
  ethTxHash?: string;
  stellarTxHash?: string;
  hashlock?: string;
  onChainOrderId?: string;
  refundTxHash?: string;
  refundNetwork?: 'ethereum' | 'stellar';
  refundedAt?: number;
  autoRefundFailed?: boolean;
  stellarAddress?: string;
  htlcContractAddress?: string;
  htlcContractMode?: 'v1-mainnet-htlc' | 'v2-escrow';
  amountWei?: string;
  timelockUnixSeconds?: number;
  networkMode?: 'testnet' | 'mainnet';
}

export interface RecoveredOrder extends Record<string, unknown> {
  id: string;
  direction: 'eth_to_xlm' | 'xlm_to_eth';
  status: string;
  src?: Record<string, any>;
  dst?: Record<string, any>;
  networkMode?: 'testnet' | 'mainnet';
}

export const OrderStatus = {
  Pending: 'pending',
  Escrowed: 'escrowed',
  SecretSubmitted: 'secret_submitted',
  Claimed: 'claimed',
  Completed: 'completed',
  Failed: 'failed'
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

function formatBaseUnits(value: unknown, decimals: number): string {
  const raw = String(value ?? '');
  if (!/^-?\d+$/.test(raw)) return raw;
  const units = BigInt(raw);
  const absolute = units < 0n ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${units < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export const STATUS_TO_STEP: Record<OrderStatus, number> = {
  [OrderStatus.Pending]: 0,
  [OrderStatus.Escrowed]: 1,
  [OrderStatus.SecretSubmitted]: 2,
  [OrderStatus.Claimed]: 3,
  [OrderStatus.Completed]: 4,
  [OrderStatus.Failed]: -1
};

export function shouldAdvanceTimeline(currentStep: number, newStatus: OrderStatus): boolean {
  const newStep = STATUS_TO_STEP[newStatus];
  return newStep !== undefined && newStep > currentStep;
}

export function getStepFromStatus(status: OrderStatus): number | undefined {
  return STATUS_TO_STEP[status];
}

function normalizedTransactionStatus(status: string): Transaction['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'refunded') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export function mapCoordinatorOrderToTransaction(value: unknown): Transaction {
  const raw = value as Record<string, any>;
  if (raw && typeof raw === 'object' && typeof raw.id === 'string' && typeof raw.txHash === 'string') {
    return raw as Transaction;
  }

  const sourceChain = raw.src?.chain;
  const destinationChain = raw.dst?.chain;
  const direction = raw.direction === 'xlm_to_eth' ? 'xlm-to-eth' : 'eth-to-xlm';
  const sourceLock = raw.src?.lockTx ?? undefined;
  const destinationLock = raw.dst?.lockTx ?? undefined;
  const revealedTx = raw.secret?.revealedTx ?? undefined;
  const timestamp = typeof raw.createdAt === 'number' ? raw.createdAt * 1000 : Date.now();
  return {
    id: raw.id ?? raw.publicId,
    txHash: sourceLock ?? destinationLock ?? revealedTx ?? raw.id,
    fromNetwork: sourceChain === 'ethereum' ? 'ETH Sepolia' : 'Stellar Testnet',
    toNetwork: destinationChain === 'ethereum' ? 'ETH Sepolia' : 'Stellar Testnet',
    fromToken: sourceChain === 'ethereum' ? 'ETH' : 'XLM',
    toToken: destinationChain === 'ethereum' ? 'ETH' : 'XLM',
    amount: formatBaseUnits(raw.src?.amount ?? '0', sourceChain === 'ethereum' ? 18 : 7),
    estimatedAmount: formatBaseUnits(raw.dst?.amount ?? '0', destinationChain === 'ethereum' ? 18 : 7),
    status: normalizedTransactionStatus(raw.status),
    timestamp,
    direction,
    ethTxHash: sourceChain === 'ethereum' ? sourceLock : destinationChain === 'ethereum' ? destinationLock : undefined,
    stellarTxHash: sourceChain === 'stellar' ? sourceLock : destinationChain === 'stellar' ? destinationLock : undefined,
    hashlock: raw.hashlock,
    onChainOrderId: raw.src?.orderId ?? raw.dst?.orderId ?? undefined,
    refundTxHash: raw.status === 'refunded' ? revealedTx : undefined,
    timelockUnixSeconds: raw.src?.timelock ?? undefined,
    networkMode: raw.networkMode ?? 'testnet'
  };
}

export function isRealHash(hash: string | null | undefined): boolean {
  if (hash === undefined || hash === null || hash === '') return true;
  const normalized = hash.toLowerCase();
  return !(
    normalized.startsWith('mock_') ||
    normalized === '0x0000000000000000000000000000000000000000' ||
    normalized === '0x1234567890abcdef1234567890abcdef12345678'
  );
}

export function isRealTransaction(tx: Transaction): boolean {
  return [tx.txHash, tx.ethTxHash, tx.stellarTxHash].every(isRealHash);
}

export function mergeTransactions(local: Transaction[], remote: Transaction[]): Transaction[] {
  const merged = [...local];
  const replacedLocalIndexes = new Map<number, number>();
  for (const remoteTx of remote) {
    const index = local.findIndex((localTx) =>
      localTx.id === remoteTx.id ||
      (localTx.hashlock && localTx.hashlock === remoteTx.hashlock) ||
      (localTx.onChainOrderId && localTx.onChainOrderId === remoteTx.onChainOrderId) ||
      [localTx.txHash, localTx.ethTxHash, localTx.stellarTxHash].some((hash) =>
        hash && [remoteTx.txHash, remoteTx.ethTxHash, remoteTx.stellarTxHash].includes(hash)
      )
    );
    if (index !== -1) {
      const mergedIndex = replacedLocalIndexes.get(index) ?? index;
      merged[mergedIndex] = remoteTx;
      replacedLocalIndexes.set(index, mergedIndex);
      continue;
    }

    const duplicateId = merged.findIndex((tx) => tx.id === remoteTx.id);
    if (duplicateId === -1) merged.push(remoteTx);
    else merged[duplicateId] = remoteTx;
  }
  return merged.sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchCoordinatorOrders(
  apiBase: string,
  addresses: { ethAddress?: string; stellarAddress?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Transaction[]> {
  const connected = [addresses.ethAddress, addresses.stellarAddress].filter(
    (address): address is string => Boolean(address)
  );
  if (connected.length === 0) return [];

  const responses = await Promise.allSettled(
    connected.map(async (address) => {
      const response = await fetchImpl(`${apiBase}/api/orders/history?address=${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error(`Coordinator returned ${response.status}`);
      const body = await response.json() as { orders?: unknown[]; transactions?: unknown[] };
      return (body.orders ?? body.transactions ?? []).map(mapCoordinatorOrderToTransaction);
    })
  );
  const succeeded = responses.filter(
    (result): result is PromiseFulfilledResult<Transaction[]> => result.status === 'fulfilled'
  );
  if (succeeded.length === 0) throw new Error('Could not recover orders from the coordinator');
  return mergeTransactions([], succeeded.flatMap((result) => result.value)).filter(isRealTransaction);
}

const ACTIVE_ORDER_KEY = 'oversync_active_order';
const ACTIVE_ORDER_ID_KEY = 'oversync_active_order_id';

export function getActiveOrder(): RecoveredOrder | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ORDER_KEY);
    return raw ? JSON.parse(raw) as RecoveredOrder : null;
  } catch {
    return null;
  }
}

export function setActiveOrder(order: RecoveredOrder): void {
  localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(order));
}

export function clearActiveOrder(): void {
  localStorage.removeItem(ACTIVE_ORDER_KEY);
}

export function getActiveOrderId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ORDER_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrderId(orderId: string): void {
  localStorage.setItem(ACTIVE_ORDER_ID_KEY, orderId);
}

export function clearActiveOrderId(): void {
  localStorage.removeItem(ACTIVE_ORDER_ID_KEY);
}

export function isResponseForCurrentOrder(currentId: string | null, responseId: string): boolean {
  return currentId === responseId;
}

export function isOrderStale(order: RecoveredOrder): boolean {
  return ['completed', 'refunded', 'failed'].includes(order.status) ? false : order.status === 'expired';
}

export async function checkOrderFreshness(orderId: string): Promise<{ order: RecoveredOrder; isStale: boolean }> {
  const apiBase = import.meta.env.PROD ? '' : import.meta.env.VITE_API_BASE_URL || '';
  const response = await fetch(`${apiBase}/api/orders/${encodeURIComponent(orderId)}`);
  if (!response.ok) throw new Error(`Could not refresh order (${response.status})`);
  const order = await response.json() as RecoveredOrder;
  return { order, isStale: isOrderStale(order) };
}
