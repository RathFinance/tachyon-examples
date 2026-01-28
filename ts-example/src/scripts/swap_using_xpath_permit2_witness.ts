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
  encodeAbiParameters,
  hashTypedData,
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
  XPATH: "0x737e1b401BF7a67e6b74bB393Dd62D3Bd9b37D0b", // xPath contract
} as const;

// ABI for acquireFundsAndExec function
const xPathSwapAbi = [
  {
    type: "function",
    name: "acquireFundsAndExec",
    inputs: [
      {
        name: "args",
        type: "tuple",
        internalType: "struct IPrelude.PreludeArgs",
        components: [
          {
            name: "acquisitionMode",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "tokenIn",
            type: "address",
            internalType: "address",
          },
          {
            name: "amountIn",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "meta",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "data",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "acquisitionData",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
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

async function executeXpathSwapWithPermit2Witness() {
  const owner = account.address;

  console.log("Owner address:", owner);

  // Setup tokens contract
  const sellingToken = getContract({
    address: CONTRACTS.WETH,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const buyingToken = getContract({
    address: CONTRACTS.USDC,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  console.log(
    `Swapping ${sellingToken.address} (WETH) to ${buyingToken.address} (USDC) using xPath + Permit2 Witness\n`,
  );

  // Define swap parameters
  const sellAmount = parseUnits("0.00000332177181558", 18); // 0.0001 WETH
  const chainId = base.id;

  // Step 1: Check and approve WETH to Permit2 if needed
  const currentAllowance = await publicClient.readContract({
    address: sellingToken.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, CONTRACTS.PERMIT2],
  });

  console.log(`WETH allowance to Permit2: ${currentAllowance.toString()}`);

  if (currentAllowance < sellAmount) {
    console.log("Approving WETH to Permit2...");
    const approveHash = await walletClient.writeContract({
      address: sellingToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.PERMIT2, maxUint256],
    });

    console.log("Approval tx hash:", approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("WETH approved to Permit2!");
  } else {
    console.log("WETH already approved to Permit2");
  }

  // Step 2: Fetch quote from 0x API
  const priceParams = new URLSearchParams({
    chainId: chainId.toString(),
    sellToken: sellingToken.address,
    buyToken: buyingToken.address,
    sellAmount: sellAmount.toString(),
    taker: CONTRACTS.XPATH, // Important: taker is the xPath contract
    recipient: owner,
  });

  console.log("\nFetching quote from 0x API...");
  const quoteParams = new URLSearchParams(priceParams);

  const quoteResponse = await fetch(
    `https://api.0x.org/swap/allowance-holder/quote?${quoteParams.toString()}`,
    { headers },
  );

  const quote = await quoteResponse.json();
  console.log("Quote received:", {
    buyAmount: quote.buyAmount,
    sellAmount: quote.sellAmount,
    to: quote.transaction.to,
  });

  // Step 3: Prepare the execution data
  const swapCallData = quote.transaction.data as Hex;
  
  // Encode the data parameter: (_tokenOut, _recipient, swapData)
  const executionData = encodeAbiParameters(
    [
      { type: "address", name: "_tokenOut" },
      { type: "address", name: "_recipient" },
      { type: "bytes", name: "data" },
    ],
    [buyingToken.address, owner, swapCallData],
  ) as Hex;

  // Step 4: Generate Permit2 witness signature
  const nonce =
    BigInt(Date.now()) * BigInt(1000000) +
    BigInt(Math.floor(Math.random() * 1000000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 100); // 100 minutes

  console.log("\nGenerating Permit2 witness signature...");
  console.log("Nonce:", nonce.toString());
  console.log("Deadline:", deadline.toString());

  // Calculate the callDataHash for the full xPath call
  // This needs to be the hash of the complete calldata that will be executed
  const fullCallData = encodeFunctionData({
    abi: xPathSwapAbi,
    functionName: "acquireFundsAndExec",
    args: [
      {
        acquisitionMode: 3n, // Permit2 witness mode
        tokenIn: sellingToken.address,
        amountIn: sellAmount,
        meta: keccak256("0x"),
        data: executionData,
        acquisitionData: "0x" as Hex, // Will be filled with signature later
      },
    ],
  });

  const callDataHash = keccak256(executionData);


  // Create the witness data
  const witnessData = {
    target: CONTRACTS.XPATH,
    callDataHash: callDataHash,
  };


  // EIP-712 message for Permit2 witness
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
      spender: CONTRACTS.XPATH, // xPath contract will spend the tokens
      nonce: nonce,
      deadline: deadline,
      witness: witnessData,
    },
  };


  const signature = await walletClient.signTypedData(eip712Message);

  // Step 5: Encode acquisitionData (from, nonce, deadline, signature)
  const acquisitionData = encodeAbiParameters(
    [  {type: "address", name: "from" },
      { type: "uint256", name: "nonce" },
      { type: "uint256", name: "deadline" },
      { type: "bytes", name: "signature" },
    ],
    [owner,nonce, deadline, signature],
  ) as Hex;

  console.log(nonce, deadline, signature);

  // Step 6: Build final transaction
  const args = {
    acquisitionMode: 3n, // Mode 3: Permit2 witness
    tokenIn: sellingToken.address,
    amountIn: sellAmount,
    meta: keccak256("0x"),
    data: executionData,
    acquisitionData: acquisitionData,
  };

  console.log("\nPreparing xPath transaction...");
  console.log("Arguments:", {
    acquisitionMode: args.acquisitionMode.toString(),
    tokenIn: args.tokenIn,
    amountIn: args.amountIn.toString(),
    meta: args.meta,
    data: executionData,
    acquisitionData: acquisitionData,
  });

  const callData = encodeFunctionData({
    abi: xPathSwapAbi,
    functionName: "acquireFundsAndExec",
    args: [args],
  });


  const prefix = "0x00000002";
  const callDataWithoutPrefix = (callData as string).startsWith("0x")
    ? callData.slice(2)
    : callData;
  const finalCallData = (prefix + callDataWithoutPrefix) as Hex;

  console.log("Encoded call data length:", finalCallData.length);

  // Step 7: Initialize Tachyon
  const tachyon = new Tachyon({
    apiKey: TACHYON_API_KEY!,
  });

  // Step 8: Relay transaction via Tachyon
  console.log("\n🔄 Relaying transaction via Tachyon...");
  console.log("Target:", CONTRACTS.XPATH);

  const txId = await tachyon.relay({
    chainId: ChainId.BASE,
    to: CONTRACTS.XPATH,
    value: "0",
    gasLimit: "1000000",
    transactionType: "flash-blocks",
    callData: finalCallData,
  });

  console.log("\n✅ Relay Tx ID:", txId);

  // Step 9: Wait for transaction execution
  console.log("\nWaiting for transaction execution...");
  const relayStatus = await tachyon.waitForPendingExecutionHash(txId);

  console.log("\n✅ Transaction confirmed!");
  console.log(
    "🎉 View on BaseScan:",
    `https://basescan.org/tx/${relayStatus.executionTxHash}`,
  );
}

async function main() {
  try {
    await executeXpathSwapWithPermit2Witness();
  } catch (error) {
    console.error("Error executing xPath swap with Permit2 witness:", error);
    process.exitCode = 1;
  }
}

main();
