import web3 from "web3";
import { eth } from "web3";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { expect } from "chai";
import { Token } from "../typechain-types/CoinbaseStablecoin/eip-3009/Token";
import { ecSign, expectRevert, Signature, strip0x } from "./helpers";
import { ACCOUNTS_AND_KEYS, MAX_UINT256 } from "./helpers/constants";

const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
);

const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
  "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
);

const CANCEL_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
  "CancelAuthorization(address authorizer,bytes32 nonce)"
);

describe("EIP3009", () => {
  let deployer: Wallet;
  let alice: Wallet;
  let bob: Wallet;
  let charlie: Wallet;
  const keys = {} as { [address: string]: string };
  before(async () => {
    [deployer, alice, bob, charlie] = ACCOUNTS_AND_KEYS.map(
      (x) => new ethers.Wallet(x.key, ethers.provider)
    );
    [deployer, alice, bob, charlie].map(
      (x, i) => (keys[x.address] = ACCOUNTS_AND_KEYS[i].key)
    );
  });

  let token: Token;
  let domainSeparator: string;
  let nonce: string;
  const initialBalance = 10e6;
  beforeEach(async () => {
    token = await (await ethers.getContractFactory("Token"))
      .connect(deployer)
      .deploy("Token", "1", "TOK", 4, initialBalance);

    domainSeparator = await token.DOMAIN_SEPARATOR();
    nonce = web3.utils.randomHex(32);

    await token.transfer(alice.address, initialBalance);
  });

  it("has the expected type hashes", async () => {
    expect(await token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH()).to.equal(
      TRANSFER_WITH_AUTHORIZATION_TYPEHASH
    );

    expect(await token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH()).to.equal(
      RECEIVE_WITH_AUTHORIZATION_TYPEHASH
    );

    expect(await token.CANCEL_AUTHORIZATION_TYPEHASH()).to.equal(
      CANCEL_AUTHORIZATION_TYPEHASH
    );
  });

  describe("transferWithAuthorization", () => {
    let transferParams: {
      from: string;
      to: string;
      value: number;
      validAfter: number;
      validBefore: string;
    };
    before(() => {
      transferParams = {
        from: alice.address,
        to: bob.address,
        value: 7e6,
        validAfter: 0,
        validBefore: MAX_UINT256,
      };
    });

    it("executes a transfer when a valid authorization is given", async () => {
      const { from, to, value, validAfter, validBefore } = transferParams;
      // create an authorization to transfer money from Alice to Bob and sign
      // with Alice's key
      const { v, r, s } = signTransferAuthorization(
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        domainSeparator,
        keys[alice.address]
      );

      // check initial balance
      expect((await token.balanceOf(from)).toNumber()).to.equal(10e6);
      expect((await token.balanceOf(to)).toNumber()).to.equal(0);

      expect(await token.authorizationState(from, nonce)).to.be.false;

      // a third-party, Charlie (not Alice) submits the signed authorization
      const result = await token
        .connect(charlie)
        .transferWithAuthorization(
          from,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
          v,
          r,
          s
        );

      // check that balance is updated
      expect((await token.balanceOf(from)).toNumber()).to.equal(
        initialBalance - value
      );
      expect((await token.balanceOf(to)).toNumber()).to.equal(value);

      // check that AuthorizationUsed event is emitted
      await expect(result)
        .to.emit(token, "AuthorizationUsed")
        .withArgs(from, nonce);

      // check that Transfer event is emitted
      await expect(result).to.emit(token, "Transfer").withArgs(from, to, value);

      // check that the authorization is now used
      expect(await token.authorizationState(from, nonce)).to.be.true;
    });
  });

  describe("receiveWithAuthorization", () => {
    let receiveParams: {
      from: string;
      to: string;
      value: number;
      validAfter: number;
      validBefore: string;
    };
    before(() => {
      receiveParams = {
        from: alice.address,
        to: charlie.address,
        value: 7e6,
        validAfter: 0,
        validBefore: MAX_UINT256,
      };
    });

    it("executes a transfer when a valid authorization is submitted by the payee", async () => {
      const { from, to, value, validAfter, validBefore } = receiveParams;
      // create a receive authorization to transfer money from Alice to Charlie
      // and sign with Alice's key
      const { v, r, s } = signReceiveAuthorization(
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        domainSeparator,
        keys[alice.address]
      );

      // check initial balance
      expect((await token.balanceOf(from)).toNumber()).to.equal(10e6);
      expect((await token.balanceOf(to)).toNumber()).to.equal(0);

      expect(await token.authorizationState(from, nonce)).to.be.false;

      // The payee submits the signed authorization
      const result = await token
        .connect(charlie)
        .receiveWithAuthorization(
          from,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
          v,
          r,
          s
        );

      // check that balance is updated
      expect((await token.balanceOf(from)).toNumber()).to.equal(
        initialBalance - value
      );
      expect((await token.balanceOf(to)).toNumber()).to.equal(value);

      // check that AuthorizationUsed event is emitted
      await expect(result)
        .to.emit(token, "AuthorizationUsed")
        .withArgs(from, nonce);

      // check that Transfer event is emitted
      await expect(result).to.emit(token, "Transfer").withArgs(from, to, value);

      // check that the authorization is now used
      expect(await token.authorizationState(from, nonce)).to.be.true;
    });
  });

  describe("cancelAuthorization", () => {
    it("cancels an unused transfer authorization if the signature is valid", async () => {
      const from = alice.address;
      const to = bob.address;
      const value = 7e6;
      const validAfter = 0;
      const validBefore = MAX_UINT256;

      // create a signed authorization
      const authorization = signTransferAuthorization(
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        domainSeparator,
        keys[alice.address]
      );

      // create cancellation
      const cancellation = signCancelAuthorization(
        from,
        nonce,
        domainSeparator,
        keys[alice.address]
      );

      // check that the authorization is ununsed
      expect(await token.authorizationState(from, nonce)).to.be.false;

      // cancel the authorization
      await token
        .connect(charlie)
        .cancelAuthorization(
          from,
          nonce,
          cancellation.v,
          cancellation.r,
          cancellation.s
        );

      // check that the authorization is now used
      expect(await token.authorizationState(from, nonce)).to.be.true;

      // attempt to use the canceled authorization
      await expectRevert(
        token
          .connect(charlie)
          .transferWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            authorization.v,
            authorization.r,
            authorization.s
          ),
        "authorization is used"
      );
    });
  });
});

