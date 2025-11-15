// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPermit2 {
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

contract PermitSwap {
    address public swapper;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

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

    function permit2AndSwap(
        IPermit2.PermitTransferFrom memory permit,
        bytes memory signature,
        address owner,
        bytes memory swapData
    ) external {
        // Transfer tokens from owner to this contract via Permit2
        IPermit2.SignatureTransferDetails memory transferDetails =
            IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: permit.permitted.amount});
        IPermit2(PERMIT2).permitTransferFrom(permit, transferDetails, owner, signature);

        // Approve swapper to use the tokens
        IERC20(permit.permitted.token).approve(swapper, permit.permitted.amount);
        // Execute swap
        (bool ok,) = swapper.call(swapData);
        require(ok, "swap failed");
    }
}
