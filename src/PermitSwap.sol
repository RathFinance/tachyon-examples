// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PermitSwap {
    address public swapper;

    constructor(address _swapper) {
        swapper = _swapper;
    }

    function permitAndSwap(
        address owner,
        address tokenIn,
        uint256 amountIn,
        bytes memory data,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(tokenIn).permit(owner, address(this), amountIn, deadline, v, r, s);
        IERC20(tokenIn).transferFrom(owner, address(this), amountIn);
        IERC20(tokenIn).approve(swapper, amountIn);

        (bool ok,) = swapper.call(data);
        require(ok, "swap failed");
    }
}