function signTransferAuthorization(
  from: string,
  to: string,
  value: number | string,
  validAfter: number | string,
  validBefore: number | string,
  nonce: string,
  domainSeparator: string,
  privateKey: string
): Signature {
  return signEIP712(
    domainSeparator,
    TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
    ["address", "address", "uint256", "uint256", "uint256", "bytes32"],
    [from, to, value, validAfter, validBefore, nonce],
    privateKey
  );
}

function signReceiveAuthorization(
  from: string,
  to: string,
  value: number | string,
  validAfter: number | string,
  validBefore: number | string,
  nonce: string,
  domainSeparator: string,
  privateKey: string
): Signature {
  return signEIP712(
    domainSeparator,
    RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
    ["address", "address", "uint256", "uint256", "uint256", "bytes32"],
    [from, to, value, validAfter, validBefore, nonce],
    privateKey
  );
}

export function signCancelAuthorization(
  signer: string,
  nonce: string,
  domainSeparator: string,
  privateKey: string
): Signature {
  return signEIP712(
    domainSeparator,
    CANCEL_AUTHORIZATION_TYPEHASH,
    ["address", "bytes32"],
    [signer, nonce],
    privateKey
  );
}

function signEIP712(
  domainSeparator: string,
  typeHash: string,
  types: string[],
  parameters: (string | number)[],
  privateKey: string
): Signature {
  const digest = web3.utils.keccak256(
    "0x1901" +
      strip0x(domainSeparator) +
      strip0x(
        web3.utils.keccak256(
          eth.abi.encodeParameters(
            ["bytes32", ...types],
            [typeHash, ...parameters]
          )
        )
      )
  );

  return ecSign(digest, privateKey);
}
