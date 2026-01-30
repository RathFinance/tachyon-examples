import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  createPublicClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Load env vars
dotenv();
const { PRIVATE_KEY } = process.env;

// Validate requirements
if (!PRIVATE_KEY) throw new Error("missing PRIVATE_KEY");
const GASLESS_API_URL = 'https://api.xpath.rath.fi'

// Contract addresses for Base network
const CONTRACTS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Uniswap Permit2
} as const;

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

// API headers
const headers = {
  "Content-Type": "application/json",
};

interface QuoteResponse {
  code: number;
  message: string;
  data: {
    quoteId: string;
    eip712: {
      domain: {
        name: string;
        chainId: string;
        verifyingContract: Hex;
      };
      types: any;
      primaryType: string;
      message: any;
    };
    nonce: string;
    deadline: string;
    quote: {
      fromChainId: number;
      toChainId: number;
      from: string;
      receiver: string;
      tokenIn: {
        address: string;
        amount: string;
      };
      tokenOut: {
        address: string;
        amount: string;
      };
      amountIn: string;
      amountInAfterFee: string;
      amountOut: string;
      amountOutMin: string;
      aggregator: string;
      aggregatorId: string;
      acquisitionMode: number;
    };
    fee: {
      feeAmount: string;
      feeUsd: number;
      feeRecipient: string;
    };
  };
}

interface SubmitSwapResponse {
  code: number;
  message: string;
  data: {
    swapId: string;
    tachyonTxId: string;
    executionTxHash: string | null;
    status: string;
    fromChainId: number;
    toChainId: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    feeAmount: string;
    amountOut: string;
  };
}

interface StatusResponse {
  code: number;
  message: string;
  data: {
    swapId: string;
    tachyonTxId: string;
    executionTxHash: string | null;
    status: string;
    fromChainId: number;
    toChainId: number;
    from: string;
    recipient: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    feeAmount: string;
    amountOut: string;
    aggregator: string;
    createdAt: string;
    updatedAt: string;
  };
}

