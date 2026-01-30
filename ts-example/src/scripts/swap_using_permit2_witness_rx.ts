import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  createPublicClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  encodeFunctionData,
  keccak256,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ChainId, Tachyon } from "@rathfi/tachyon";

// Load env vars
dotenv();
const { PRIVATE_KEY, ZERO_EX_API_KEY, TACHYON_API_KEY } = process.env;

// Validate requirements
if (!PRIVATE_KEY) throw new Error("missing PRIVATE_KEY");
if (!ZERO_EX_API_KEY) throw new Error("missing ZERO_EX_API_KEY");
if (!TACHYON_API_KEY) throw new Error("missing TACHYON_API_KEY");

// Contract addresses for Base network
const CONTRACTS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Uniswap Permit2
  RATH_EXECUTOR: "0x36b7e6e7fbbe07d3cf91203fb47cd436f65e6e97", // Rath Executor contract
} as const;

// ABI for rathExecutePermit2WithWitness function
const rathExecutorAbi = [
  {
    type: "function",
    name: "rathExecutePermit2WithWitness",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        internalType: "struct ISignatureTransfer.PermitTransferFrom",
        components: [
          {
            name: "permitted",
            type: "tuple",
            internalType: "struct ISignatureTransfer.TokenPermissions",
            components: [
              {
                name: "token",
                type: "address",
                internalType: "address",
              },
              {
                name: "amount",
                type: "uint256",
                internalType: "uint256",
              },
            ],
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
      {
        name: "from",
        type: "address",
        internalType: "address",
      },
      {
        name: "callData",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

// 0x API headers
const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

// Setup clients
const account = privateKeyToAccount(`${PRIVATE_KEY}` as `0x${string}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(),
});

async function executePermit2SwapWithTachyon() {
  const owner = account.address;

  console.log("Owner address:", owner);

  // Setup tokens contract
  const sellingToken = getContract({
    address: CONTRACTS.USDC,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const buyingToken = getContract({
    address: CONTRACTS.WETH,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  console.log(
    `Swapping ${sellingToken.address} to ${buyingToken.address} using Permit2 + Tachyon relay\n`
  );

  // Define swap parameters
  const sellAmount = parseUnits("0.2", 6);
  const chainId = base.id;

  // Step 1: Check and approve USDC to Permit2 if needed
  const currentAllowance = await publicClient.readContract({
    address: sellingToken.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, CONTRACTS.PERMIT2],
  });

  console.log(`Token allowance to Permit2: ${currentAllowance.toString()}`);

  if (currentAllowance < sellAmount) {
    console.log("Approving token to Permit2...");
    const approveHash = await walletClient.writeContract({
      address: sellingToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.PERMIT2, maxUint256],
    });

    console.log("Approval tx hash:", approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Token approved to Permit2!");
  } else {
    console.log("Token already approved to Permit2");
  }

  // Step 2: Fetch quote from 0x API (allowance-holder)
  const priceParams = new URLSearchParams({
    chainId: chainId.toString(),
    sellToken: sellingToken.address,
    buyToken: buyingToken.address,
    sellAmount: sellAmount.toString(),
    taker: owner,
  });
  console.log("\nFetching quote from 0x API (allowance-holder)...");
  const quoteParams = new URLSearchParams(priceParams);

  const quoteResponse = await fetch(
    `https://api.0x.org/swap/allowance-holder/quote?${quoteParams.toString()}`,
    { headers }
  );

  const quote = await quoteResponse.json();
  //   console.log("Quote response:", quote);

  // Step 3: Generate a unique nonce for Permit2
  // Permit2 uses a nonce bitmap system - we can use any unused nonce
  // Using timestamp + random value to ensure uniqueness
  const nonce =
    BigInt(Date.now()) * BigInt(1000000) +
    BigInt(Math.floor(Math.random() * 1000000));

  console.log("\nGenerated Permit2 nonce:", nonce.toString());

  // Step 4: Build Permit2 EIP-712 message manually
  const deadline = BigInt(Math.floor(Date.now() / 1000) +( 60 * 10)); // 10 minutes from now

  const permit = {
    permitted: {
      token: sellingToken.address,
      amount: sellAmount,
    },
    nonce: nonce,
    deadline: deadline,
  };

  // Calculate witness data
  const witnessData = {
    target: quote.transaction.to as Hex,
    callDataHash: keccak256(quote.transaction.data as Hex),
  };

  console.log("\nWitness data:", witnessData);

  const eip712Message = {
    domain: {
      name: "Permit2",
      chainId: chainId,
      verifyingContract: CONTRACTS.PERMIT2 as Hex,
    },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Payload" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Payload: [
        { name: "target", type: "address" },
        { name: "callDataHash", type: "bytes32" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: {
        token: sellingToken.address,
        amount: sellAmount,
      },
      spender: CONTRACTS.RATH_EXECUTOR,
      nonce: nonce,
      deadline: deadline,
      witness: witnessData,
    },
  };

  console.log("\nSigning Permit2 message...");
  const signature = await walletClient.signTypedData(eip712Message);
  console.log("Permit2 signature obtained");

  // Step 5: Encode call to rathExecutePermit2WithWitness function

  const transactionData = encodeFunctionData({
    abi: rathExecutorAbi,
    functionName: "rathExecutePermit2WithWitness",
    args: [
      permit,
      owner,
      quote.transaction.data as Hex, // swapData from 0x API
      signature,
    ],
  });

  console.log("\nTransaction data prepared for rathExecutePermit2WithWitness");

  // Step 6: Initialize Tachyon
  const tachyon = new Tachyon({
    apiKey: TACHYON_API_KEY!,
  });

  // Step 7: Relay transaction via Tachyon
  console.log("\nRelaying transaction via Tachyon...");
  console.log("Target:", CONTRACTS.RATH_EXECUTOR);
  console.log("Gas limit:", quote.transaction.gas);

  const txId = await tachyon.relay({
    chainId: ChainId.BASE,
    to: CONTRACTS.RATH_EXECUTOR, // Call PermitSwap contract
    value: "0", // No ETH value needed
    gasLimit: "1000000",
    transactionType: "flash-blocks",
    callData: transactionData,
  });

  console.log("\n✅ Relay Tx ID:", txId);

  // Step 8: Wait for transaction execution
  console.log("\nWaiting for transaction execution...");
  const relayStatus = await tachyon.waitForPendingExecutionHash(txId);

  //   console.log("\n🎉 Transaction Status:", relayStatus);
  console.log(
    `See tx details at https://basescan.org/tx/${relayStatus.executionTxHash}`
  );
}

async function main() {
  try {
    await executePermit2SwapWithTachyon();
  } catch (error) {
    console.error("Error executing Permit2 swap with Tachyon:", error);
    process.exitCode = 1;
  }
}

main();
