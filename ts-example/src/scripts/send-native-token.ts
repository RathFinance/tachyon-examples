import { ChainId, Tachyon } from '@rathfi/tachyon';


const main = async () => {
    // step 1. Create a Tachyon instance
    const tachyon = new Tachyon({
        apiKey: process.env.TACHYON_API_KEY || '',
    });

    // step 2. Send native token
    const txId = await tachyon.relay({
        chainId: ChainId.BASE,
        to: '0xYourRecipientAddressHere',
        value: '1', // Amount in smallest unit of chain's native token
        gasLimit: '30000',
        callData: '0x',
    });

    console.log('Tx ID:', txId);

    // step 3. Monitor the transaction status
    const relayStatus = await tachyon.waitForPendingExecutionHash(txId);
    console.log('Transaction Status:', relayStatus);
};


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});