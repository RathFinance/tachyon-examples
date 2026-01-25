import {
  createWalletClient,
  http,
  encodeFunctionData,
  concat,
  pad,
  numberToHex,
  hexToBytes,
  createPublicClient,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Tachyon } from "@rathfi/tachyon";
import { ethers } from "ethers";
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import * as dotenv from "dotenv";
dotenv.config({ path: "ts-example/.env" });

// Entry point configuration
const entryPoint = {
  address: entryPoint07Address as `0x${string}`,
  version: "0.7" as const,
  abi: entryPoint07Abi,
};

console.log("Creating EIP-7702 delegated transaction via EntryPoint...");

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

// The contract address to delegate to (ERC-4337 Account)
const delegateContractAddress = "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28";
const beneficiary = "0x4C16955d8A0DcB2e7826d50f4114990c787b21E7";
const helloTachyonAddress = "0xA7A833e6641D7901F30EaD6f27d4Ee2C9bb670a7";

// Set to true if the address is already delegated to skip authorization
// AFTER MAKING ONE TX MAKE IT FALSE 
const isAlreadyDelegated = true;

async function createEIP7702Transaction() {
  let authorizationList = undefined;

  if (!isAlreadyDelegated) {
    // Sign the authorization - viem handles nonce automatically
    const authorization = await walletClient.signAuthorization({
      contractAddress: delegateContractAddress,
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

    authorizationList = [auth];
    console.log("Authorization created for delegation");
  } else {
    console.log("Skipping delegation - address already delegated");
  }

  // Encode the sayHello call
  const abi = ["function sayHello(string message)"];
  const iface = new ethers.Interface(abi);
  const sayHelloCallData = iface.encodeFunctionData("sayHello", [
    "Hello from Tachyon!",
  ]);

  // Create UserOperation callData

    const encoded = encodePacked(
      ["address", "uint256", "bytes"],
      [
        helloTachyonAddress as `0x${string}`,
        BigInt(0),
       sayHelloCallData as `0x${string}`,
      ],
    );

    const userOperationCallData = encodeFunctionData({
      abi: [
        {
          inputs: [
            {
              internalType: "ExecMode",
              name: "execMode",
              type: "bytes32",
            },
            {
              internalType: "bytes",
              name: "executionCalldata",
              type: "bytes",
            },
          ],
          name: "execute",
          outputs: [],
          stateMutability: "payable",
          type: "function",
        },
      ],
      functionName: "execute",
      args: [
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        encoded,
      ],
    });

  // Get nonce for the delegated address
  const nonce = await publicClient.readContract({
    address: entryPoint.address,
    abi: entryPoint.abi,
    functionName: "getNonce",
    args: [walletClient.account.address, BigInt(0)],
    blockTag: "pending",
  });

  // Gas limits
  const callGasLimit = BigInt(500_000);
  const verificationGasLimit = BigInt(1_200_000);
  const preVerificationGas = BigInt(100_000);

  // Create UserOperation
  const userOperation = {
    sender: walletClient.account.address,
    nonce: nonce,
    initCode: "0x" as `0x${string}`,
    callData: userOperationCallData,
    callGasLimit: callGasLimit,
    verificationGasLimit: verificationGasLimit,
    preVerificationGas: preVerificationGas,
    maxFeePerGas: BigInt(0),
    maxPriorityFeePerGas: BigInt(0),
    paymasterAndData: "0x" as `0x${string}`,
    signature: "0x" as `0x${string}`,
  };

  // Sign the UserOperation hash
  const userOperationHash = getUserOperationHash({
    userOperation,
    entryPointAddress: entryPoint.address,
    entryPointVersion: entryPoint.version,
    chainId: base.id,
  });

  console.log("UserOperation Hash:", userOperationHash);

  // Sign directly with the account (EOA signature for EIP-7702)
  const signature = await walletClient.signMessage({
    message: {
      raw: userOperationHash,
    },
  });
  console.log("Signature:", signature);

  // Update UserOperation with signature
  userOperation.signature = signature;

  // Encode handleOps call
  const callData = encodeFunctionData({
    abi: entryPoint.abi,
    functionName: "handleOps",
    args: [
      [
        {
          sender: userOperation.sender,
          nonce: userOperation.nonce,
          initCode: userOperation.initCode || "0x",
          callData: userOperation.callData,
          accountGasLimits: concat([
            pad(numberToHex(userOperation.verificationGasLimit || BigInt(0)), {
              size: 16,
            }),
            pad(numberToHex(userOperation.callGasLimit || BigInt(0)), {
              size: 16,
            }),
          ]),
          preVerificationGas: userOperation.preVerificationGas,
          gasFees: concat([
            pad(numberToHex(BigInt(0)), { size: 16 }),
            pad(numberToHex(BigInt(0)), { size: 16 }),
          ]),
          paymasterAndData: userOperation.paymasterAndData || "0x",
          signature: userOperation.signature,
        },
      ],
      beneficiary as `0x${string}`,
    ],
  });

  // Calculate relay gas limit
  const relayGasLimit =
    (userOperation.callGasLimit +
      userOperation.verificationGasLimit +
      userOperation.preVerificationGas) *
    BigInt(2);

  // Initialize Tachyon SDK
  const tachyon = new Tachyon({
    apiKey: process.env.TACHYON_API_KEY!,
  });

  // Submit transaction with authorization to EntryPoint
  const taskId = await tachyon.relay({
    chainId: base.id,
    to: entryPoint.address,
    callData: callData,
    value: "0",
    gasLimit: relayGasLimit.toString(),
    ...(authorizationList
      ? { authorizationList }
      : {
          transactionType: "flash-blocks",
        }),
  });

  console.log("Task ID:", taskId);

  // Wait for the transaction to be executed
  const tx = await tachyon.waitForExecutionHash(taskId, 30_000);
  console.log("Transaction executed:", tx);
  console.log(
    "Called sayHello via EIP-7702 delegated address through EntryPoint",
  );

  return tx;
}

createEIP7702Transaction();
