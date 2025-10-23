// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract HelloTachyon {
    event Greeted(string message);
    function sayHello(string memory message) public {
        emit Greeted(message);
    }
}
