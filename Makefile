deploy:
	forge script scripts/deploy_permitswap.s.sol:DeployPermitSwap \
	--rpc-url $BASE_RPC \
	--broadcast -vvvv


verify:
	forge verify-contract \
	--chain-id 8453 \
	--watch \
	0xa80b781447e4048Cb6B6acB7f07d6DE9C60685Af \
	src/PermitSwap.sol:PermitSwap \
	--verifier etherscan \
	--etherscan-api-key $ETHERSCAN_API_KEY