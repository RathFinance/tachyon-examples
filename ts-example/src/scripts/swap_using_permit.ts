import { ethers } from "ethers";
import { ChainId, Tachyon } from "@rathfi/tachyon";
import * as dotenv from "dotenv";
dotenv.config({ path: "ts-example/.env" });

// === CONFIG ===
const PERMIT_SWAP_ADDRESS = process.env.PERMIT_SWAP_CONTRACT!;
const TOKEN_IN_ADDRESS = process.env.TOKEN_ADDRESS!;

// ADDRESS FOR SWAPPING CONTRACT ON BASE
const SWAPPER_ADDRESS = "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64"; // ANY SWAP

// SWAP CALL DATA (fetched from swapping provider API)
const SWAP_DATA = "0x";

// === ABI ===
const permitSwapAbi = [
  "function permitAndSwap(address owner, address tokenIn, uint256 amountIn, bytes data, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
];

const tokenAbi = [
  "function name() view returns (string)",
  "function nonces(address) view returns (uint256)",
];

async function main() {
  // Step 1. Setup provider and signer for signing the permit
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const owner = await signer.getAddress();


  const token = new ethers.Contract(
    TOKEN_IN_ADDRESS,
    tokenAbi,
    provider
  );

  const name = await token.name();
  const nonce = await token.nonces(owner);
  const chain = await provider.getNetwork();

  const amountIn = 10; // USDC has 6 decimals eg. 0.00001 U
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  const domain = {
    name,
    version: "2", // hardcoded for USDC on base
    chainId: chain.chainId,
    verifyingContract: TOKEN_IN_ADDRESS,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    owner,
    spender: PERMIT_SWAP_ADDRESS,
    value: amountIn,
    nonce,
    deadline,
  };
  // Step 2. Sign the permit (this will give authorization )
  const signature = await signer.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);
  const { v, r, s } = sig;

  // Step 3. Encode function call data for permitAndSwap()
  const iface = new ethers.Interface(permitSwapAbi);
  const callData = iface.encodeFunctionData("permitAndSwap", [
    owner,
    TOKEN_IN_ADDRESS,
    amountIn,
    SWAP_DATA,
    deadline,
    v,
    r,
    s,
  ]);

  // Step 4. Initialize Tachyon
  const tachyon = new Tachyon({
    apiKey: process.env.TACHYON_API_KEY || "",
  });

  // Step 5. Relay the transaction via Tachyon
  console.log("Relaying transaction via Tachyon...");

  const txId = await tachyon.relay({
    chainId: ChainId.BASE, // Adjust chain if not Base
    to: PERMIT_SWAP_ADDRESS,
    value: "0", // No native value needed
    gasLimit: "1000000",
    transactionType:'flash-blocks', // transaction type flash-blocks sends tx even faster
    callData,
  });

  console.log("Relay Tx ID:", txId);

  // Step 6. Wait for the transaction to execute
  const relayStatus = await tachyon.waitForPendingExecutionHash(txId);
  console.log("Transaction Status:", relayStatus);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