async function executeGaslessSwap() {
  const owner = account.address;
  const chainId = base.id;

  console.log("xpath Swap Example");
  console.log("Owner address:", owner);
  console.log("Chain ID:", chainId);
  console.log("=".repeat(60));

  // Setup token contracts
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
    `\n💱 Swapping WETH → USDC`,
  );
  console.log(`   Input Token:  ${sellingToken.address}`);
  console.log(`   Output Token: ${buyingToken.address}`);

  // Define swap parameters
  const sellAmount = parseUnits("0.00000632177181558", 18); // 0.00000332177181558 WETH
  console.log(`   Sell Amount:  ${sellAmount.toString()} (0.00000332177181558 WETH)`);

  // Step 1: Check and approve WETH to Permit2 if needed
  console.log("\n📝 Step 1: Checking Permit2 Allowance");
  console.log("-".repeat(60));

  const currentAllowance = await publicClient.readContract({
    address: sellingToken.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, CONTRACTS.PERMIT2],
  });

  console.log(`   Current allowance: ${currentAllowance.toString()}`);

  if (currentAllowance < sellAmount) {
    console.log("   ⚠️  Insufficient allowance, approving...");
    const approveHash = await walletClient.writeContract({
      address: sellingToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.PERMIT2, maxUint256],
    });

    console.log(`   📤 Approval tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("   ✅ WETH approved to Permit2!");
  } else {
    console.log("   ✅ WETH already approved to Permit2");
  }

  // Step 2: Get quote from gasless API
  console.log("\n📊 Step 2: Fetching Gasless Quote");
  console.log("-".repeat(60));

  const quoteParams = new URLSearchParams({
    input_token: sellingToken.address,
    output_token: buyingToken.address,
    input_amount: sellAmount.toString(),
    from_chain_id: chainId.toString(),
    to_chain_id: chainId.toString(),
    from: owner,
    receiver: owner,
    slippage: "0.5",
    acquisition_mode: "3", // Permit2Witness
    deadline_minutes: "100",
  });

  const quoteUrl = `${GASLESS_API_URL}/gasless/quote?${quoteParams.toString()}`;
  console.log(`Requesting: ${quoteUrl}`);

  const quoteResponse = await fetch(quoteUrl, {
    method: "GET",
    headers,
  });

  if (!quoteResponse.ok) {
    const errorText = await quoteResponse.text();
    throw new Error(`Failed to fetch quote: ${quoteResponse.status} ${errorText}`);
  }

  const quoteData: QuoteResponse = await quoteResponse.json();

  if (quoteData.code !== 0) {
    throw new Error(`API error: ${quoteData.message}`);
  }

  console.log("   ✅ Quote received!");
  console.log(`   Quote ID: ${quoteData.data.quoteId}`);
  console.log(`   Aggregator: ${quoteData.data.quote.aggregator}`);
  console.log(`   Amount In: ${quoteData.data.quote.amountIn}`);
  console.log(`   Amount In (after fee): ${quoteData.data.quote.amountInAfterFee}`);
  console.log(`   Expected Out: ${quoteData.data.quote.amountOut}`);
  console.log(`   Min Out (with slippage): ${quoteData.data.quote.amountOutMin}`);
  console.log(`   Fee: ${quoteData.data.fee.feeAmount} ($${quoteData.data.fee.feeUsd})`);
  console.log(`   Nonce: ${quoteData.data.nonce}`);
  console.log(`   Deadline: ${quoteData.data.deadline}`);

  // Step 3: Sign EIP712 data
  console.log("\n✍️  Step 3: Signing EIP712 Permit2 Data");
  console.log("-".repeat(60));

  const eip712Data = quoteData.data.eip712;
  console.log(`   Domain: ${eip712Data.domain.name}`);
  console.log(`   Primary Type: ${eip712Data.primaryType}`);
  console.log(`   Signing...`);

  const signature = await walletClient.signTypedData({
    domain: {
      name: eip712Data.domain.name,
      chainId: parseInt(eip712Data.domain.chainId),
      verifyingContract: eip712Data.domain.verifyingContract,
    },
    types: eip712Data.types,
    primaryType: eip712Data.primaryType as any,
    message: eip712Data.message,
  });

  console.log(` ✅ Signature: ${signature}`);

  // Step 4: Submit swap to gasless API
  console.log("\n🚀 Step 4: Submitting Gasless Swap");
  console.log("-".repeat(60));

  const submitUrl = `${GASLESS_API_URL}/gasless/submit-swap`;
  console.log(`Submitting to: ${submitUrl}`);

  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      quoteId: quoteData.data.quoteId,
      signature: signature,
    }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Failed to submit swap: ${submitResponse.status} ${errorText}`);
  }

  const submitData: SubmitSwapResponse = await submitResponse.json();

  if (submitData.code !== 0) {
    throw new Error(`API error: ${submitData.message}`);
  }

  console.log("   ✅ Swap submitted!");
  console.log(`   Swap ID: ${submitData.data.swapId}`);
  console.log(`   Tachyon Tx ID: ${submitData.data.tachyonTxId}`);
  console.log(`   Status: ${submitData.data.status}`);

  // Step 5: Poll for transaction status
  console.log("\n⏳ Step 5: Waiting for Execution");
  console.log("-".repeat(60));

  const swapId = submitData.data.swapId;
  let executionTxHash: string | null = null;
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max (5 second intervals)

  while (!executionTxHash && attempts < maxAttempts) {
    attempts++;
    console.log(`   Attempt ${attempts}/${maxAttempts}...`);

    const statusUrl = `${GASLESS_API_URL}/gasless/status?id=${swapId}`;
    const statusResponse = await fetch(statusUrl, {
      method: "GET",
      headers,
    });

    if (!statusResponse.ok) {
      console.log(`⚠️  Status check failed: ${statusResponse.status}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    const statusData: StatusResponse = await statusResponse.json();

    if (statusData.code !== 0) {
      console.log(`   ⚠️  API error: ${statusData.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    console.log(`   Status: ${statusData.data.status}`);

    if (statusData.data.status === "failed") {
      throw new Error("Swap execution failed");
    }

    if (statusData.data.executionTxHash) {
      executionTxHash = statusData.data.executionTxHash;
      console.log(`   ✅ Execution Hash: ${executionTxHash}`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (!executionTxHash) {
    throw new Error("Timeout waiting for transaction execution");
  }

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 GASLESS SWAP COMPLETED!");
  console.log("=".repeat(60));
  console.log(`Swap ID: ${swapId}`);
  console.log(`Tachyon Tx ID: ${submitData.data.tachyonTxId}`);
  console.log(`Execution Hash: ${executionTxHash}`);
  console.log(`\n🔗 View on BaseScan:`);
  console.log(`   https://basescan.org/tx/${executionTxHash}`);
  console.log("=".repeat(60));
}

async function main() {
  try {
    await executeGaslessSwap();
  } catch (error) {
    console.error("\n❌ Error executing gasless swap:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
    }
    process.exitCode = 1;
  }
}

main();
