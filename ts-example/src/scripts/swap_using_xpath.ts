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

// ABI for rathExecutePermit2WithWitness function
const xPathSwapAbI = [
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

async function executeXpathSwap() {
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
    `Swapping ${sellingToken.address} to ${buyingToken.address} using Permit2 + Tachyon relay\n`,
  );

  // Define swap parameters
  const sellAmount = parseUnits("0.1", 6);
  const chainId = base.id;

  // Step 1: Check and approve USDC to Permit2 if needed
  const currentAllowance = await publicClient.readContract({
    address: sellingToken.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, CONTRACTS.XPATH],
  });

  console.log(`Token allowance to Xpath: ${currentAllowance.toString()}`);

  if (currentAllowance < sellAmount) {
    console.log("Approving token to Xpath...");
    const approveHash = await walletClient.writeContract({
      address: sellingToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.XPATH, sellAmount],
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
    { headers },
  );

  const quote = await quoteResponse.json();
  console.log("Quote response:", quote);

  // Step 3: Prepare arguments for acquireFundsAndExec
  const meta = keccak256("0x"); // Empty meta
  const data = quote.transaction.data as Hex; // The 0x swap calldata

  const args = {
    acquisitionMode: 0n,
    tokenIn: sellingToken.address,
    amountIn: sellAmount,
    meta: meta,
    // encode address _tokenOut, address _recipient, bytes memory data
    data: encodeAbiParameters(
      [
        { type: "address", name: "_tokenOut" },
        { type: "address", name: "_recipient" },
        { type: "bytes", name: "data" },
      ],
      [buyingToken.address, owner, data],
    ) as Hex,
    acquisitionData: "0x" as Hex,
  };

  console.log("\nCalling acquireFundsAndExec on XPATH contract...");
  console.log("Arguments:", {
    acquisitionMode: args.acquisitionMode.toString(),
    tokenIn: args.tokenIn,
    amountIn: args.amountIn.toString(),
    meta: args.meta,
    dataLength: args.data.length,
    acquisitionData: args.acquisitionData,
  });

  const callData = encodeFunctionData({
    abi: xPathSwapAbI,
    functionName: "acquireFundsAndExec",
    args: [args],
  });

  //add 0x00000002 prefix to callData
  const prefix = "0x00000002";
  const callDataWithPrefix = (callData as string).startsWith("0x")
    ? callData.slice(2)
    : callData;
  const finalCallData = (prefix + callDataWithPrefix) as Hex;
  console.log("Encoded call data length:", finalCallData.length);

  // Step 4: Execute the swap through XPATH using callData
  const swapHash = await walletClient.sendTransaction({
    to: CONTRACTS.XPATH,
    data: finalCallData,
    value: 0n,
  });

  console.log("\n🔄 Swap transaction submitted!");
  console.log("Transaction Hash:", swapHash);
  console.log("Explorer:", `https://basescan.org/tx/${swapHash}`);

  // Wait for transaction confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: swapHash,
  });
  console.log("\n✅ Transaction confirmed!");
  console.log("Block Number:", receipt.blockNumber.toString());
  console.log("Gas Used:", receipt.gasUsed.toString());
  console.log(
    "Status:",
    receipt.status === "success" ? "✅ Success" : "❌ Failed",
  );
  console.log("\nView on BaseScan:", `https://basescan.org/tx/${swapHash}`);
}

async function main() {
  try {
    await executeXpathSwap();
  } catch (error) {
    console.error("Error executing Permit2 swap with Tachyon:", error);
    process.exitCode = 1;
  }
}

main();
