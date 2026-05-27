import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import {
  GatewayClient,
  SupportedChainName,
} from '@circle-fin/x402-batching/client';

type SubmitTxResponse = {
  success: boolean;
  data?: {
    txId: string;
    estimatedCostUSD?: number;
    x402Payment?: {
      amount: string;
      amountUsd: number;
      network: string;
      transaction: string;
    };
  };
  error?: {
    message: string;
  };
};

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name}`);
  }
  return value;
}

async function main() {
  const baseUrl =  'https://tachyon.rath.fi';
  const url = new URL('/api/submit-tx', baseUrl).toString();

  const client = new GatewayClient({
    chain: 'base' as SupportedChainName,
    privateKey: readEnv('GATEWAY_PRIVATE_KEY') as `0x${string}`,
  });

  const depositAmount = '0.1';
  if (depositAmount) {
    const deposit = await client.deposit(depositAmount );
    console.log(`Deposited ${deposit.formattedAmount} USDC: ${deposit.depositTxHash}`);
  }

  const balances = await client.getBalances();
  console.log(`Gateway available: ${balances.gateway.formattedAvailable} USDC`);

  const tx = {
    chainId:8453,
    to: '0xA7A833e6641D7901F30EaD6f27d4Ee2C9bb670a7',
    callData: '0xc3a9b1c50000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001348656c6c6f2066726f6d2054616368796f6e2100000000000000000000000000',
    value: '0',
    gasLimit: '100000',
    label: process.env.TX_LABEL ?? 'x402-gateway-example',
  };

  const result = await client.pay<SubmitTxResponse>(url, {
    method: 'POST',
    body: tx,
  });

  if (!result.data.success) {
    throw new Error(result.data.error?.message ?? 'Tachyon submit failed');
  }

  console.log(`Tachyon tx id: ${result.data.data?.txId}`);
  console.log(`Estimated execution cost: $${result.data.data?.estimatedCostUSD}`);
  console.log(`Paid: ${result.formattedAmount} USDC`);
  console.log(`Gateway settlement: ${result.transaction}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
