// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HelloTachyon {
    event Greeted(string message);
    function sayHello(string memory message) public {
        emit Greeted(message);
    }
}
