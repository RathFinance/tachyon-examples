// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PermitSwap.sol";

contract DeployPermitSwap is Script {
    function run() external {
        uint256 alice_pk = vm.envUint("PK");
        vm.startBroadcast(alice_pk);
        address swapper = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;
        PermitSwap permitswapcontract = new PermitSwap(swapper);
        console.log("PermitSwap deployed at:", address(permitswapcontract));

        vm.stopBroadcast();
    }
}

//PermitSwap@0xa80b781447e4048Cb6B6acB7f07d6DE9C60685Af