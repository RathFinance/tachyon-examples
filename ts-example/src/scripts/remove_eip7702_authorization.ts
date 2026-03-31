import {
  createWalletClient,
  http,
  encodeFunctionData,
  createPublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Tachyon } from "@rathfi/tachyon";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

console.log("Removing EIP-7702 delegation by authorizing zero address...");

const publicClient = createPublicClient({
  transport: http(),
  chain: base,
});

// Create wallet client with your EOA
const walletClient = createWalletClient({
  account: privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`),
  transport: http(),
  chain: base,
});

// Zero address to revoke delegation
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function removeAuthorization() {
  console.log("Signing authorization to revoke delegation...");

  // Sign the authorization with zero address to remove delegation
  const authorization = await walletClient.signAuthorization({
    contractAddress: zeroAddress as `0x${string}`,
  });

  // Format authorization for Tachyon
  const auth = {
    chainId: authorization.chainId,
    address: authorization.address,
    nonce: Number(authorization.nonce),
    r: authorization.r,
    s: authorization.s,
    v: Number(authorization.v),
    yParity: Number(authorization.yParity) as 0 | 1,
  };

  console.log("Authorization created:", auth);

  // Initialize Tachyon SDK
  const tachyon = new Tachyon({
    apiKey: process.env.TACHYON_API_KEY!,
  });

  // Create a simple self-transaction with the revocation authorization
  // The actual transaction doesn't matter - the authorization list is what removes the delegation
  const callData = "0x"; // Empty calldata for a simple value transfer

  // Submit transaction with authorization to remove delegation
  const taskId = await tachyon.relay({
    chainId: base.id,
    to: walletClient.account.address, // Send to self
    callData: callData,
    value: "0", // No value transfer
    gasLimit: "100000", // Minimal gas for the transaction
    authorizationList: [auth],
  });

  console.log("Task ID:", taskId);

  // Wait for the transaction to be executed
  const tx = await tachyon.waitForExecutionHash(taskId, 30_000);
  console.log("Transaction executed:", tx);
  console.log("EIP-7702 delegation has been removed from your address");
  console.log(`Delegation revoked for address: ${walletClient.account.address}`);

  return tx;
}

removeAuthorization().catch((error) => {
  console.error("Error removing authorization:", error);
  process.exit(1);
});
